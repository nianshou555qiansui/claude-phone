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

function isSkippableUserText(txt) {
  if (!txt) return true;
  const s = String(txt);
  return (
    s.startsWith('<command-name>') ||
    s.startsWith('<local-command') ||
    s.startsWith('<command-message>') ||
    s.startsWith('<system-reminder>')
  );
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

  return {
    claudeSessionId: state.sessionId,
    title,
    preview,
    workDir: state.cwd || null,
    mtimeMs,
    size: st.size,
    // 不把绝对 path 暴露给 API 列表；仅内部 find 使用
    path: filePath,
    entrypoint: state.entrypoint || null,
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
    if (s && s.claudeSessionId && isSessionId(s.claudeSessionId) && s.id) {
      // 同一 CLI id 绑了多条网页会话时，保留 updatedAt 更新的一条
      const prev = webByClaude.get(s.claudeSessionId);
      if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) {
        webByClaude.set(s.claudeSessionId, {
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
  const files = listJsonlFiles(root);
  const needle = `${claudeSessionId}.jsonl`;
  for (const f of files) {
    if (path.basename(f) === needle) return f;
  }
  return null;
}

module.exports = {
  projectsRoot,
  listImportableSessions,
  inspectSessionFile,
  findSessionFile,
  MAX_CANDIDATES,
};
