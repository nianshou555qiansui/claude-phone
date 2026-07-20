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
const {
  LOCAL_COMMANDS,
  commandSummary,
  resolveLocalCommand,
} = require('./lib/commands');
const { JobStore } = require('./lib/jobs');
const {
  getSettingsView,
  updateSettings,
  settingsPath,
} = require('./lib/settings-editor');
const {
  buildModelCatalog,
  resolveModelForCli,
  setDefaultModel,
  addCustomModel,
  removeCustomModel,
} = require('./lib/models');
const {
  listImportableSessions,
  findSessionFile,
  inspectSessionFile,
  extractChatHistory,
  isInternalBubbleContent,
} = require('./lib/session-import');

const store = new ChatStore();
const jobs = new JobStore();
const publicDir = path.join(ROOT, 'public');

const activeTurns = new Map(); // sessionId -> { turn, jobId }
const subscribers = new Map(); // sessionId -> Set<res>
const sessionModels = new Map(); // sessionId -> model override for next turn(s)
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

/** @param {string} [lang] 'zh' | 'en' — default zh for backward compatibility */
function requestLang(req) {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const q = (url.searchParams.get('lang') || '').toLowerCase();
    if (q === 'en' || q.startsWith('en-')) return 'en';
    if (q === 'zh' || q.startsWith('zh')) return 'zh';
  } catch {
    /* ignore */
  }
  const al = String(req.headers['accept-language'] || '').toLowerCase();
  // First tag wins (e.g. "en-US,en;q=0.9,zh;q=0.8")
  const primary = al.split(',')[0] || '';
  if (primary.startsWith('en')) return 'en';
  if (primary.startsWith('zh')) return 'zh';
  if (al.includes('en') && !al.includes('zh')) return 'en';
  return 'zh';
}

function modeLabel(id, lang) {
  const m = normalizePermissionMode(id);
  const zh = {
    default: '默认',
    acceptEdits: '接受编辑',
    plan: '仅计划',
    auto: '自动',
    bypassPermissions: '全部放行',
    dontAsk: '仅白名单',
    manual: '默认', // 兼容旧值
  };
  const en = {
    default: 'Default',
    acceptEdits: 'Accept edits',
    plan: 'Plan only',
    auto: 'Auto',
    bypassPermissions: 'Bypass permissions',
    dontAsk: 'Allowlist only',
    manual: 'Default',
  };
  const table = lang === 'en' ? en : zh;
  return table[m] || m;
}

