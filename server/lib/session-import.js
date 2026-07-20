'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isSessionId } = require('./store');

const MAX_CANDIDATES = 100;
const MAX_SCAN_LINES = 160;
const MAX_PREVIEW = 160;
const MAX_TITLE = 80;

function homeDir() {
  return process.env.HOME || os.homedir() || process.cwd();
}

function projectsRoot() {
  return path.join(homeDir(), '.claude', 'projects');
}

function extractTextContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text) parts.push(String(block.text));
    else if (typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

function cleanPreview(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PREVIEW);
}

function cleanTitle(text) {
  return cleanPreview(text).slice(0, MAX_TITLE);
}

/**
 * CLI transcript 里大量 type=user 并不是用户真打的字：
 * skill 注入、system-reminder、command 包装、meta 提示等。
 * 同步进网页时必须跳过，否则侧栏会出现「只发了 再试试 却多出 skill 文档」的脏气泡。
 */
function isSkippableUserText(txt) {
  if (txt == null) return true;
  const s = String(txt);
  const t = s.trim();
  if (!t) return true;

  // 官方 / 本地 command 包装
  if (
    t.startsWith('<command-name>') ||
    t.startsWith('<local-command') ||
    t.startsWith('<command-message>') ||
    t.startsWith('<command-args>') ||
    t.startsWith('<system-reminder>')
  ) {
    return true;
  }

  // 整段被 reminder 包住，或正文几乎全是内部标签
  if (
    t.includes('<system-reminder>') ||
    t.includes('</system-reminder>') ||
    t.includes('<command-name>') ||
    t.includes('<local-command')
  ) {
    // 若用户真消息极短却夹了标签，仍视为内部
    const stripped = t
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
      .replace(/<local-command[\s\S]*?<\/local-command[^>]*>/gi, '')
      .trim();
    if (!stripped || stripped.length < 8) return true;
    // 标签占比过高
    if (stripped.length < t.length * 0.35) return true;
  }

  // Skill 注入（Claude Code 把 skill 正文塞成 user 消息）
  // 注意：不要仅凭路径里出现 /.claude/skills/ 就跳过——用户聊天可能提到该路径
  if (
    /^Base directory for this skill:/im.test(t) ||
    /^Skill file content:/im.test(t) ||
    /^The following skill was loaded/im.test(t) ||
    /^Launching skill:/im.test(t) ||
    /\$\{CLAUDE_SKILL_DIR\}/.test(t) ||
    (/^# [\w.-]+ Skill\b/m.test(t) &&
      (/前置检查/.test(t) ||
        /\$\{CLAUDE_SKILL_DIR\}/.test(t) ||
        /Base directory for this skill/i.test(t) ||
        t.length > 800)) ||
    (/\/\.claude\/skills\//.test(t) &&
      (/Base directory for this skill/i.test(t) ||
        /SKILL\.md/.test(t) ||
        /\$\{CLAUDE_SKILL_DIR\}/.test(t) ||
        t.length > 1500))
  ) {
    return true;
  }

  // 本项目 history inject / 其它元提示若被写回 transcript
  if (
    t.startsWith('以下是同一会话中此前的对话摘要') ||
    t.startsWith('以下是本轮对话记录') ||
    t.startsWith('CAUTION:') ||
    t.startsWith('This is a system message') ||
    t.startsWith('[System]') ||
    t.startsWith('[SYSTEM]')
  ) {
    return true;
  }

  // CLI 中断/元状态被记成 user 行
  if (
    /^\[Request interrupted by user\]$/i.test(t) ||
    /^\[Request cancelled/i.test(t) ||
    /^\[Interrupted\]$/i.test(t) ||
    /^No response requested\.?$/i.test(t)
  ) {
    return true;
  }

  // 纯 tool 结果 JSON 误标为 user
  if (
    (t.startsWith('{') || t.startsWith('[')) &&
    (t.includes('"type":"tool_result"') || t.includes('"tool_use_id"'))
  ) {
    return true;
  }

  return false;
}

/** 展示层 / API 出口：与导入过滤同一规则，避免历史脏数据继续露出 */
function isInternalBubbleContent(role, content) {
  if (role === 'user') return isSkippableUserText(content);
  if (role === 'assistant') {
    const t = String(content || '').trim();
    if (!t) return true;
    if (isPlaceholderAssistant(t)) return true;
    // skill dump 偶尔也会出现在 assistant 侧（少见）
    if (/^Base directory for this skill:/im.test(t)) return true;
  }
  return false;
}

function absorbLine(state, line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  if (!o || typeof o !== 'object') return;

  const sid = o.sessionId || o.session_id;
  if (sid && isSessionId(sid) && !state.sessionId) state.sessionId = sid;

  if (o.cwd && typeof o.cwd === 'string') {
    // 尾部 cwd 更贴近当前工作目录
    state.cwd = o.cwd;
  }
  if (o.entrypoint) state.entrypoint = o.entrypoint;
  if (o.timestamp) state.lastTs = o.timestamp;

  const t = o.type;
  if (t === 'custom-title' && o.customTitle) {
    state.customTitle = String(o.customTitle);
  } else if (t === 'ai-title' && o.aiTitle) {
    state.aiTitle = String(o.aiTitle);
  } else if (t === 'agent-name' && o.agentName) {
    state.agentName = String(o.agentName);
  } else if (t === 'last-prompt' && o.lastPrompt) {
    state.lastPrompt = String(o.lastPrompt);
  } else if (t === 'user') {
    const msg = o.message || {};
    const txt = extractTextContent(msg.content);
    if (!isSkippableUserText(txt)) {
      if (!state.firstUser) state.firstUser = txt;
      state.recentUser = txt;
    }
  }
}

/**
 * 只读扫描单个 .jsonl，抽取 resume 列表所需元数据。
 * 读头部拿 title/首条；读尾部拿 last-prompt / 最近 user（大文件不全量加载）。
 */
function inspectSessionFile(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size < 8) return null;

  const stem = path.basename(filePath, '.jsonl');
  const state = {
    sessionId: isSessionId(stem) ? stem : null,
    cwd: null,
    customTitle: null,
    aiTitle: null,
    agentName: null,
    firstUser: null,
    recentUser: null,
    lastPrompt: null,
    lastTs: null,
    entrypoint: null,
  };

  let fh;
  try {
    fh = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const headSize = Math.min(st.size, 256 * 1024);
    const headBuf = Buffer.alloc(headSize);
    const nHead = fs.readSync(fh, headBuf, 0, headSize, 0);
    const headLines = headBuf.slice(0, nHead).toString('utf8').split(/\r?\n/);
    let n = 0;
    for (const line of headLines) {
      if (!line) continue;
      n += 1;
      if (n > MAX_SCAN_LINES) break;
      absorbLine(state, line);
    }

    // 大文件再读尾部，刷新 lastPrompt / recentUser / cwd
    if (st.size > headSize) {
      const tailSize = Math.min(64 * 1024, st.size);
      const tailBuf = Buffer.alloc(tailSize);
      const offset = st.size - tailSize;
      const nTail = fs.readSync(fh, tailBuf, 0, tailSize, offset);
      let tailText = tailBuf.slice(0, nTail).toString('utf8');
      // 从第一个完整换行后开始，避免半截 JSON
      const nl = tailText.indexOf('\n');
      if (nl >= 0) tailText = tailText.slice(nl + 1);
      for (const line of tailText.split(/\r?\n/)) {
        if (!line) continue;
        absorbLine(state, line);
      }
    }
  } catch {
    return null;
  } finally {
    try {
      fs.closeSync(fh);
    } catch {
      /* ignore */
    }
  }

  if (!state.sessionId) return null;

  const title =
    cleanTitle(state.customTitle) ||
    cleanTitle(state.aiTitle) ||
    cleanTitle(state.agentName) ||
    cleanTitle(state.lastPrompt) ||
    cleanTitle(state.recentUser) ||
    cleanTitle(state.firstUser) ||
    `会话 ${state.sessionId.slice(0, 8)}`;

  const preview =
    cleanPreview(state.lastPrompt) ||
    cleanPreview(state.recentUser) ||
    cleanPreview(state.firstUser) ||
    title;

  let mtimeMs = st.mtimeMs;
  if (state.lastTs) {
    const parsed = Date.parse(state.lastTs);
    if (!Number.isNaN(parsed)) mtimeMs = Math.max(mtimeMs, parsed);
  }

  // sdk-cli / -p 会话可被 claude -p --resume；交互式 cli 会话通常不能
  const entrypoint = state.entrypoint || null;
  const resumeSupported =
    !entrypoint ||
    entrypoint === 'sdk-cli' ||
    entrypoint === 'sdk' ||
    entrypoint === 'print';

  return {
    claudeSessionId: state.sessionId,
    title,
    preview,
    workDir: state.cwd || null,
    mtimeMs,
    size: st.size,
    // 不把绝对 path 暴露给 API 列表；仅内部 find 使用
    path: filePath,
    entrypoint,
    resumeSupported,
  };
}

function listJsonlFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;

  /** @type {string[]} */
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        // 子代理 transcript 不是可 resume 的主会话
        if (ent.name === 'subagents') continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.endsWith('.jsonl')) continue;
      const stem = ent.name.slice(0, -'.jsonl'.length);
      if (!isSessionId(stem)) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {{ limit?: number, webSessions?: Array<{id:string,claudeSessionId?:string|null,title?:string}> }} [opts]
 */
function listImportableSessions(opts = {}) {
  const rawLimit = Number(opts.limit);
  const limit = Math.max(
    1,
    Math.min(300, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : MAX_CANDIDATES)
  );
  const root = projectsRoot();
  let files = [];
  try {
    files = listJsonlFiles(root);
  } catch {
    files = [];
  }

  // 先按 mtime 粗排，只 inspect 最近的一批（多取一些再裁）
  const withStat = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.size < 8) continue;
      withStat.push({ f, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      /* skip */
    }
  }
  withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const inspectBudget = Math.min(withStat.length, Math.max(limit * 2, limit));
  /** @type {Map<string, any>} */
  const byId = new Map();

  for (let i = 0; i < inspectBudget; i++) {
    let meta = null;
    try {
      meta = inspectSessionFile(withStat[i].f);
    } catch {
      meta = null;
    }
    if (!meta) continue;
    const prev = byId.get(meta.claudeSessionId);
    if (!prev || meta.mtimeMs > prev.mtimeMs) {
      byId.set(meta.claudeSessionId, meta);
    }
  }

  const webByClaude = new Map();
  for (const s of opts.webSessions || []) {
    if (!s || !s.id) continue;
    // active resume id 或 导入来源 id（resume 清掉后仍算「已在网页」）
    const keys = [s.claudeSessionId, s.importedClaudeSessionId].filter(
      (id) => id && isSessionId(id)
    );
    for (const key of keys) {
      const prev = webByClaude.get(key);
      if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) {
        webByClaude.set(key, {
          webSessionId: s.id,
          webTitle: s.title || null,
          updatedAt: s.updatedAt || 0,
        });
      }
    }
  }

  const items = Array.from(byId.values())
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => {
      const bound = webByClaude.get(item.claudeSessionId);
      return {
        claudeSessionId: item.claudeSessionId,
        title: item.title,
        preview: item.preview,
        workDir: item.workDir,
        updatedAt: Math.round(item.mtimeMs),
        size: item.size,
        source: 'cli',
        entrypoint: item.entrypoint || null,
        resumeSupported: item.resumeSupported !== false,
        imported: !!bound,
        webSessionId: bound ? bound.webSessionId : null,
        webTitle: bound ? bound.webTitle : null,
      };
    });

  return {
    ok: true,
    root,
    totalFiles: files.length,
    count: items.length,
    limit,
    sessions: items,
  };
}

