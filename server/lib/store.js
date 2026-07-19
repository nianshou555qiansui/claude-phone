'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config, normalizePermissionMode } = require('./config');

const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function newId() {
  return crypto.randomUUID();
}

function isSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

class ChatStore {
  constructor() {
    this.dataDir = config.dataDir;
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.messagesDir = path.join(this.dataDir, 'messages');
    ensureDir(this.dataDir);
    ensureDir(this.messagesDir);
    this._writeChain = Promise.resolve();
    this.sessions = this._loadSessions();
  }

  _loadSessions() {
    try {
      if (!fs.existsSync(this.sessionsFile)) return {};
      const raw = JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  _saveSessionsSync() {
    const tmp = this.sessionsFile + `.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.sessions, null, 2));
    fs.renameSync(tmp, this.sessionsFile);
  }

  /** 串行化磁盘写，避免并发打坏 json/jsonl */
  _queueWrite(fn) {
    this._writeChain = this._writeChain.then(fn, fn);
    return this._writeChain;
  }

  _msgPath(sessionId) {
    if (!isSessionId(sessionId)) {
      throw new Error('invalid session id');
    }
    return path.join(this.messagesDir, `${sessionId}.jsonl`);
  }

  listSessions() {
    return Object.values(this.sessions).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );
  }

  getSession(id) {
    if (!isSessionId(id)) return null;
    return this.sessions[id] || null;
  }

  createSession({ title, workDir, permissionMode } = {}) {
    const id = newId();
    const now = Date.now();
    const session = {
      id,
      title: (title && String(title).slice(0, 80)) || '新对话',
      workDir: workDir || config.workDir,
      permissionMode: normalizePermissionMode(
        permissionMode || config.defaultPermissionMode
      ),
      claudeSessionId: null,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      needsHistoryInject: false,
    };
    this.sessions[id] = session;
    this._saveSessionsSync();
    fs.writeFileSync(this._msgPath(id), '');
    return session;
  }

  updateSession(id, patch) {
    const s = this.sessions[id];
    if (!s) return null;
    const next = { ...s, ...patch, updatedAt: Date.now() };
    this.sessions[id] = next;
    this._saveSessionsSync();
    return next;
  }

  deleteSession(id) {
    if (!this.sessions[id]) return false;
    delete this.sessions[id];
    this._saveSessionsSync();
    try {
      fs.unlinkSync(this._msgPath(id));
    } catch {
      /* ignore */
    }
    return true;
  }

  appendMessage(sessionId, message) {
    const msg = {
      id: message.id || newId(),
      role: message.role,
      content: message.content == null ? '' : String(message.content),
      createdAt: message.createdAt || Date.now(),
      meta: message.meta || {},
    };
    const p = this._msgPath(sessionId);
    fs.appendFileSync(p, JSON.stringify(msg) + '\n');
    this.updateSession(sessionId, {});
    return msg;
  }

  listMessages(sessionId, { limit = 500 } = {}) {
    let p;
    try {
      p = this._msgPath(sessionId);
    } catch {
      return [];
    }
    if (!fs.existsSync(p)) return [];
    let raw;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch {
      return [];
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const msgs = [];
    for (const line of lines) {
      try {
        const m = JSON.parse(line);
        if (m && m.role) msgs.push(m);
      } catch {
        /* skip bad line */
      }
    }
    if (msgs.length > limit) return msgs.slice(-limit);
    return msgs;
  }

  /**
   * 回退：保留到 keepMessageId 为止（含），之后全部丢弃。
   * keepMessageId 为 null 时清空。
   */
  rewindTo(sessionId, keepMessageId) {
    const all = this.listMessages(sessionId, { limit: 100000 });
    let kept;
    if (!keepMessageId) {
      kept = [];
    } else {
      const idx = all.findIndex((m) => m.id === keepMessageId);
      if (idx < 0) {
        const err = new Error('message not found');
        err.code = 'NOT_FOUND';
        throw err;
      }
      kept = all.slice(0, idx + 1);
    }
    const p = this._msgPath(sessionId);
    const tmp = p + `.${process.pid}.tmp`;
    const body = kept.map((m) => JSON.stringify(m)).join('\n') + (kept.length ? '\n' : '');
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, p);
    // 断开 claude resume，后续用历史注入
    const updated = this.updateSession(sessionId, {
      claudeSessionId: null,
      needsHistoryInject: kept.length > 0,
      status: 'idle',
    });
    return { messages: kept, session: updated };
  }

  /**
   * 回退最后 n 个「有效」user 回合（user + 其后 assistant/system）。
   * 会自动忽略末尾的本地 slash 命令（如刚发送的 /rewind 本身）。
   */
  rewindLastTurns(sessionId, turns = 1) {
    const n = Math.max(1, Math.min(50, Number(turns) || 1));
    const all = this.listMessages(sessionId, { limit: 100000 });

    // 去掉末尾连续的本地命令气泡，避免 /rewind 把自己当目标
    let end = all.length;
    while (end > 0) {
      const m = all[end - 1];
      if (m.role === 'system' && m.meta && m.meta.localCommand) {
        end -= 1;
        continue;
      }
      if (m.role === 'user' && String(m.content || '').trim().startsWith('/')) {
        end -= 1;
        continue;
      }
      break;
    }
    const usable = all.slice(0, end);
    if (!usable.length) {
      return this.rewindTo(sessionId, null);
    }

    let userCount = 0;
    let cut = usable.length;
    for (let i = usable.length - 1; i >= 0; i--) {
      if (usable[i].role === 'user') {
        userCount += 1;
        if (userCount >= n) {
          cut = i; // 从该 user 起删掉（含）
          break;
        }
      }
    }
    if (userCount === 0) {
      return this.rewindTo(sessionId, null);
    }
    const keepId = cut > 0 ? usable[cut - 1].id : null;
    return this.rewindTo(sessionId, keepId);
  }
}

module.exports = { ChatStore, newId, isSessionId };