function modeHint(id, lang) {
  const m = normalizePermissionMode(id);
  const zh = {
    default:
      '非交互默认：未在 allow 列表的工具会被拒或受限；网页无法弹窗点确认',
    acceptEdits: '自动接受工作区内文件编辑与常见文件系统命令',
    plan: '只读探索，不改源码（适合先想方案）',
    auto: '自动模式（需 CLI 支持；否则可能失败）',
    bypassPermissions: '跳过权限提示（危险，仅限自己服务器）',
    dontAsk: '未在 permissions.allow 里的工具一律拒绝',
    manual: '同默认（-p 下无法真正手动点确认）',
  };
  const en = {
    default:
      'Non-interactive default: tools not on the allow list are denied or limited; no approval prompts on the web',
    acceptEdits:
      'Auto-accept file edits and common filesystem commands in the workspace',
    plan: 'Read-only exploration; avoid editing source',
    auto: 'Auto mode (requires CLI support; may fail otherwise)',
    bypassPermissions: 'Skip permission prompts (dangerous — own server only)',
    dontAsk: 'Deny any tool not listed in permissions.allow',
    manual: 'Same as default (-p cannot show real manual prompts)',
  };
  const table = lang === 'en' ? en : zh;
  return table[m] || '';
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
        const mid = String(cmd.payload.model).trim();
        sessionModels.set(sessionId, mid === 'default' ? null : mid);
        store.updateSession(sessionId, {
          sessionModel: mid === 'default' ? null : mid,
        });
        const msg = systemReply(
          sessionId,
          `本会话模型已设为: ${mid}\n下一条消息起生效。可用网页「模型」按钮改默认或浏览目录。`
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
        broadcast(sessionId, {
          type: 'session_updated',
          session: store.getSession(sessionId),
        });
        return { stopClaude: true };
      }
      const msg = systemReply(
        sessionId,
        '请点击顶部模型按钮打开选择器，或使用 /model <id>。'
      );
      broadcast(sessionId, { type: 'system_message', message: msg });
      broadcast(sessionId, { type: 'open_model_picker' });
      return { stopClaude: true };
    }
    case 'resume': {
      // 无参数：前端打开导入 sheet；有参数：尝试按 id 导入并切换
      if (!cmd.payload.claudeSessionId) {
        const msg = systemReply(
          sessionId,
          '打开本机会话列表：侧栏「导入本机会话」，或命令 /resume。'
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
        broadcast(sessionId, { type: 'open_resume_picker' });
        return { stopClaude: true, openResumePicker: true };
      }
      try {
        const result = importCliSession({
          claudeSessionId: cmd.payload.claudeSessionId,
          permissionMode: session.permissionMode,
        });
        const msg = systemReply(
          sessionId,
          result.already
            ? `该 CLI 会话已绑定网页对话「${result.session.title}」，请在侧栏切换。`
            : `已导入 CLI 会话到「${result.session.title}」。请在侧栏打开该对话后继续发送。`
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
        broadcast(sessionId, {
          type: 'session_imported',
          session: result.session,
          already: !!result.already,
        });
        return {
          stopClaude: true,
          importedSession: result.session,
          already: !!result.already,
        };
      } catch (e) {
        const msg = systemReply(
          sessionId,
          `导入失败: ${e.message || e}`
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
        return { stopClaude: true };
      }
    }
    case 'sync': {
      if (!session.claudeSessionId) {
        const msg = systemReply(
          sessionId,
          '当前对话未绑定 CLI session。请先用 /resume 导入本机会话。'
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
        return { stopClaude: true };
      }
      const result = syncCliHistoryToWeb(session, {
        force: true,
        announce: true,
      });
      if (result.message) {
        broadcast(sessionId, { type: 'system_message', message: result.message });
      } else {
        const msg = systemReply(
          sessionId,
          result.appended
            ? `已同步 ${result.appended} 条。`
            : result.fileFound
              ? '已是最新，无新消息。'
              : '未找到对应 CLI transcript 文件。'
        );
        broadcast(sessionId, { type: 'system_message', message: msg });
      }
      if (result.appended > 0) {
        broadcast(sessionId, {
          type: 'history_synced',
          appended: result.appended,
          messages: listVisibleMessages(sessionId),
          session: result.session,
        });
      }
      return { stopClaude: true, synced: true, appended: result.appended || 0 };
    }
    default:
      return { stopClaude: false, passThrough: true };
  }
}

// 防止同一 claudeSessionId 并发 POST 导入成多条网页会话
const importLocks = new Set();
// 打开会话时增量同步节流（ms）
const syncThrottle = new Map(); // webSessionId -> lastSyncAt
const SYNC_THROTTLE_MS = 3000;
// 同一网页会话同步互斥（防并发 GET 双写重复气泡）
const syncLocks = new Set();

function messageFingerprint(m) {
  if (!m) return '';
  const meta = m.meta || {};
  if (meta.cliUuid) return `cli:${meta.cliUuid}`;
  const content = String(m.content || '');
  // 用完整内容 hash 降低碰撞（避免仅 head 相同误判）
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return `${m.role}|${Number(m.createdAt) || 0}|${content.length}|${h}`;
}

/** 内容指纹：用于「网页已发 再试试，CLI 又记一条」去重 */
function contentFingerprint(m) {
  if (!m || !m.role) return '';
  const content = normalizeBubbleText(m.content);
  if (!content) return '';
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return `${m.role}|c:${content.length}|${h}`;
}

function normalizeBubbleText(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * 网页 turn 已落完整 assistant 后，CLI transcript 常再写出：
 * - 同文案 user/assistant
 * - 被拆成多条的 assistant 碎片（短前缀 + 近似全文）
 * - 仅空白/标点差异的近重复
 * 用于 sync 写入前与展示折叠。
 */
function isNearDuplicateContent(existingText, candidateText) {
  const a = normalizeBubbleText(existingText);
  const b = normalizeBubbleText(candidateText);
  if (!a || !b) return false;
  if (a === b) return true;

  // 去 markdown 强调后再比一次（**温馨提示** vs 温馨提示）
  const stripMd = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const am = stripMd(a);
  const bm = stripMd(b);
  if (am && bm && am === bm) return true;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  const shortM = short.length <= am.length && short.length <= bm.length
    ? stripMd(short)
    : stripMd(short);
  const longM = stripMd(long);

  // 短句：要求几乎全等（避免「好」误伤）
  if (short.length < 20) {
    return short === long || shortM === longM;
  }

  // 一方是另一方的前缀（CLI 常把首句拆成独立 assistant 行）
  // 例：完整回复 vs 「按你的要求，走联网 skill…约 4 步。」
  if (
    long.startsWith(short) ||
    longM.startsWith(shortM) ||
    long.startsWith(shortM) ||
    longM.startsWith(short)
  ) {
    // 完整一句/一行前缀：>=20 字且以句读结尾，或占比够高，或绝对长度够
    const looksLikeLeadIn =
      short.length >= 20 &&
      /[。．.!！?？：:]\s*$/.test(short);
    if (
      looksLikeLeadIn ||
      short.length >= 60 ||
      short.length / long.length >= 0.12
    ) {
      return true;
    }
  }

  // 一方是另一方的子串（网页合并正文 vs CLI 后半段）
  if (long.includes(short) || longM.includes(shortM)) {
    if (short.length >= 60 || short.length / long.length >= 0.12) return true;
  }

  // 长文前缀相同且长度接近（markdown 小差异）
  if (short.length >= 80) {
    const n = Math.min(200, shortM.length);
    if (n >= 40 && am.slice(0, n) === bm.slice(0, n)) {
      const ratio =
        Math.min(am.length, bm.length) / Math.max(am.length, bm.length);
      if (ratio >= 0.75) return true;
    }
  }

  // Jaccard on first ~40 tokens for long assistant-ish blobs
  if (Math.min(am.length, bm.length) >= 200) {
    const toks = (s) =>
      s
        .slice(0, 1200)
        .split(/[\s,，。．、；;:：!！?？\n]+/)
        .filter((x) => x.length >= 2)
        .slice(0, 60);
    const ta = new Set(toks(am));
    const tb = new Set(toks(bm));
    if (ta.size && tb.size) {
      let inter = 0;
      for (const x of ta) if (tb.has(x)) inter += 1;
      const union = ta.size + tb.size - inter;
      if (union > 0 && inter / union >= 0.72) return true;
    }
  }
  return false;
}

function isNearDuplicateOfExisting(existingMsgs, candidate) {
  if (!candidate || !candidate.role) return false;
  const cand = normalizeBubbleText(candidate.content);
  if (!cand) return true;
  for (const m of existingMsgs) {
    if (!m || m.role !== candidate.role) continue;
    if (isNearDuplicateContent(m.content, candidate.content)) return true;
  }
  return false;
}

/**
 * 对外展示用消息列表：
 * 1) 隐藏 CLI 内部注入（skill / system-reminder 等）
 * 2) 折叠近重复气泡（优先保留非 cli-transcript / 更长的一条）
 * 不删磁盘，只过滤 API / SSE 可见集合。
 */
function listVisibleMessages(sessionId, limit) {
  const all = store.listMessages(sessionId, {
    limit: Math.max(limit || 500, 500),
  });
  const filtered = all.filter(
    (m) => m && !isInternalBubbleContent(m.role, m.content)
  );
  const out = [];
  for (const m of filtered) {
    let dupIdx = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i].role !== m.role) continue;
      if (isNearDuplicateContent(out[i].content, m.content)) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) {
      out.push(m);
      continue;
    }
    // 已有近似条：保留「更好」的一条
    const prev = out[dupIdx];
    const prevImp = !!(prev.meta && prev.meta.source === 'cli-transcript');
    const curImp = !!(m.meta && m.meta.source === 'cli-transcript');
    const prevLen = String(prev.content || '').length;
    const curLen = String(m.content || '').length;
    // 优先网页原生（非 import）；否则留更长
    const preferCur =
      (prevImp && !curImp) ||
      (prevImp === curImp && curLen > prevLen + 20);
    if (preferCur) out[dupIdx] = m;
  }
  return out;
}

function pruneSyncThrottle(now) {
  if (syncThrottle.size < 80) return;
  for (const [k, t] of syncThrottle) {
    if (now - t > 60000) syncThrottle.delete(k);
  }
}