/**
 * 校验某个 claudeSessionId 是否仍存在于 projects 目录（可选）。
 */
function findSessionFile(claudeSessionId) {
  if (!isSessionId(claudeSessionId)) return null;
  const root = projectsRoot();
  if (!fs.existsSync(root)) return null;
  const needle = `${claudeSessionId}.jsonl`;
  // 早停遍历：找到即返回，避免每次 import 全量 list
  /** @type {string[]} */
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'subagents') continue;
        stack.push(full);
        continue;
      }
      if (ent.isFile() && ent.name === needle) return full;
    }
  }
  return null;
}

const DEFAULT_HISTORY_MAX_MESSAGES = 200;
const DEFAULT_HISTORY_MAX_CHARS = 80000;
/** 单条 NDJSON 行缓冲上限，防止无换行的脏文件撑爆内存 */
const MAX_LINE_LEFTOVER = 1024 * 1024;
/** 大文件只扫尾部，避免 2c2g 上同步读数 MB 卡死事件循环 */
const DEFAULT_HISTORY_MAX_READ_BYTES = 2 * 1024 * 1024;
/** 导入气泡总字符软上限（超出则从更早的消息丢弃） */
const DEFAULT_HISTORY_MAX_TOTAL_CHARS = 1.5 * 1024 * 1024;

