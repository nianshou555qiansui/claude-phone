'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  config,
  PERMISSION_MODES,
  normalizePermissionMode,
  loadEnvFile,
  ROOT,
} = require('./lib/config');
const { ChatStore, newId, isSessionId } = require('./lib/store');
const { ClaudeTurn, buildHistoryPrompt } = require('./lib/claude-runner');
const { LOCAL_COMMANDS, resolveLocalCommand } = require('./lib/commands');
const { JobStore } = require('./lib/jobs');
const {
  getSettingsView,
  updateSettings,
  settingsPath,
} = require('./lib/settings-editor');

const store = new ChatStore();
const jobs = new JobStore();
const publicDir = path.join(ROOT, 'public');

const activeTurns = new Map(); // sessionId -> { turn, jobId }
const subscribers = new Map(); // sessionId -> Set<res>
const sessionModels = new Map(); // sessionId -> model override for next turn
// 前台任务：最后一个 SSE 断开后延迟 abort，避免刷新误杀
const foregroundDisconnectTimers = new Map(); // sessionId -> Timeout

function authUserPass() {
  const fileEnv = loadEnvFile(path.join(ROOT, 'config.env'));
  return {
    user: process.env.AUTH_USER || fileEnv.AUTH_USER || 'admin',
    pass: process.env.AUTH_PASS || fileEnv.AUTH_PASS || '',
  };
}

function unauthorized(res) {
  res.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Claude Phone"',
  });
  res.end('Unauthorized');
}

function isHealthPath(urlPath) {
  return urlPath === '/api/health';
}

function clientIp(req) {
  // 仅监听 loopback 时 remoteAddress 多为 127.0.0.1
  const ra = req.socket && req.socket.remoteAddress;
  return ra || '';
}

function isLoopbackIp(ip) {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('/127.0.0.1')
  );
}

/**
 * 鉴权策略：
 * - /api/health：允许（供本机探活；不返回敏感信息）
 * - 带正确 Basic Auth：通过
 * - 来自 loopback 且带 X-Claude-Phone-Local: 1（可选运维）：通过
 * - 其它：401
 * 注意：Caddy basic_auth 会在反代前注入 Authorization，浏览器用户正常。
 */
function checkBasicAuth(req, urlPath) {
  if (isHealthPath(urlPath)) return true;

  const header = req.headers.authorization;
  const { user, pass } = authUserPass();

  // 未配置密码时拒绝（避免裸奔）
  if (!pass || pass === 'change-me') {
    // 仅允许本机 loopback 开发
    if (isLoopbackIp(clientIp(req))) return true;
    return false;
  }

  if (header && header.startsWith('Basic ')) {
    let decoded;
    try {
      decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    } catch {
      return false;
    }
    const i = decoded.indexOf(':');
    const u = i >= 0 ? decoded.slice(0, i) : decoded;
    const p = i >= 0 ? decoded.slice(i + 1) : '';
    return u === user && p === pass;
  }

  // 无 Authorization：默认拒绝（修复此前“loopback 一律放行”的问题）
  // 本机 curl 探活请用 /api/health，或带 -u user:pass
  return false;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function broadcast(sessionId, event) {
  const set = subscribers.get(sessionId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of [...set]) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

/**
 * 前台模式：最后一个 SSE 断开后，延迟 abort。
 * 后台模式：断开不杀。
 * 宽限 4s，避免手机刷新/短暂切后台误杀。
 */
function maybeAbortForegroundOnDisconnect(sessionId) {
  const live = activeTurns.get(sessionId);
  if (!live || !live.jobId) return;
  const job = jobs.get(live.jobId);
  if (!job || job.status !== 'running') return;
  // background === true → 不杀
  if (job.background) return;

  if (foregroundDisconnectTimers.has(sessionId)) {
    clearTimeout(foregroundDisconnectTimers.get(sessionId));
  }
  const t = setTimeout(() => {
    foregroundDisconnectTimers.delete(sessionId);
    // 宽限期内又连回来了？
    const set = subscribers.get(sessionId);
    if (set && set.size > 0) return;
    const still = activeTurns.get(sessionId);
    if (!still || still.jobId !== live.jobId) return;
    const j = jobs.get(live.jobId);
    if (!j || j.status !== 'running' || j.background) return;
    try {
      still.turn.abort('foreground_disconnect');
      broadcast(sessionId, {
        type: 'aborted',
        reason: 'foreground_disconnect',
        jobId: live.jobId,
      });
      const msg = systemReply(
        sessionId,
        '前台模式：页面已断开，任务已自动停止。若要关网页也继续跑，请勾选「后台任务」后再发送。',
        { reason: 'foreground_disconnect' }
      );
      broadcast(sessionId, { type: 'system_message', message: msg });
    } catch (e) {
      console.error('[foreground abort]', e);
    }
  }, 4000);
  t.unref?.();
  foregroundDisconnectTimers.set(sessionId, t);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
    }[ext] || 'application/octet-stream'
  );
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, rel);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    const index = path.join(publicDir, 'index.html');
    if (fs.existsSync(index)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(fs.readFileSync(index));
    }
    res.writeHead(404);
    return res.end('Not found');
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=300',
  });
  res.end(data);
}