/**
 * 将 CLI transcript 中尚未出现在网页的 user/assistant 气泡增量写入。
 * 不删除、不改写已有消息（含网页本地发送的）。
 *
 * @returns {{ ok:boolean, appended:number, skipped?:boolean, fileFound:boolean, historyCount:number, historyTruncated:boolean, backfilled:boolean, message:object|null, session:object }}
 */
function syncCliHistoryToWeb(session, { force = false, announce = false } = {}) {
  const empty = {
    ok: false,
    appended: 0,
    fileFound: false,
    historyCount: 0,
    historyTruncated: false,
    backfilled: false,
    message: null,
    session: session || null,
  };
  if (!session || !session.id || !session.claudeSessionId) {
    return { ...empty, reason: 'no_cli_session' };
  }
  if (!isSessionId(session.id) || !isSessionId(session.claudeSessionId)) {
    return { ...empty, reason: 'bad_id' };
  }

  // 会话正在生成时不要自动/强制扫盘写入，避免与 turn 追加交错
  if (activeTurns.has(session.id) || jobs.findRunningBySession(session.id)) {
    let count = 0;
    try {
      count = store
        .listMessages(session.id, { limit: 1000 })
        .filter((m) => m.role === 'user' || m.role === 'assistant').length;
    } catch {
      /* ignore */
    }
    return {
      ...empty,
      ok: true,
      skipped: true,
      reason: 'busy',
      fileFound: true,
      historyCount: count,
      session,
    };
  }

  const now = Date.now();
  if (
    !force &&
    syncThrottle.has(session.id) &&
    now - (syncThrottle.get(session.id) || 0) < SYNC_THROTTLE_MS
  ) {
    let count = 0;
    try {
      count = store
        .listMessages(session.id, { limit: 1000 })
        .filter((m) => m.role === 'user' || m.role === 'assistant').length;
    } catch {
      /* ignore */
    }
    return {
      ...empty,
      ok: true,
      skipped: true,
      reason: 'throttled',
      fileFound: true,
      historyCount: count,
      session,
    };
  }

  if (syncLocks.has(session.id)) {
    return {
      ...empty,
      ok: true,
      skipped: true,
      reason: 'in_progress',
      fileFound: true,
      session,
    };
  }
  syncLocks.add(session.id);

  try {
    const file = findSessionFile(session.claudeSessionId);
    if (!file) {
      syncThrottle.set(session.id, Date.now());
      pruneSyncThrottle(Date.now());
      return { ...empty, ok: true, reason: 'file_missing', session };
    }

    let hist;
    try {
      hist = extractChatHistory(file, {
        maxMessages: 200,
        maxCharsPerMsg: 80000,
      });
    } catch (e) {
      return {
        ...empty,
        ok: false,
        fileFound: true,
        reason: e.message || 'extract_failed',
        session,
      };
    }

    let existingMsgs = [];
    try {
      existingMsgs = store.listMessages(session.id, { limit: 2000 });
    } catch {
      existingMsgs = [];
    }
    const seen = new Set();
    const seenContent = new Set();
    // 仅用「可见」消息做近重复基准，避免被已隐藏脏行干扰
    const existingVisible = existingMsgs.filter(
      (m) =>
        m &&
        (m.role === 'user' || m.role === 'assistant') &&
        !isInternalBubbleContent(m.role, m.content)
    );
    for (const m of existingMsgs) {
      const k = messageFingerprint(m);
      if (k) seen.add(k);
      // 网页已有「再试试」时，CLI 同文案 user 行不要再灌一条
      const ck = contentFingerprint(m);
      if (ck) seenContent.add(ck);
    }

    const fresh = [];
    // 同步批次内也可能自重复（CLI 拆条）
    const batchVisible = existingVisible.slice();
    for (const m of hist.messages || []) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      // 二次过滤：extract 已 skip，防旧逻辑/边界漏网
      if (isInternalBubbleContent(m.role, m.content)) continue;
      const k = messageFingerprint(m);
      if (!k || seen.has(k)) continue;
      const ck = contentFingerprint(m);
      if (ck && seenContent.has(ck)) continue;
      // 近重复：网页完整回复 vs CLI 碎片/近似全文
      if (isNearDuplicateOfExisting(batchVisible, m)) continue;
      fresh.push(m);
      seen.add(k);
      if (ck) seenContent.add(ck);
      batchVisible.push(m);
    }

    const priorChat = existingMsgs.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        !isInternalBubbleContent(m.role, m.content)
    ).length;

    if (!fresh.length) {
      // 扫描成功且无新消息：记节流
      syncThrottle.set(session.id, Date.now());
      pruneSyncThrottle(Date.now());
      return {
        ok: true,
        appended: 0,
        fileFound: true,
        historyCount: priorChat,
        historyTruncated: !!hist.truncated,
        backfilled: false,
        message: null,
        session: store.getSession(session.id) || session,
      };
    }

    // 单次写入量保护
    const toWrite = fresh.length > 300 ? fresh.slice(-300) : fresh;

    try {
      store.appendMessages(session.id, toWrite);
    } catch (e) {
      // 写入失败不记节流，允许立刻重试
      return {
        ...empty,
        ok: false,
        fileFound: true,
        reason: e.message || 'write_failed',
        historyCount: priorChat,
        session,
      };
    }

    syncThrottle.set(session.id, Date.now());
    pruneSyncThrottle(Date.now());

    let message = null;
    if (announce) {
      message = systemReply(
        session.id,
        `已从 CLI 同步 ${toWrite.length} 条新消息${
          hist.truncated ? '（transcript 仅取尾部/最近段）' : ''
        }。`,
        {
          synced: true,
          appended: toWrite.length,
          claudeSessionId: session.claudeSessionId,
        }
      );
    }

    const nextSession = store.getSession(session.id) || session;
    return {
      ok: true,
      appended: toWrite.length,
      fileFound: true,
      historyCount: priorChat + toWrite.length,
      historyTruncated: !!hist.truncated,
      backfilled: true,
      message,
      session: nextSession,
    };
  } finally {
    syncLocks.delete(session.id);
  }
}