function isToolOnlyContent(content) {
  if (!Array.isArray(content) || !content.length) return false;
  return content.every(
    (b) =>
      b &&
      typeof b === 'object' &&
      (b.type === 'tool_result' ||
        b.type === 'tool_use' ||
        b.type === 'server_tool_use' ||
        b.type === 'web_search_tool_result' ||
        b.type === 'thinking')
  );
}

function extractAssistantText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    // 只要可见文本；thinking / tool_use 不进气泡
    if (block.type === 'text' && block.text) parts.push(String(block.text));
  }
  return parts.join('\n\n').trim();
}

function clipContent(text, maxChars) {
  const s = String(text || '');
  if (s.length <= maxChars) return s;
  return (
    s.slice(0, maxChars) +
    `\n\n…(导入时截断，原长度 ${s.length} 字符)`
  );
}

function isPlaceholderAssistant(text) {
  const t = String(text || '').trim();
  return (
    t === 'No response requested.' ||
    t === 'No response requested' ||
    t === '(no content)' ||
    t === '(no response)'
  );
}

/**
 * 从 CLI transcript .jsonl 抽出可展示的 user/assistant 气泡。
 * 流式按行读，避免大文件一次性进内存；只保留最近 maxMessages 条。
 * 大文件默认只读尾部 DEFAULT_HISTORY_MAX_READ_BYTES。
 *
 * @returns {{ messages: Array<{role:string,content:string,createdAt:number,meta:object}>, truncated: boolean, scanned: number, fileFound: boolean, dropped?: number, readBytes?: number }}
 */