function modeLabel(id) {
  const m = normalizePermissionMode(id);
  return (
    {
      default: '默认',
      acceptEdits: '接受编辑',
      plan: '仅计划',
      auto: '自动',
      bypassPermissions: '全部放行',
      dontAsk: '仅白名单',
      manual: '默认', // 兼容旧值
    }[m] || m
  );
}

function modeHint(id) {
  const m = normalizePermissionMode(id);
  return (
    {
      default:
        '非交互默认：未在 allow 列表的工具会被拒或受限；网页无法弹窗点确认',
      acceptEdits: '自动接受工作区内文件编辑与常见文件系统命令',
      plan: '只读探索，不改源码（适合先想方案）',
      auto: '自动模式（需 CLI 支持；否则可能失败）',
      bypassPermissions: '跳过权限提示（危险，仅限自己服务器）',
      dontAsk: '未在 permissions.allow 里的工具一律拒绝',
      manual: '同默认（-p 下无法真正手动点确认）',
    }[m] || ''
  );
}

function systemReply(sessionId, content, meta = {}) {
  return store.appendMessage(sessionId, {
    role: 'system',
    content,
    meta: { localCommand: true, ...meta },
  });
}

async function applyLocalCommand(session, cmd) {
  const sessionId = session.id;
  switch (cmd.type) {
    case 'help':
    case 'mode_help':
    case 'status':
    case 'unknown_slash': {
      if (cmd.reply) {
        const msg = systemReply(sessionId, cmd.note ? `${cmd.note}\n\n${cmd.reply || ''}`.trim() : cmd.reply);
        broadcast(sessionId, { type: 'system_message', message: msg });
      } else if (cmd.note) {
        const msg = systemReply(sessionId, cmd.note);
        broadcast(sessionId, { type: 'system_message', message: msg });
      }
      return { stopClaude: cmd.stopClaude !== false && !cmd.passThrough, passThrough: !!cmd.passThrough };
    }
    case 'rewind': {
      const { turns } = cmd.payload;
      const { messages, session: updated } = store.rewindLastTurns(sessionId, turns);
      broadcast(sessionId, {
        type: 'rewound',
        session: updated,
        messages,
        turns,
      });
      const msg = systemReply(sessionId, cmd.reply, { turns });
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    case 'clear': {
      const { messages, session: updated } = store.rewindTo(sessionId, null);
      store.updateSession(sessionId, { needsHistoryInject: false, claudeSessionId: null });
      broadcast(sessionId, { type: 'rewound', session: updated, messages, turns: null });
      const msg = systemReply(sessionId, cmd.reply);
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    case 'compact': {
      const keep = cmd.payload.keepTurns || 12;
      // 保留最近 keep 个 user 回合：找到第 keep 个 user 从末尾数
      const all = store.listMessages(sessionId, { limit: 100000 });
      let users = 0;
      let cut = 0;
      for (let i = all.length - 1; i >= 0; i--) {
        if (all[i].role === 'user') {
          users += 1;
          if (users >= keep) {
            cut = i;
            break;
          }
        }
      }
      const keepId = cut > 0 ? all[cut - 1]?.id : null;
      // 若 cut 指向要保留的起点，keep 从 cut 开始
      let result;
      if (users < keep) {
        result = { messages: all, session: session };
      } else {
        // 保留 all[cut..]
        const keepFromId = all[cut].id;
        // rewindTo 是 keep 到 id 为止；这里要丢弃 cut 之前的
        // 实现：写回 all.slice(cut)
        const kept = all.slice(cut);
        const p = path.join(config.dataDir, 'messages', `${sessionId}.jsonl`);
        const tmp = p + `.${process.pid}.tmp`;
        fs.writeFileSync(tmp, kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length ? '\n' : ''));
        fs.renameSync(tmp, p);
        const updated = store.updateSession(sessionId, {
          claudeSessionId: null,
          needsHistoryInject: kept.length > 0,
        });
        result = { messages: kept, session: updated };
      }
      broadcast(sessionId, {
        type: 'rewound',
        session: result.session,
        messages: result.messages,
        turns: null,
      });
      const msg = systemReply(sessionId, cmd.reply);
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    case 'mode': {
      const raw = cmd.payload.mode;
      const mode = normalizePermissionMode(raw);
      if (!PERMISSION_MODES.includes(mode) && raw) {
        // normalize 会回退到 default；若用户乱填仍提示
        if (!PERMISSION_MODES.includes(raw) && raw !== 'manual') {
          const msg = systemReply(
            sessionId,
            `无效模式: ${raw}\n可选: ${PERMISSION_MODES.join(', ')}`
          );
          broadcast(sessionId, { type: 'system_message', message: msg });
          return { stopClaude: true };
        }
      }
      const updated = store.updateSession(sessionId, { permissionMode: mode });
      broadcast(sessionId, { type: 'session_updated', session: updated });
      const msg = systemReply(
        sessionId,
        `权限模式已切换为: ${modeLabel(mode)}（${mode}）\n${modeHint(mode)}\n下一条消息起生效。`
      );
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    case 'cwd': {
      if (!cmd.payload.path) {
        const msg = systemReply(sessionId, cmd.reply);
        broadcast(sessionId, { type: 'system_message', message: msg });
        return { stopClaude: true };
      }
      const next = path.resolve(cmd.payload.path);
      if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) {
        const msg = systemReply(sessionId, `目录不存在: ${next}`);
        broadcast(sessionId, { type: 'system_message', message: msg });
        return { stopClaude: true };
      }
      const updated = store.updateSession(sessionId, {
        workDir: next,
        claudeSessionId: null,
        needsHistoryInject: true,
      });
      broadcast(sessionId, { type: 'session_updated', session: updated });
      const msg = systemReply(sessionId, `工作目录已切换为: ${next}\n（已断开旧 resume，将用历史注入）`);
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    case 'model': {
      if (cmd.payload.model) {
        sessionModels.set(sessionId, cmd.payload.model);
        const msg = systemReply(sessionId, cmd.reply);
        broadcast(sessionId, { type: 'system_message', message: msg });
        return { stopClaude: true };
      }
      const msg = systemReply(sessionId, cmd.reply);
      broadcast(sessionId, { type: 'system_message', message: msg });
      return { stopClaude: true };
    }
    default:
      return { stopClaude: false, passThrough: true };
  }
}

function startClaudeTurn(session, userText, assistantId, { background = true } = {}) {
  const sessionId = session.id;
  const mode = normalizePermissionMode(
    session.permissionMode || config.defaultPermissionMode
  );

  let prompt = userText;
  let resume = session.claudeSessionId || null;

  // rewind/clear 后需要注入历史
  if (session.needsHistoryInject || !resume) {
    const hist = store.listMessages(sessionId, { limit: 200 }).filter(
      (m) => m.role === 'user' || m.role === 'assistant'
    );
    const prior = hist.slice(0, -1);
    if (prior.length) {
      prompt = buildHistoryPrompt(prior, userText);
      resume = null;
    }
  }

  const model = sessionModels.get(sessionId) || null;
  if (model) sessionModels.delete(sessionId);

  const job = jobs.create({
    sessionId,
    userText,
    assistantId,
    background,
    workDir: session.workDir || config.workDir,
    permissionMode: mode,
  });

  const turn = new ClaudeTurn({
    prompt,
    workDir: session.workDir || config.workDir,
    permissionMode: mode,
    resumeSessionId: resume,
    model,
  });

  activeTurns.set(sessionId, { turn, jobId: job.id });
  jobs.bindLive(job.id, { turn, sessionId });
  store.updateSession(sessionId, { status: 'running', activeJobId: job.id });
  let acc = '';
  let lastPersist = 0;

  broadcast(sessionId, {
    type: 'job_started',
    job: jobs.get(job.id),
    permissionMode: mode,
  });
  broadcast(sessionId, {
    type: 'status',
    state: 'running',
    permissionMode: mode,
    detail: `权限: ${modeLabel(mode)}`,
  });

  turn.on('permission_mode', ({ requested, effective }) => {
    jobs.update(job.id, {
      permissionMode: requested,
      effectivePermissionMode: effective,
    });
    broadcast(sessionId, {
      type: 'permission_mode',
      requested,
      effective,
      label: modeLabel(effective || requested),
    });
    if (effective && effective !== requested) {
      const msg = systemReply(
        sessionId,
        `注意：请求权限模式 ${requested}，CLI 实际生效为 ${effective}（非交互 -p 下常见）。`,
        { requested, effective }
      );
      broadcast(sessionId, { type: 'system_message', message: msg });
    }
  });

  turn.on('session', ({ claudeSessionId }) => {
    store.updateSession(sessionId, {
      claudeSessionId,
      needsHistoryInject: false,
    });
    jobs.update(job.id, { claudeSessionId });
    broadcast(sessionId, { type: 'claude_session', claudeSessionId });
  });

  turn.on('delta', ({ text: t }) => {
    acc += t;
    const now = Date.now();
    // 落盘 partial，关网页重连可恢复
    if (now - lastPersist > 800) {
      jobs.appendPartial(job.id, ''); // touch
      const j = jobs.get(job.id);
      if (j) {
        j.partialText = acc;
        jobs.update(job.id, { partialText: acc, status: 'running' });
      }
      lastPersist = now;
    } else {
      jobs.appendPartial(job.id, t);
    }
    broadcast(sessionId, {
      type: 'assistant_delta',
      messageId: assistantId,
      jobId: job.id,
      text: t,
    });
  });

  turn.on('tool', (tool) => {
    broadcast(sessionId, {
      type: 'tool',
      messageId: assistantId,
      jobId: job.id,
      tool,
    });
  });

  turn.on('stderr', ({ text: t }) => {
    if (t && t.length < 400) {
      broadcast(sessionId, { type: 'log', text: t, jobId: job.id });
    }
  });

  turn.on('error', ({ message }) => {
    jobs.update(job.id, { error: message });
    broadcast(sessionId, { type: 'error', message, jobId: job.id });
  });

  turn.on('aborted', ({ reason }) => {
    const status = reason === 'user' || reason === 'delete' ? 'cancelled' : 'interrupted';
    jobs.update(job.id, {
      status,
      partialText: acc,
      finalText: acc,
      error: reason,
    });
    broadcast(sessionId, { type: 'aborted', reason, jobId: job.id });
    broadcast(sessionId, { type: 'job_updated', job: jobs.get(job.id) });
  });

  turn.on('done', ({ ok, assistantText, claudeSessionId }) => {
    const live = activeTurns.get(sessionId);
    if (live && live.jobId === job.id) activeTurns.delete(sessionId);
    jobs.unbindLive(job.id);

    const finalText = (assistantText || acc || (ok ? '' : '（无输出或已中断）')).trim();
    const currentJob = jobs.get(job.id);
    const alreadyTerminal =
      currentJob &&
      ['cancelled', 'interrupted'].includes(currentJob.status) &&
      !ok;

    const finalStatus = alreadyTerminal
      ? currentJob.status
      : ok
        ? 'done'
        : 'failed';

    jobs.update(job.id, {
      status: finalStatus,
      partialText: finalText,
      finalText,
      claudeSessionId: claudeSessionId || currentJob?.claudeSessionId || null,
      error: ok ? null : currentJob?.error || 'failed',
    });

    // 若取消时已写过 assistant，避免重复
    let assistantMsg = null;
    const existing = store
      .listMessages(sessionId, { limit: 20 })
      .find((m) => m.id === assistantId);
    if (!existing) {
      assistantMsg = store.appendMessage(sessionId, {
        id: assistantId,
        role: 'assistant',
        content: finalText,
        meta: {
          ok,
          claudeSessionId,
          jobId: job.id,
          background: !!background,
          status: finalStatus,
        },
      });
    } else {
      assistantMsg = existing;
    }

    store.updateSession(sessionId, {
      status: 'idle',
      activeJobId: null,
      ...(claudeSessionId
        ? { claudeSessionId, needsHistoryInject: false }
        : {}),
    });

    broadcast(sessionId, {
      type: 'assistant_done',
      message: assistantMsg,
      ok,
      jobId: job.id,
      job: jobs.get(job.id),
    });
    broadcast(sessionId, { type: 'status', state: 'idle' });
    broadcast(sessionId, { type: 'job_updated', job: jobs.get(job.id) });
  });

  turn.start();
  // 记录 pid（若可取）
  try {
    if (turn.proc && turn.proc.pid) {
      jobs.update(job.id, { pid: turn.proc.pid });
    }
  } catch {
    /* ignore */
  }
  return { turn, jobId: job.id };
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'claude-phone-chat',
      activeTurns: activeTurns.size,
      runningJobs: jobs.listRunning().length,
      workDir: config.workDir,
      defaultPermissionMode: config.defaultPermissionMode,
      defaultBackground: config.defaultBackground,
      permissionModes: PERMISSION_MODES,
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (req.method === 'GET' && pathname === '/api/meta') {
    let runtimeUser = 'claude';
    try {
      runtimeUser = require('os').userInfo().username || process.env.USER || 'user';
    } catch {
      /* ignore */
    }
    return sendJson(res, 200, {
      workDir: config.workDir,
      defaultPermissionMode: config.defaultPermissionMode,
      defaultBackground: config.defaultBackground,
      permissionModes: PERMISSION_MODES.map((id) => ({
        id,
        label: modeLabel(id),
        hint: modeHint(id),
      })),
      commands: LOCAL_COMMANDS.map((c) => ({
        id: c.id,
        aliases: c.aliases,
        summary: c.summary,
      })),
      publicUrl: config.publicUrl,
      runtime: {
        user: runtimeUser,
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
        home: process.env.HOME || require('os').homedir() || process.cwd(),
        settingsPath: settingsPath(),
        pid: process.pid,
      },
    });
  }

  // Claude settings.json（中转/API 配置）
  if (req.method === 'GET' && pathname === '/api/settings') {
    return sendJson(res, 200, getSettingsView());
  }
  if (req.method === 'PUT' && pathname === '/api/settings') {
    const body = (await readBody(req)) || {};
    try {
      const view = updateSettings({
        envUpdates: body.env || body.envUpdates,
        model: body.model,
        rawJson: body.rawJson,
      });
      return sendJson(res, 200, view);
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message || 'update failed' });
    }
  }

  // 全局任务列表
  if (req.method === 'GET' && pathname === '/api/jobs') {
    const u = new URL(req.url || '/', 'http://localhost');
    const sessionId = u.searchParams.get('sessionId') || undefined;
    const includeFinished = u.searchParams.get('all') === '1';
    return sendJson(res, 200, {
      jobs: jobs.list({ sessionId, includeFinished, limit: 50 }),
    });
  }

  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(.*)$/);
  if (jobMatch) {
    const jobId = decodeURIComponent(jobMatch[1]);
    const rest = jobMatch[2] || '';
    const job = jobs.get(jobId);
    if (!job) return sendJson(res, 404, { error: 'job not found' });

    if (req.method === 'GET' && rest === '') {
      return sendJson(res, 200, { job });
    }
    if (req.method === 'POST' && rest === '/cancel') {
      const live = jobs.getLive(jobId);
      if (live && live.turn) {
        live.turn.abort('user');
      } else if (job.status === 'running') {
        jobs.update(jobId, {
          status: 'cancelled',
          error: 'user',
          finalText: job.partialText || '',
        });
      }
      return sendJson(res, 200, { ok: true, job: jobs.get(jobId) });
    }
    return sendJson(res, 404, { error: 'not found' });
  }

  if (req.method === 'GET' && pathname === '/api/sessions') {
    return sendJson(res, 200, { sessions: store.listSessions() });
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = (await readBody(req)) || {};
    const session = store.createSession({
      title: body.title,
      workDir: body.workDir,
      permissionMode: body.permissionMode,
    });
    return sendJson(res, 201, { session });
  }

  const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)(.*)$/);
  if (sessMatch) {
    const sessionId = decodeURIComponent(sessMatch[1]);
    const rest = sessMatch[2] || '';

    if (!isSessionId(sessionId)) {
      return sendJson(res, 400, { error: 'invalid session id' });
    }

    const session = store.getSession(sessionId);
    if (!session && req.method !== 'DELETE') {
      return sendJson(res, 404, { error: 'session not found' });
    }

    if (req.method === 'GET' && rest === '') {
      const runningJob = jobs.findRunningBySession(sessionId);
      return sendJson(res, 200, {
        session,
        messages: store.listMessages(sessionId),
        running: activeTurns.has(sessionId) || !!(runningJob && runningJob.status === 'running'),
        activeJob: runningJob,
        jobs: jobs.list({ sessionId, includeFinished: true, limit: 20 }),
      });
    }

    if (req.method === 'DELETE' && rest === '') {
      if (activeTurns.has(sessionId)) {
        const live = activeTurns.get(sessionId);
        try {
          live.turn.abort('delete');
        } catch {
          /* ignore */
        }
        activeTurns.delete(sessionId);
      }
      store.deleteSession(sessionId);
      sessionModels.delete(sessionId);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'PATCH' && rest === '') {
      const body = (await readBody(req)) || {};
      const patch = {};
      if (body.title != null) patch.title = String(body.title).slice(0, 80);
      if (body.workDir != null) {
        const wd = path.resolve(String(body.workDir));
        if (!fs.existsSync(wd) || !fs.statSync(wd).isDirectory()) {
          return sendJson(res, 400, { error: 'workDir not found' });
        }
        patch.workDir = wd;
        patch.claudeSessionId = null;
        patch.needsHistoryInject = true;
      }
      if (body.permissionMode != null) {
        const pm = normalizePermissionMode(body.permissionMode);
        // 仅允许已知模式或可别名映射的值
        if (
          !PERMISSION_MODES.includes(pm) &&
          body.permissionMode !== 'manual'
        ) {
          return sendJson(res, 400, { error: 'invalid permissionMode' });
        }
        patch.permissionMode = pm;
      }
      const updated = store.updateSession(sessionId, patch);
      broadcast(sessionId, { type: 'session_updated', session: updated });
      return sendJson(res, 200, { session: updated });
    }

    // rewind API
    if (req.method === 'POST' && rest === '/rewind') {
      const body = (await readBody(req)) || {};
      if (activeTurns.has(sessionId) || jobs.findRunningBySession(sessionId)) {
        return sendJson(res, 409, { error: 'busy' });
      }
      let result;
      if (body.messageId) {
        result = store.rewindTo(sessionId, body.messageId);
      } else {
        result = store.rewindLastTurns(sessionId, body.turns || 1);
      }
      broadcast(sessionId, {
        type: 'rewound',
        session: result.session,
        messages: result.messages,
      });
      const msg = systemReply(sessionId, '已回退。可用 /help 查看更多命令。');
      broadcast(sessionId, { type: 'system_message', message: msg });
      return sendJson(res, 200, result);
    }

    // SSE
    if (req.method === 'GET' && rest === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      {
        const runningJob = jobs.findRunningBySession(sessionId);
        res.write(
          `data: ${JSON.stringify({
            type: 'hello',
            sessionId,
            running:
              activeTurns.has(sessionId) ||
              !!(runningJob && runningJob.status === 'running'),
            activeJob: runningJob,
          })}\n\n`
        );
        // 重连时把 partial 文本推回去
        if (runningJob && runningJob.partialText) {
          res.write(
            `data: ${JSON.stringify({
              type: 'assistant_start',
              messageId: runningJob.assistantId,
              jobId: runningJob.id,
              resume: true,
            })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({
              type: 'assistant_delta',
              messageId: runningJob.assistantId,
              jobId: runningJob.id,
              text: runningJob.partialText,
              resume: true,
            })}\n\n`
          );
        }
      }
      if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
      subscribers.get(sessionId).add(res);
      // 有人连上了：取消「前台断开」定时器
      if (foregroundDisconnectTimers.has(sessionId)) {
        clearTimeout(foregroundDisconnectTimers.get(sessionId));
        foregroundDisconnectTimers.delete(sessionId);
      }
      const keep = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 15000);
      keep.unref?.();
      req.on('close', () => {
        clearInterval(keep);
        const set = subscribers.get(sessionId);
        if (set) {
          set.delete(res);
          if (set.size === 0) subscribers.delete(sessionId);
        }
        // 前台任务：最后一个页面连接断开 → 短暂宽限后 abort
        maybeAbortForegroundOnDisconnect(sessionId);
      });
      return;
    }

    // messages
    if (req.method === 'POST' && rest === '/messages') {
      const body = (await readBody(req)) || {};
      const text = String(body.content || body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'empty content' });
      if (text.length > 100_000) return sendJson(res, 400, { error: 'content too long' });
      if (activeTurns.has(sessionId) || jobs.findRunningBySession(sessionId)) {
        return sendJson(res, 409, { error: 'busy', message: '当前对话还在生成中' });
      }
      if (activeTurns.size >= config.maxConcurrentTurns) {
        return sendJson(res, 429, { error: 'server_busy' });
      }

      if (body.permissionMode) {
        store.updateSession(sessionId, {
          permissionMode: normalizePermissionMode(body.permissionMode),
        });
      }

      const background =
        body.background == null ? config.defaultBackground : !!body.background;

      const sess = store.getSession(sessionId);

      const userMsg = store.appendMessage(sessionId, {
        role: 'user',
        content: text,
        meta: { background },
      });
      if (sess.title === '新对话') {
        store.updateSession(sessionId, {
          title: text.replace(/^\//, '').slice(0, 32) + (text.length > 32 ? '…' : ''),
        });
      }

      broadcast(sessionId, { type: 'user_message', message: userMsg });

      // 本地命令
      const msgs = store.listMessages(sessionId);
      const local = resolveLocalCommand(text, {
        session: store.getSession(sessionId),
        messageCount: msgs.length,
      });

      if (local && (local.stopClaude || local.type !== 'unknown_slash')) {
        const result = await applyLocalCommand(store.getSession(sessionId), local);
        if (result.stopClaude && !result.passThrough) {
          return sendJson(res, 200, {
            ok: true,
            local: true,
            type: local.type,
            userMessage: userMsg,
          });
        }
        if (local.note && local.passThrough) {
          const noteMsg = systemReply(sessionId, local.note);
          broadcast(sessionId, { type: 'system_message', message: noteMsg });
        }
      }

      store.updateSession(sessionId, { status: 'running' });
      broadcast(sessionId, { type: 'status', state: 'running' });
      const assistantId = newId();
      broadcast(sessionId, {
        type: 'assistant_start',
        messageId: assistantId,
        background,
      });

      const { jobId } = startClaudeTurn(
        store.getSession(sessionId),
        text,
        assistantId,
        { background }
      );

      return sendJson(res, 202, {
        ok: true,
        userMessage: userMsg,
        assistantMessageId: assistantId,
        jobId,
        background,
      });
    }

    if (req.method === 'POST' && rest === '/abort') {
      const live = activeTurns.get(sessionId);
      if (!live || !live.turn) {
        // 尝试按 job 取消
        const rj = jobs.findRunningBySession(sessionId);
        if (rj) {
          const l = jobs.getLive(rj.id);
          if (l && l.turn) l.turn.abort('user');
          else jobs.update(rj.id, { status: 'cancelled', error: 'user' });
          return sendJson(res, 200, { ok: true, jobId: rj.id });
        }
        return sendJson(res, 404, { error: 'not running' });
      }
      live.turn.abort('user');
      return sendJson(res, 200, { ok: true, jobId: live.jobId });
    }
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const u = new URL(req.url || '/', `http://${host}`);
    if (!checkBasicAuth(req, u.pathname)) return unauthorized(res);

    // 基础安全响应头（Caddy 也会加一层；此处兜底直连场景）
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    if (u.pathname.startsWith('/api/')) {
      return await handleApi(req, res, u.pathname);
    }
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) {
      sendJson(res, e.status || 500, { error: e.message || 'server error' });
    }
  }
});