/** @deprecated 名称保留：现为增量同步（空会话=全量灌入） */
function maybeBackfillImportedHistory(session, claudeSessionId) {
  const s =
    session && session.claudeSessionId
      ? session
      : session
        ? { ...session, claudeSessionId: claudeSessionId || session.claudeSessionId }
        : null;
  if (s && claudeSessionId && !s.claudeSessionId) {
    s.claudeSessionId = claudeSessionId;
  }
  const r = syncCliHistoryToWeb(s, { force: true, announce: false });
  return {
    session: r.session,
    message: r.message,
    fileFound: r.fileFound,
    historyCount: r.historyCount,
    historyTruncated: r.historyTruncated,
    backfilled: !!r.appended,
  };
}

/**
 * 导入（或复用）一条本机 Claude CLI 会话为网页会话。
 * @returns {{ session: object, already: boolean, message: object|null, fileFound?: boolean }}
 */
function importCliSession({
  claudeSessionId,
  workDir,
  title,
  permissionMode,
  skipSystemMessage,
} = {}) {
  const sid = String(claudeSessionId || '').trim();
  if (!isSessionId(sid)) {
    const err = new Error('invalid claudeSessionId');
    err.code = 'BAD_ID';
    throw err;
  }

  if (importLocks.has(sid)) {
    const err = new Error('同一会话正在导入，请稍候');
    err.code = 'BUSY';
    throw err;
  }
  importLocks.add(sid);

  try {
    const existing = store.findByClaudeSessionId(sid);
    if (existing) {
      // 已绑定：增量同步（含旧版空历史补灌 + 新消息追加）
      const filled = syncCliHistoryToWeb(
        { ...existing, claudeSessionId: sid },
        { force: true, announce: false }
      );
      return {
        session: filled.session || existing,
        already: true,
        message: filled.message,
        fileFound: filled.fileFound,
        historyCount: filled.historyCount,
        historyTruncated: filled.historyTruncated,
        backfilled: !!filled.appended,
        appended: filled.appended || 0,
      };
    }

    // 尽量从磁盘补全 cwd / 标题；找不到文件仍允许绑定 id（用户可能知道 id）
    let meta = null;
    let fileFound = false;
    const file = findSessionFile(sid);
    if (file) {
      fileFound = true;
      try {
        meta = inspectSessionFile(file);
      } catch {
        meta = null;
      }
    }

    let wd = workDir || (meta && meta.workDir) || config.workDir;
    try {
      wd = path.resolve(String(wd));
      if (!fs.existsSync(wd) || !fs.statSync(wd).isDirectory()) {
        wd = config.workDir;
      }
    } catch {
      wd = config.workDir;
    }

    const safeTitle = String(
      title || (meta && meta.title) || `CLI ${sid.slice(0, 8)}`
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    // 交互式 CLI 会话（entrypoint=cli）无法用 claude -p --resume；
    // 仍导入历史气泡，但不绑定 active resume，改为 history inject 续聊。
    const resumeSupported = !meta || meta.resumeSupported !== false;
    const session = store.createSession({
      title: safeTitle || `CLI ${sid.slice(0, 8)}`,
      workDir: wd,
      permissionMode: permissionMode || config.defaultPermissionMode,
      claudeSessionId: resumeSupported ? sid : null,
      importedClaudeSessionId: sid,
      source: 'cli-import',
      needsHistoryInject: !resumeSupported,
    });
    if (!resumeSupported) {
      store.updateSession(session.id, {
        resumeMode: 'history-inject',
        entrypoint: (meta && meta.entrypoint) || 'cli',
      });
      session.resumeMode = 'history-inject';
      session.entrypoint = (meta && meta.entrypoint) || 'cli';
    }

    // 极端并发下若仍产生重复，丢掉后来者，复用先到的
    const winner = store.findByClaudeSessionId(sid);
    if (winner && winner.id !== session.id) {
      try {
        store.deleteSession(session.id);
      } catch {
        /* ignore */
      }
      const filled = maybeBackfillImportedHistory(winner, sid);
      return {
        session: filled.session,
        already: true,
        message: filled.message,
        fileFound: filled.fileFound,
        historyCount: filled.historyCount || 0,
        historyTruncated: !!filled.historyTruncated,
        backfilled: !!filled.backfilled,
      };
    }

    // 从 CLI transcript 灌入可见气泡（user/assistant 文本）
    let historyInfo = {
      count: 0,
      truncated: false,
      fileFound,
    };
    if (file && fileFound) {
      try {
        const hist = extractChatHistory(file, {
          maxMessages: 200,
          maxCharsPerMsg: 80000,
        });
        if (hist.messages && hist.messages.length) {
          try {
            store.appendMessages(session.id, hist.messages);
            historyInfo = {
              count: hist.messages.length,
              truncated: !!hist.truncated,
              fileFound: true,
              scanned: hist.scanned,
            };
          } catch (writeErr) {
            historyInfo.error =
              '写入历史失败: ' + (writeErr.message || writeErr);
          }
        }
      } catch (e) {
        historyInfo.error = e.message || String(e);
      }
    }

    let message = null;
    if (!skipSystemMessage) {
      const lines = [
        `已接入本机 Claude 会话 \`${sid}\`。`,
        `工作目录: ${session.workDir}`,
        historyInfo.count
          ? `已载入历史气泡: ${historyInfo.count} 条${
              historyInfo.truncated ? '（仅最近部分，更早的已截断）' : ''
            }`
          : fileFound
            ? '未从 transcript 解析到可展示的 user/assistant 文本。'
            : null,
        fileFound
          ? null
          : '注意：未在 ~/.claude/projects 找到对应 .jsonl。',
        historyInfo.error ? `历史导入警告: ${historyInfo.error}` : null,
        '',
        resumeSupported
          ? '下一条消息将通过 `--resume` 继续该 CLI 上下文。'
          : '这是**交互式终端会话**（entrypoint=cli）。当前 Claude Code 的 `claude -p --resume` 无法接续此类会话。\n' +
            '已改为：用网页历史注入方式继续聊（不绑定 --resume），避免发消息直接失败。\n' +
            '若要完整接续，请在本机终端里打开该对话。',
      ].filter((x) => x != null);
      message = systemReply(session.id, lines.join('\n'), {
        imported: true,
        claudeSessionId: sid,
        fileFound,
        historyCount: historyInfo.count,
        historyTruncated: !!historyInfo.truncated,
        resumeSupported,
      });
    }

    return {
      session: store.getSession(session.id) || session,
      already: false,
      message,
      fileFound,
      historyCount: historyInfo.count,
      historyTruncated: !!historyInfo.truncated,
      resumeSupported,
    };
  } finally {
    importLocks.delete(sid);
  }
}

function startClaudeTurn(session, userText, assistantId, { background = true } = {}) {
  const sessionId = session.id;
  const mode = normalizePermissionMode(
    session.permissionMode || config.defaultPermissionMode
  );

  let prompt = userText;
  let resume = session.claudeSessionId || null;

  // rewind/clear 后需要注入历史；有有效 resume 时不要把导入的大段气泡再塞进 prompt
  if (session.needsHistoryInject || !resume) {
    // 导入会话可能有上百条气泡：注入时再收紧，避免撑爆 prompt
    // listMessages 是「末尾 limit 条」，不是全文再截断
    const injectLimit =
      session.source === 'cli-import' || session.claudeSessionId ? 80 : 200;
    const hist = store
      .listMessages(sessionId, { limit: injectLimit })
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') &&
          !isInternalBubbleContent(m.role, m.content)
      );
    // 去掉刚写入的本轮 user（内容相同的最后一条），避免重复塞进摘要
    let prior = hist.slice();
    if (prior.length) {
      const last = prior[prior.length - 1];
      if (
        last &&
        last.role === 'user' &&
        String(last.content || '').trim() === String(userText || '').trim()
      ) {
        prior = prior.slice(0, -1);
      }
    }
    if (prior.length) {
      prompt = buildHistoryPrompt(prior, userText);
      resume = null;
    }
  }

  // 会话级模型覆盖（可多轮保持，直到改回 default 或清会话）
  const sessionModelSel =
    sessionModels.has(sessionId)
      ? sessionModels.get(sessionId)
      : session.sessionModel || null;
  const model = resolveModelForCli(sessionModelSel);

  const job = jobs.create({
    sessionId,
    userText,
    assistantId,
    background,
    workDir: session.workDir || config.workDir,
    permissionMode: mode,
  });
  jobs.update(job.id, {
    model: sessionModelSel || null,
    cliModel: model,
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
  /** @type {Array<{id:string|null,name:string,phase:string,input?:any,result?:any,isError?:boolean,ts:number}>} */
  const toolTimeline = [];
  const TOOL_TIMELINE_MAX = 80;
  let toolOverflow = 0;
  let lastToolPersist = 0;

  function upsertToolStep(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const phase = payload.phase === 'result' ? 'result' : 'start';
    const id = payload.id ? String(payload.id).slice(0, 80) : null;
    const name = String(payload.name || 'tool').slice(0, 120);
    const ts = Number(payload.ts) || Date.now();
    let step = null;
    if (id) {
      step = toolTimeline.find((t) => t.id === id);
    }
    if (!step && phase === 'result' && !id) {
      // match last running step with same name
      for (let i = toolTimeline.length - 1; i >= 0; i--) {
        const t = toolTimeline[i];
        if (t.phase !== 'result' && t.name === name) {
          step = t;
          break;
        }
      }
    }
    if (!step) {
      if (toolTimeline.length >= TOOL_TIMELINE_MAX) {
        toolOverflow += 1;
        // drop oldest completed first, else oldest
        let dropIdx = toolTimeline.findIndex((t) => t.phase === 'result');
        if (dropIdx < 0) dropIdx = 0;
        toolTimeline.splice(dropIdx, 1);
      }
      step = {
        id,
        name,
        phase: phase === 'result' ? 'result' : 'running',
        input: phase === 'start' ? payload.input : undefined,
        result: phase === 'result' ? payload.result : undefined,
        isError: phase === 'result' ? !!payload.isError : false,
        ts,
        endedAt: phase === 'result' ? ts : null,
      };
      toolTimeline.push(step);
    } else {
      if (payload.name) step.name = name;
      if (phase === 'start' && payload.input !== undefined) step.input = payload.input;
      if (phase === 'result') {
        step.phase = 'result';
        step.result = payload.result;
        step.isError = !!payload.isError;
        step.endedAt = ts;
      } else if (step.phase !== 'result') {
        step.phase = 'running';
      }
    }
    return {
      ...step,
      overflow: toolOverflow,
      count: toolTimeline.length,
    };
  }

  function persistTools(force) {
    const now = Date.now();
    if (!force && now - lastToolPersist < 600) return;
    lastToolPersist = now;
    // Shallow copy steps; payloads already size-capped in runner
    const snap = toolTimeline.map((s) => ({
      id: s.id,
      name: s.name,
      phase: s.phase,
      input: s.input,
      result: s.result,
      isError: !!s.isError,
      ts: s.ts,
      endedAt: s.endedAt || null,
    }));
    jobs.update(job.id, {
      tools: snap,
      toolOverflow,
    });
  }

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

  turn.on('meta', (meta) => {
    if (meta && meta.model) {
      jobs.update(job.id, { cliModel: meta.model });
      broadcast(sessionId, {
        type: 'hud',
        model: meta.model,
        permissionMode: mode,
      });
    }
  });

  turn.on('usage', (usage) => {
    if (!usage) return;
    // 忽略 stream 占位 0/0，避免 HUD Context 被冲成 0%
    const meaningful =
      (Number(usage.inputTokens) || 0) > 0 ||
      (Number(usage.outputTokens) || 0) > 0 ||
      (Number(usage.cacheReadInputTokens) || 0) > 0 ||
      (Number(usage.cacheCreationInputTokens) || 0) > 0 ||
      (Number(usage.contextUsed) || 0) > 0;
    if (!meaningful) {
      // 仍可带 model 名更新
      if (usage.model) {
        jobs.update(job.id, { cliModel: usage.model });
        broadcast(sessionId, {
          type: 'hud',
          model: usage.model,
          permissionMode: mode,
        });
      }
      return;
    }
    jobs.update(job.id, { usage, cliModel: usage.model || undefined });
    broadcast(sessionId, {
      type: 'hud',
      usage,
      model: usage.model || null,
      permissionMode: mode,
    });
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
    const step = upsertToolStep(tool);
    if (!step) return;
    persistTools(false);
    broadcast(sessionId, {
      type: 'tool',
      messageId: assistantId,
      jobId: job.id,
      tool: {
        phase: tool && tool.phase === 'result' ? 'result' : 'start',
        id: step.id,
        name: step.name,
        input: step.input,
        result: step.result,
        isError: !!step.isError,
        ts: step.ts,
        endedAt: step.endedAt || null,
        count: step.count,
        overflow: step.overflow,
      },
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

  turn.on('done', ({
    ok,
    assistantText,
    claudeSessionId,
    usage,
    model,
    durationMs,
    errorMessage,
    resultIsError,
  }) => {
    const live = activeTurns.get(sessionId);
    if (live && live.jobId === job.id) activeTurns.delete(sessionId);
    jobs.unbindLive(job.id);

    const currentJob = jobs.get(job.id);
    const rawErr = (
      errorMessage ||
      currentJob?.error ||
      ''
    )
      .toString()
      .trim();

    // abort/shutdown 原因码 → 人话（不要显示「CLI 失败：user」）
    const ABORT_LABELS = {
      user: '已停止生成',
      delete: '对话已删除，任务已取消',
      foreground_disconnect: '前台模式：页面断开，任务已停止',
      shutdown: '服务重启，任务已中断',
      timeout: '生成超时已中止',
    };
    const isAbortCode = Object.prototype.hasOwnProperty.call(
      ABORT_LABELS,
      rawErr
    );
    const errText = isAbortCode ? '' : rawErr;

    // resume 找不到会话：清掉无效绑定，避免下次再撞同一错误
    const resumeMissing =
      /no conversation found with session id/i.test(rawErr) ||
      (/session id:?\s*[0-9a-f-]{36}/i.test(rawErr) &&
        /not found|no conversation/i.test(rawErr));

    let displayText = (assistantText || acc || '').trim();
    if (!ok && !displayText) {
      if (resumeMissing) {
        displayText =
          `无法继续本机 CLI 会话（--resume 失败）。\n` +
          `${rawErr || 'No conversation found with that session ID'}\n\n` +
          `可能原因：CLI 已结束该会话、transcript 损坏/过大，或当前 Claude Code 版本无法 resume 该 id。\n` +
          `已断开此网页对话与该 CLI id 的绑定；请 /resume 重新导入，或开新对话继续。`;
      } else if (isAbortCode) {
        displayText = ABORT_LABELS[rawErr];
      } else if (errText) {
        displayText = `CLI 失败：${errText}`;
      } else {
        displayText = '（无输出或已中断）';
      }
    }

    const alreadyTerminal =
      currentJob &&
      ['cancelled', 'interrupted'].includes(currentJob.status) &&
      !ok;

    const finalStatus = alreadyTerminal
      ? currentJob.status
      : ok
        ? 'done'
        : 'failed';

    const pickMeaningfulUsage = (u) => {
      if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
      const meaningful =
        (Number(u.inputTokens) || 0) > 0 ||
        (Number(u.outputTokens) || 0) > 0 ||
        (Number(u.cacheReadInputTokens) || 0) > 0 ||
        (Number(u.cacheCreationInputTokens) || 0) > 0 ||
        (Number(u.contextUsed) || 0) > 0;
      return meaningful ? u : null;
    };
    const usageFinal =
      pickMeaningfulUsage(usage) ||
      pickMeaningfulUsage(currentJob?.usage) ||
      null;
    const modelFinal =
      (model && String(model).slice(0, 200)) ||
      currentJob?.cliModel ||
      null;
    const durationFinal =
      durationMs != null && Number.isFinite(Number(durationMs))
        ? Math.max(0, Math.floor(Number(durationMs)))
        : null;

    // finalize any still-running tool steps as interrupted
    for (const t of toolTimeline) {
      if (t.phase !== 'result') {
        t.phase = ok ? 'result' : 'interrupted';
        t.endedAt = t.endedAt || Date.now();
        if (!ok && t.isError == null) t.isError = false;
      }
    }
    persistTools(true);

    jobs.update(job.id, {
      status: finalStatus,
      partialText: displayText,
      finalText: displayText,
      claudeSessionId: claudeSessionId || currentJob?.claudeSessionId || null,
      error: ok
        ? null
        : isAbortCode
          ? rawErr
          : errText || currentJob?.error || 'failed',
      usage: usageFinal,
      cliModel: modelFinal,
      durationMs: durationFinal,
      tools: toolTimeline.slice(),
      toolOverflow,
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
        content: displayText,
        meta: {
          ok,
          claudeSessionId,
          jobId: job.id,
          background: !!background,
          status: finalStatus,
          usage: usageFinal,
          model: modelFinal,
          durationMs: durationFinal,
          error: ok ? null : isAbortCode ? rawErr : errText || null,
          resultIsError: !!resultIsError,
          resumeMissing: !!resumeMissing,
          aborted: isAbortCode ? rawErr : null,
          tools: toolTimeline.slice(),
          toolOverflow,
        },
      });
    } else {
      // 已有气泡（极少）：尽量把 tools 补进内存对象，供 SSE 客户端展示
      assistantMsg = existing;
      if (assistantMsg && assistantMsg.meta && toolTimeline.length) {
        assistantMsg = {
          ...assistantMsg,
          meta: {
            ...assistantMsg.meta,
            tools: toolTimeline.slice(),
            toolOverflow,
          },
        };
      }
    }

    if (resumeMissing) {
      const cur = store.getSession(sessionId) || {};
      // 保留 importedClaudeSessionId 供导入去重；只清 active resume
      store.updateSession(sessionId, {
        claudeSessionId: null,
        importedClaudeSessionId:
          cur.importedClaudeSessionId || claudeSessionId || null,
        needsHistoryInject: true,
        status: 'idle',
        activeJobId: null,
      });
      const note = systemReply(
        sessionId,
        '已清除无效的 CLI resume 绑定（仍保留导入记录，不会重复建侧栏项）。\n' +
          '可用侧栏打开已有「claude phone」对话继续（将用网页历史注入，不再 --resume 该死 id）；\n' +
          '或「＋ 新对话」开一条全新会话。',
        { resumeCleared: true }
      );
      broadcast(sessionId, { type: 'system_message', message: note });
      broadcast(sessionId, {
        type: 'session_updated',
        session: store.getSession(sessionId),
      });
    }

    // 会话级 HUD 快照（供重开显示；只写白名单字段）
    const hudPatch = {};
    if (usageFinal) {
      hudPatch.lastUsage = {
        inputTokens: usageFinal.inputTokens || 0,
        outputTokens: usageFinal.outputTokens || 0,
        cacheReadInputTokens: usageFinal.cacheReadInputTokens || 0,
        cacheCreationInputTokens: usageFinal.cacheCreationInputTokens || 0,
        contextUsed: usageFinal.contextUsed || 0,
        contextWindow: usageFinal.contextWindow || 0,
        contextPct: usageFinal.contextPct,
        model: usageFinal.model || null,
      };
    }
    if (modelFinal) hudPatch.lastCliModel = modelFinal;
    if (durationFinal != null) hudPatch.lastTurnDurationMs = durationFinal;

    // resume 已清除时不要再写回旧 claudeSessionId
    const sessionPatch = {
      status: 'idle',
      activeJobId: null,
      ...hudPatch,
    };
    if (!resumeMissing && claudeSessionId) {
      sessionPatch.claudeSessionId = claudeSessionId;
      sessionPatch.needsHistoryInject = false;
    }
    store.updateSession(sessionId, sessionPatch);

    broadcast(sessionId, {
      type: 'assistant_done',
      message: assistantMsg,
      ok,
      jobId: job.id,
      job: jobs.get(job.id),
      usage: usageFinal,
      model: modelFinal,
      durationMs: durationFinal,
    });
    broadcast(sessionId, {
      type: 'hud',
      usage: usageFinal,
      model: modelFinal,
      durationMs: durationFinal,
      permissionMode: mode,
      sessionStartedAt: session.createdAt || null,
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
    const lang = requestLang(req);
    return sendJson(res, 200, {
      workDir: config.workDir,
      defaultPermissionMode: config.defaultPermissionMode,
      defaultBackground: config.defaultBackground,
      lang,
      permissionModes: PERMISSION_MODES.map((id) => ({
        id,
        label: modeLabel(id, lang),
        hint: modeHint(id, lang),
      })),
      commands: LOCAL_COMMANDS.map((c) => ({
        id: c.id,
        aliases: c.aliases,
        summary: commandSummary(c, lang),
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

  // 模型目录与切换
  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const lang = requestLang(req);
      const catalog = buildModelCatalog(lang);
      const groups =
        lang === 'en' && catalog.groupsEn
          ? catalog.groupsEn
          : catalog.groupsZh || catalog.groups;
      return sendJson(res, 200, {
        ok: true,
        ...catalog,
        groups,
        lang,
        sessionModels: Object.fromEntries(sessionModels),
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message || 'models failed' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/models/select') {
    const body = (await readBody(req)) || {};
    const modelId = String(body.model || body.id || '').trim();
    if (!modelId) return sendJson(res, 400, { error: 'model required' });
    if (modelId.length > 200) {
      return sendJson(res, 400, { error: 'model id too long' });
    }
    // scope: default | session
    const scope = body.scope === 'session' ? 'session' : 'default';
    const sessionId = body.sessionId ? String(body.sessionId) : null;
    const lang = requestLang(req);

    try {
      if (scope === 'session') {
        if (!sessionId || !isSessionId(sessionId)) {
          return sendJson(res, 400, { error: 'sessionId required for session scope' });
        }
        const sess = store.getSession(sessionId);
        if (!sess) return sendJson(res, 404, { error: 'session not found' });
        // 运行中禁止改模型，避免与当前 turn 语义错乱
        if (activeTurns.has(sessionId) || jobs.findRunningBySession(sessionId)) {
          return sendJson(res, 409, {
            error: 'busy',
            message:
              lang === 'en'
                ? 'This chat is generating — switch model after it finishes'
                : '当前对话正在生成，请结束后再切换模型',
          });
        }
        const cliModel = resolveModelForCli(modelId);
        sessionModels.set(sessionId, modelId === 'default' ? null : modelId);
        store.updateSession(sessionId, {
          sessionModel: modelId === 'default' ? null : modelId,
        });
        const catalog = buildModelCatalog(lang);
        return sendJson(res, 200, {
          ok: true,
          scope: 'session',
          model: modelId,
          cliModel,
          sessionId,
          catalog,
        });
      }

      // permanent default
      const catalog = setDefaultModel(modelId, { lang });
      return sendJson(res, 200, {
        ok: true,
        scope: 'default',
        model: modelId,
        cliModel: resolveModelForCli(modelId),
        catalog,
      });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message || 'select failed' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/models/custom') {
    const body = (await readBody(req)) || {};
    const lang = requestLang(req);
    try {
      const catalog = addCustomModel(
        {
          id: body.id || body.model,
          label: body.label,
          model: body.model || body.id,
          description: body.description,
        },
        lang
      );
      return sendJson(res, 201, { ok: true, catalog });
    } catch (e) {
      return sendJson(res, e.status || 400, { error: e.message || 'add failed' });
    }
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/models/custom/')) {
    const id = decodeURIComponent(pathname.slice('/api/models/custom/'.length));
    const lang = requestLang(req);
    try {
      const catalog = removeCustomModel(id, lang);
      return sendJson(res, 200, { ok: true, catalog });
    } catch (e) {
      return sendJson(res, 400, { error: e.message || 'remove failed' });
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

  // 本机 CLI 会话导入（须在 /api/sessions/:id 之前匹配）
  if (req.method === 'GET' && pathname === '/api/sessions/import') {
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      const limitRaw = u.searchParams.get('limit');
      const limit = limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined;
      const data = listImportableSessions({
        limit,
        webSessions: store.listSessions(),
      });
      return sendJson(res, 200, data);
    } catch (e) {
      return sendJson(res, 500, {
        error: e.message || 'failed to scan local sessions',
      });
    }
  }

  if (req.method === 'POST' && pathname === '/api/sessions/import') {
    const body = (await readBody(req)) || {};
    try {
      const result = importCliSession({
        claudeSessionId: body.claudeSessionId,
        workDir: body.workDir,
        title: body.title,
        permissionMode: body.permissionMode,
      });
      return sendJson(res, result.already ? 200 : 201, {
        ok: true,
        already: result.already,
        session: result.session,
        message: result.message,
        fileFound: result.fileFound !== false,
        historyCount: result.historyCount || 0,
        historyTruncated: !!result.historyTruncated,
        backfilled: !!result.backfilled,
        appended: result.appended || 0,
      });
    } catch (e) {
      const code =
        e.code === 'BAD_ID' ? 400 : e.code === 'BUSY' ? 409 : 500;
      return sendJson(res, code, { error: e.message || String(e) });
    }
  }

  const sessMatch = pathname.match(/^\/api\/sessions\/([^/]+)(.*)$/);
  if (sessMatch) {
    const sessionId = decodeURIComponent(sessMatch[1]);
    const rest = sessMatch[2] || '';

    // 上面已单独处理 /api/sessions/import；此处再挡一层
    if (sessionId === 'import') {
      return sendJson(res, 404, { error: 'use /api/sessions/import' });
    }

    if (!isSessionId(sessionId)) {
      return sendJson(res, 400, { error: 'invalid session id' });
    }

    const session = store.getSession(sessionId);
    if (!session && req.method !== 'DELETE') {
      return sendJson(res, 404, { error: 'session not found' });
    }

    if (req.method === 'GET' && rest === '') {
      // 打开会话时：若绑定了 CLI session，增量同步 transcript → 网页气泡
      // 生成中跳过，避免与 turn 写消息交错
      let syncInfo = null;
      if (
        session.claudeSessionId &&
        !activeTurns.has(sessionId) &&
        !jobs.findRunningBySession(sessionId)
      ) {
        try {
          const u = new URL(req.url || '/', 'http://localhost');
          const noSync = u.searchParams.get('nosync') === '1';
          if (!noSync) {
            syncInfo = syncCliHistoryToWeb(session, {
              force: false,
              announce: false,
            });
          }
        } catch {
          syncInfo = null;
        }
      }
      const runningJob = jobs.findRunningBySession(sessionId);
      const latest = store.getSession(sessionId) || session;
      return sendJson(res, 200, {
        session: latest,
        messages: listVisibleMessages(sessionId),
        running:
          activeTurns.has(sessionId) ||
          !!(runningJob && runningJob.status === 'running'),
        activeJob: runningJob,
        jobs: jobs.list({ sessionId, includeFinished: true, limit: 20 }),
        hud: {
          model: latest.lastCliModel || latest.sessionModel || null,
          usage:
            latest.lastUsage && typeof latest.lastUsage === 'object'
              ? latest.lastUsage
              : null,
          durationMs:
            latest.lastTurnDurationMs != null &&
            Number.isFinite(Number(latest.lastTurnDurationMs))
              ? Number(latest.lastTurnDurationMs)
              : null,
          permissionMode: latest.permissionMode || null,
          sessionStartedAt: latest.createdAt || null,
        },
        sync: syncInfo
          ? {
              appended: syncInfo.appended || 0,
              skipped: !!syncInfo.skipped,
              fileFound: !!syncInfo.fileFound,
              historyCount: syncInfo.historyCount || 0,
              historyTruncated: !!syncInfo.historyTruncated,
              reason: syncInfo.reason || null,
            }
          : null,
      });
    }

    // 手动强制从 CLI transcript 增量同步
    if (req.method === 'POST' && rest === '/sync') {
      if (!session.claudeSessionId) {
        return sendJson(res, 400, {
          error: 'session has no claudeSessionId (not an imported CLI chat)',
        });
      }
      if (activeTurns.has(sessionId) || jobs.findRunningBySession(sessionId)) {
        return sendJson(res, 409, { error: 'busy' });
      }
      let result;
      try {
        result = syncCliHistoryToWeb(session, {
          force: true,
          announce: true,
        });
      } catch (e) {
        return sendJson(res, 500, {
          error: e.message || 'sync failed',
        });
      }
      if (result.message) {
        broadcast(sessionId, {
          type: 'system_message',
          message: result.message,
        });
      }
      if (result.appended > 0) {
        broadcast(sessionId, {
          type: 'history_synced',
          appended: result.appended,
          messages: listVisibleMessages(sessionId),
          session: result.session,
        });
      }
      return sendJson(res, result.ok ? 200 : 500, {
        ok: !!result.ok,
        appended: result.appended || 0,
        skipped: !!result.skipped,
        fileFound: !!result.fileFound,
        historyCount: result.historyCount || 0,
        historyTruncated: !!result.historyTruncated,
        session: result.session,
        message: result.message,
        reason: result.reason || null,
        error: result.ok ? undefined : result.reason || 'sync failed',
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
      // 展示过滤：回退结果也走 listVisibleMessages，避免把磁盘脏行重新铺回前端
      const visible = listVisibleMessages(sessionId);
      broadcast(sessionId, {
        type: 'rewound',
        session: result.session,
        messages: visible,
      });
      const msg = systemReply(sessionId, '已回退。可用 /help 查看更多命令。');
      broadcast(sessionId, { type: 'system_message', message: msg });
      return sendJson(res, 200, {
        ...result,
        messages: listVisibleMessages(sessionId),
      });
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
        // 重连时把 partial 文本 + 工具时间线推回去
        if (runningJob && (runningJob.partialText || (runningJob.tools && runningJob.tools.length))) {
          res.write(
            `data: ${JSON.stringify({
              type: 'assistant_start',
              messageId: runningJob.assistantId,
              jobId: runningJob.id,
              resume: true,
              tools: Array.isArray(runningJob.tools) ? runningJob.tools : [],
              toolOverflow: runningJob.toolOverflow || 0,
            })}\n\n`
          );
          if (runningJob.partialText) {
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
          // 批量恢复工具步骤（客户端按 id 合并）
          if (Array.isArray(runningJob.tools) && runningJob.tools.length) {
            res.write(
              `data: ${JSON.stringify({
                type: 'tools_snapshot',
                messageId: runningJob.assistantId,
                jobId: runningJob.id,
                tools: runningJob.tools,
                toolOverflow: runningJob.toolOverflow || 0,
                resume: true,
              })}\n\n`
            );
          }
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
      // 双保险：会话级 + 全局并发（findRunning 防 activeTurns 与 job 不一致）
      if (activeTurns.has(sessionId) || jobs.findRunningBySession(sessionId)) {
        return sendJson(res, 409, { error: 'busy', message: '当前对话还在生成中' });
      }
      const runningGlobal =
        activeTurns.size +
        jobs.listRunning().filter((j) => !activeTurns.has(j.sessionId)).length;
      if (runningGlobal >= config.maxConcurrentTurns) {
        return sendJson(res, 429, {
          error: 'server_busy',
          message: '服务器并发任务已满，请稍后再试',
        });
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
      const tools = Array.isArray(job.tools) ? job.tools.slice(0, 80) : [];
      if (text || tools.length) {
        const exists = store
          .listMessages(job.sessionId, { limit: 50 })
          .some((m) => m.id === job.assistantId);
        if (!exists) {
          store.appendMessage(job.sessionId, {
            id: job.assistantId || newId(),
            role: 'assistant',
            content:
              (text || '（无文本输出）') + '\n\n（服务重启，任务中断）',
            meta: {
              ok: false,
              jobId: job.id,
              status: 'interrupted',
              tools,
              toolOverflow: job.toolOverflow || 0,
            },
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