function extractChatHistory(filePath, opts = {}) {
  const maxMessages = Math.max(
    10,
    Math.min(1000, Number(opts.maxMessages) || DEFAULT_HISTORY_MAX_MESSAGES)
  );
  const maxChars = Math.max(
    2000,
    Math.min(200000, Number(opts.maxCharsPerMsg) || DEFAULT_HISTORY_MAX_CHARS)
  );
  const maxReadBytes = Math.max(
    64 * 1024,
    Math.min(
      16 * 1024 * 1024,
      Number(opts.maxReadBytes) || DEFAULT_HISTORY_MAX_READ_BYTES
    )
  );
  const maxTotalChars = Math.max(
    50 * 1024,
    Math.min(
      8 * 1024 * 1024,
      Number(opts.maxTotalChars) || DEFAULT_HISTORY_MAX_TOTAL_CHARS
    )
  );

  if (!filePath || typeof filePath !== 'string') {
    return { messages: [], truncated: false, scanned: 0, fileFound: false };
  }

  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return { messages: [], truncated: false, scanned: 0, fileFound: false };
  }
  if (!st.isFile() || st.size < 2) {
    return { messages: [], truncated: false, scanned: 0, fileFound: false };
  }

  /** @type {Array<{role:string,content:string,createdAt:number,meta:object}>} */
  const ring = [];
  let truncated = false;
  let scanned = 0;
  let dropped = 0;
  let totalChars = 0;

  let fh;
  try {
    fh = fs.openSync(filePath, 'r');
  } catch {
    return { messages: [], truncated: false, scanned: 0, fileFound: false };
  }

  try {
    // 大文件只读尾部：最近消息在文件末尾
    let pos = 0;
    let end = st.size;
    if (st.size > maxReadBytes) {
      pos = st.size - maxReadBytes;
      truncated = true;
    }
    const bufSize = 256 * 1024;
    const buf = Buffer.alloc(Math.min(bufSize, maxReadBytes));
    let leftover = '';
    let skipPartial = pos > 0; // 尾部起点可能截断半行

    while (pos < end) {
      const toRead = Math.min(buf.length, end - pos);
      const n = fs.readSync(fh, buf, 0, toRead, pos);
      if (n <= 0) break;
      pos += n;
      leftover += buf.slice(0, n).toString('utf8');

      if (leftover.length > MAX_LINE_LEFTOVER) {
        // 脏数据：无换行的超长行，丢掉最前半段
        const cut = leftover.lastIndexOf('\n');
        if (cut >= 0) leftover = leftover.slice(cut + 1);
        else leftover = leftover.slice(-Math.floor(MAX_LINE_LEFTOVER / 4));
        truncated = true;
      }

      // 从文件中部起读时，先丢掉第一段半截行，后续完整行全部保留
      if (skipPartial) {
        const cut = leftover.indexOf('\n');
        if (cut < 0) continue; // 还没凑齐一行边界
        leftover = leftover.slice(cut + 1);
        skipPartial = false;
      }

      let nl;
      while ((nl = leftover.indexOf('\n')) >= 0) {
        let line = leftover.slice(0, nl);
        leftover = leftover.slice(nl + 1);
        if (!line) continue;
        scanned += 1;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (!o || typeof o !== 'object') continue;
        const t = o.type;
        if (t !== 'user' && t !== 'assistant') continue;

        const msg = o.message || {};
        const content = msg.content;
        let text = '';

        if (t === 'user') {
          if (isToolOnlyContent(content)) continue;
          text = extractTextContent(content);
          if (isSkippableUserText(text)) continue;
          if (!String(text).trim()) continue;
        } else {
          text = extractAssistantText(content);
          if (!text || isPlaceholderAssistant(text)) continue;
        }

        let createdAt = Date.now();
        if (o.timestamp) {
          const p = Date.parse(o.timestamp);
          if (!Number.isNaN(p)) createdAt = p;
        }

        const body = clipContent(text, maxChars);
        ring.push({
          role: t,
          content: body,
          createdAt,
          meta: {
            imported: true,
            cliUuid: o.uuid || null,
            source: 'cli-transcript',
          },
        });
        totalChars += body.length;

        while (ring.length > maxMessages || totalChars > maxTotalChars) {
          const removed = ring.shift();
          if (!removed) break;
          totalChars -= (removed.content || '').length;
          dropped += 1;
          truncated = true;
        }
      }
      // skipPartial 仅在遇到第一条完整换行后清除；勿在块末尾强行清掉
    }
    // 最后半行忽略（不完整 JSON）
  } catch {
    // IO 中途失败：尽量返回已解析部分
    truncated = true;
  } finally {
    try {
      fs.closeSync(fh);
    } catch {
      /* ignore */
    }
  }

  return {
    messages: ring,
    truncated,
    scanned,
    dropped,
    fileFound: true,
    readBytes: Math.min(st.size, maxReadBytes),
    fileSize: st.size,
  };
}

/**
 * 按 claudeSessionId 抽取历史（找不到文件则空）。
 */
function extractChatHistoryBySessionId(claudeSessionId, opts) {
  const file = findSessionFile(claudeSessionId);
  if (!file) {
    return { messages: [], truncated: false, scanned: 0, fileFound: false };
  }
  return extractChatHistory(file, opts);
}

module.exports = {
  projectsRoot,
  listImportableSessions,
  inspectSessionFile,
  findSessionFile,
  extractChatHistory,
  extractChatHistoryBySessionId,
  isSkippableUserText,
  isInternalBubbleContent,
  MAX_CANDIDATES,
  DEFAULT_HISTORY_MAX_MESSAGES,
};