server.listen(config.port, config.bind, () => {
  // 启动时把磁盘上遗留 running 标为 interrupted，并写回会话消息
  const orphans = jobs.reconcileOrphans((job) => {
    try {
      const text = (job.partialText || job.finalText || '').trim();
      if (text) {
        const exists = store
          .listMessages(job.sessionId, { limit: 50 })
          .some((m) => m.id === job.assistantId);
        if (!exists) {
          store.appendMessage(job.sessionId, {
            id: job.assistantId || newId(),
            role: 'assistant',
            content: text + '\n\n（服务重启，任务中断）',
            meta: { ok: false, jobId: job.id, status: 'interrupted' },
          });
        }
      }
      store.updateSession(job.sessionId, { status: 'idle', activeJobId: null });
    } catch (e) {
      console.error('[reconcile]', e);
    }
  });
  if (orphans.length) {
    console.log(`[claude-phone-chat] reconciled ${orphans.length} orphan job(s)`);
  }
  console.log(
    `[claude-phone-chat] http://${config.bind}:${config.port} workDir=${config.workDir} mode=${config.defaultPermissionMode} bg=${config.defaultBackground}`
  );
});

function shutdown(signal) {
  console.log(`[claude-phone-chat] ${signal}, shutting down`);
  // 优雅：把 running job 标 interrupted 并尽量保留 partial
  for (const [sessionId, live] of activeTurns) {
    try {
      const job = live.jobId ? jobs.get(live.jobId) : null;
      if (job && job.status === 'running') {
        jobs.update(job.id, {
          status: 'interrupted',
          error: 'shutdown',
          finalText: job.partialText || '',
        });
      }
      live.turn.abort('shutdown');
    } catch {
      /* ignore */
    }
    activeTurns.delete(sessionId);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
