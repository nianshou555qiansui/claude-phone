'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const { config, normalizePermissionMode } = require('./config');

/**
 * 跑一轮 claude -p --output-format stream-json
 * 将 NDJSON 解析为前端可用事件。
 */
class ClaudeTurn extends EventEmitter {
  constructor(opts) {
    super();
    this.prompt = String(opts.prompt || '');
    this.workDir = opts.workDir || config.workDir;
    this.permissionMode = normalizePermissionMode(opts.permissionMode);
    this.effectivePermissionMode = null;
    this.resumeSessionId = opts.resumeSessionId || null;
    this.timeoutMs = opts.timeoutMs || config.turnTimeoutMs;
    this.claudeBin = opts.claudeBin || config.claudeBin;
    this.model = opts.model || null;
    this.proc = null;
    this.killed = false;
    this.stdoutBuf = '';
    this.assistantText = '';
    this.claudeSessionId = this.resumeSessionId;
    this.timer = null;
    this.exitCode = null;
    this.startedAt = Date.now();
    this.lastUsage = null;
    this.lastModel = this.model || null;
    this.lastDurationMs = null;
    /** @type {string|null} CLI result/stderr 可读错误，供网页展示 */
    this.lastErrorMessage = null;
    this.lastResultIsError = false;
  }

  start() {
    if (!this.prompt.trim()) {
      queueMicrotask(() => {
        this.emit('error', { message: 'empty prompt' });
        this.emit('done', {
          ok: false,
          assistantText: '',
          claudeSessionId: this.claudeSessionId,
          code: null,
          usage: this.lastUsage,
          model: this.lastModel,
          durationMs: this.lastDurationMs,
        });
      });
      return this;
    }

    if (!fs.existsSync(this.workDir)) {
      queueMicrotask(() => {
        this.emit('error', { message: `工作目录不存在: ${this.workDir}` });
        this.emit('done', {
          ok: false,
          assistantText: '',
          claudeSessionId: this.claudeSessionId,
          code: null,
          usage: this.lastUsage,
          model: this.lastModel,
          durationMs: this.lastDurationMs,
        });
      });
      return this;
    }

    if (!fs.existsSync(this.claudeBin)) {
      queueMicrotask(() => {
        this.emit('error', { message: `找不到 claude: ${this.claudeBin}` });
        this.emit('done', {
          ok: false,
          assistantText: '',
          claudeSessionId: this.claudeSessionId,
          code: null,
          usage: this.lastUsage,
          model: this.lastModel,
          durationMs: this.lastDurationMs,
        });
      });
      return this;
    }

    const args = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      this.permissionMode,
    ];

    // bypassPermissions 在部分环境下还需显式 skip 开关才完整生效
    if (this.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    }

    if (this.resumeSessionId) {
      args.push('--resume', this.resumeSessionId);
    }
    if (this.model) {
      args.push('--model', this.model);
    }

    args.push(this.prompt);

    this.emit('status', {
      state: 'starting',
      workDir: this.workDir,
      permissionMode: this.permissionMode,
      resume: !!this.resumeSessionId,
    });

    try {
      this.proc = spawn(this.claudeBin, args, {
        cwd: this.workDir,
        env: {
          ...process.env,
          HOME: process.env.HOME || require('os').homedir(),
          PATH: process.env.PATH || '/usr/bin:/bin',
          TERM: 'dumb',
          NO_COLOR: '1',
          CI: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      queueMicrotask(() => {
        this.emit('error', { message: err.message });
        this.emit('done', {
          ok: false,
          assistantText: '',
          claudeSessionId: this.claudeSessionId,
          code: null,
          usage: this.lastUsage,
          model: this.lastModel,
          durationMs: this.lastDurationMs,
        });
      });
      return this;
    }

    this.timer = setTimeout(() => {
      this.emit('error', { message: `超时 ${Math.round(this.timeoutMs / 1000)}s` });
      this.abort('timeout');
    }, this.timeoutMs);

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
    this.proc.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (!text.trim()) return;
      this.emit('stderr', { text });
      // 抓一行有用的错误（略过 stdin 等待提示）
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        if (/no stdin data received/i.test(s)) continue;
        if (/proceeding without it/i.test(s)) continue;
        if (s.length > 500) continue;
        this.lastErrorMessage = s;
      }
    });

    this.proc.on('error', (err) => {
      this._clearTimer();
      this.lastErrorMessage = err.message || String(err);
      this.emit('error', { message: this.lastErrorMessage });
      this.emit('done', {
        ok: false,
        assistantText: this.assistantText,
        claudeSessionId: this.claudeSessionId,
        code: null,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs || Date.now() - this.startedAt,
        errorMessage: this.lastErrorMessage,
        resultIsError: true,
      });
    });

    this.proc.on('close', (code, signal) => {
      this._clearTimer();
      this.exitCode = code;
      if (this.stdoutBuf.trim()) {
        this._handleLine(this.stdoutBuf.trim());
        this.stdoutBuf = '';
      }
      const ok =
        !this.killed &&
        !this.lastResultIsError &&
        code === 0;
      this.emit('done', {
        ok,
        assistantText: this.assistantText,
        claudeSessionId: this.claudeSessionId,
        code,
        signal,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs || Date.now() - this.startedAt,
        errorMessage: this.lastErrorMessage,
        resultIsError: this.lastResultIsError,
      });
    });

    return this;
  }

  abort(reason = 'abort') {
    if (this.killed) return;
    this.killed = true;
    this._clearTimer();
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          if (this.proc && !this.proc.killed) this.proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 2000).unref?.();
    }
    this.emit('aborted', { reason });
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _onStdout(chunk) {
    this.stdoutBuf += chunk;
    let idx;
    while ((idx = this.stdoutBuf.indexOf('\n')) >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim();
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1);
      if (line) this._handleLine(line);
    }
  }

  _appendAssistantText(text) {
    if (typeof text !== 'string' || !text) return;
    // 避免把完整 result 再拼到已有流式文本后面造成重复
    if (this.assistantText && text === this.assistantText) return;
    if (this.assistantText && text.startsWith(this.assistantText)) {
      const rest = text.slice(this.assistantText.length);
      if (rest) {
        this.assistantText = text;
        this.emit('delta', { text: rest });
      }
      return;
    }
    if (this.assistantText && this.assistantText.endsWith(text)) return;
    this.assistantText += text;
    this.emit('delta', { text });
  }

  _handleLine(line) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      this.emit('raw', { line: line.slice(0, 500) });
      return;
    }

    this.emit('event', ev);

    if (ev.session_id) {
      if (!this.claudeSessionId || this.claudeSessionId !== ev.session_id) {
        this.claudeSessionId = ev.session_id;
        this.emit('session', { claudeSessionId: this.claudeSessionId });
      }
    }

    if (ev.type === 'system' && ev.subtype === 'init') {
      if (ev.permissionMode) {
        this.effectivePermissionMode = ev.permissionMode;
        this.emit('permission_mode', {
          requested: this.permissionMode,
          effective: ev.permissionMode,
        });
      }
      if (ev.model) {
        this.lastModel = ev.model;
        this.emit('meta', { model: ev.model, cwd: ev.cwd, tools: ev.tools });
      }
      if (Array.isArray(ev.slash_commands)) {
        this.emit('meta', { slashCommands: ev.slash_commands });
      }
    }

    // 流式 partial
    this._extractStreamDelta(ev);

    // assistant 完整块
    if (ev.type === 'assistant' && ev.message) {
      const content = ev.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            // 若此前没有流式 delta，整段写入
            if (!this.assistantText) {
              this._appendAssistantText(block.text);
            } else if (block.text.length > this.assistantText.length) {
              this._appendAssistantText(block.text);
            }
          }
          if (block?.type === 'tool_use') {
            this._emitToolStart(block);
          }
          if (block?.type === 'tool_result') {
            this._emitToolResult(block);
          }
        }
      } else if (content && typeof content === 'object') {
        // rare single-block message shapes
        if (content.type === 'tool_use') this._emitToolStart(content);
        if (content.type === 'tool_result') this._emitToolResult(content);
      }
    }

    // user 消息里常见 tool_result 回传
    if (ev.type === 'user' && ev.message) {
      const content = ev.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'tool_result') this._emitToolResult(block);
        }
      }
    }

    // stream_event: content_block_start tool_use / tool_result
    if (ev.type === 'stream_event' || ev.type === 'content_block_start') {
      const block =
        ev.content_block ||
        (ev.event && ev.event.content_block) ||
        (ev.event && ev.event.type === 'content_block_start' && ev.event.content_block) ||
        null;
      if (block?.type === 'tool_use') this._emitToolStart(block);
      if (block?.type === 'tool_result') this._emitToolResult(block);
    }

    // 兼容：部分 CLI 把 tool 结果放在 content_block_delta 之外的独立 type
    if (ev.type === 'tool_result' || ev.subtype === 'tool_result') {
      this._emitToolResult(ev);
    }
    if (ev.type === 'tool_use' || ev.subtype === 'tool_use') {
      this._emitToolStart(ev);
    }

    // assistant 消息上的 usage（中间事件常带 0/0 占位，不能覆盖已有真实 usage）
    if (ev.type === 'assistant' && ev.message && ev.message.usage) {
      if (ev.message.model) this.lastModel = ev.message.model;
      const next = normalizeUsage(
        ev.message.usage,
        ev.message.model || this.lastModel
      );
      const merged = preferUsage(this.lastUsage, next, { force: false });
      if (merged && merged !== this.lastUsage) {
        this.lastUsage = merged;
        this.emit('usage', this.lastUsage);
      } else if (!this.lastUsage && isMeaningfulUsage(next)) {
        this.lastUsage = next;
        this.emit('usage', this.lastUsage);
      }
    }

    // 最终 result
    if (ev.type === 'result') {
      const resultText =
        typeof ev.result === 'string'
          ? ev.result
          : typeof ev.result?.text === 'string'
            ? ev.result.text
            : '';
      if (resultText) {
        if (!this.assistantText) this._appendAssistantText(resultText);
        else if (resultText.length > this.assistantText.length) this._appendAssistantText(resultText);
      }
      if (ev.duration_ms != null) this.lastDurationMs = Number(ev.duration_ms) || null;
      if (ev.model) this.lastModel = ev.model;
      // modelUsage 的 key 常是带 [1M] 的真实模型 id
      if (ev.modelUsage && typeof ev.modelUsage === 'object') {
        const picked = pickModelUsageEntry(ev);
        if (picked && picked.key) {
          // 优先带窗口标记的完整名
          if (
            !this.lastModel ||
            (!/\[1m\]/i.test(String(this.lastModel)) &&
              /\[1m\]/i.test(String(picked.key)))
          ) {
            this.lastModel = picked.key;
          } else if (!this.lastModel) {
            this.lastModel = picked.key;
          }
        }
      }
      if (ev.usage || ev.modelUsage) {
        const next = normalizeUsage(ev.usage || {}, this.lastModel, ev);
        this.lastUsage = preferUsage(this.lastUsage, next, { force: true });
      }
      // CLI 业务错误：exit 可能仍是 0，但 is_error / errors[] 有内容
      const errParts = [];
      if (Array.isArray(ev.errors)) {
        for (const e of ev.errors) {
          if (e == null) continue;
          errParts.push(typeof e === 'string' ? e : JSON.stringify(e));
        }
      }
      if (ev.error) {
        errParts.push(
          typeof ev.error === 'string' ? ev.error : JSON.stringify(ev.error)
        );
      }
      if (ev.is_error || errParts.length) {
        this.lastResultIsError = true;
        const msg =
          errParts.filter(Boolean).join('; ') ||
          ev.subtype ||
          'CLI returned is_error';
        this.lastErrorMessage = String(msg).slice(0, 800);
        this.emit('error', { message: this.lastErrorMessage, result: true });
      }
      if (this.lastUsage) this.emit('usage', this.lastUsage);
      this.emit('result', {
        ...ev,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs,
        errorMessage: this.lastErrorMessage,
      });
    }
  }

  _extractStreamDelta(ev) {
    // content_block_delta 直出
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      this._appendAssistantText(ev.delta.text);
      return;
    }
    // stream_event 包裹
    if (ev.type === 'stream_event') {
      const inner = ev.event || ev;
      if (inner?.type === 'content_block_delta' && inner.delta?.type === 'text_delta' && inner.delta.text) {
        this._appendAssistantText(inner.delta.text);
        return;
      }
      if (inner?.delta?.type === 'text_delta' && inner.delta.text) {
        this._appendAssistantText(inner.delta.text);
      }
    }
  }

  /**
   * Normalize + emit tool_use start. Dedupes by id within this turn.
   * Caps input size so SSE payloads stay small on 2c2g.
   */
  _emitToolStart(block) {
    if (!block || typeof block !== 'object') return;
    if (!this._toolSeen) this._toolSeen = new Set();
    const id =
      block.id ||
      block.tool_use_id ||
      block.toolUseId ||
      null;
    const name = String(block.name || block.tool_name || block.tool || 'tool').slice(
      0,
      120
    );
    const key = id ? String(id) : `anon:${name}:${(this._toolSeen.size || 0) + 1}`;
    if (this._toolSeen.has('start:' + key)) return;
    this._toolSeen.add('start:' + key);
    const input = sanitizeToolPayload(block.input != null ? block.input : block.arguments, 1200);
    this.emit('tool', {
      phase: 'start',
      id: id ? String(id).slice(0, 80) : null,
      name,
      input,
      ts: Date.now(),
    });
  }

  /**
   * Normalize + emit tool_result. Matches start by tool_use_id when present.
   */
  _emitToolResult(block) {
    if (!block || typeof block !== 'object') return;
    if (!this._toolSeen) this._toolSeen = new Set();
    const id =
      block.tool_use_id ||
      block.toolUseId ||
      block.id ||
      null;
    const key = id ? String(id) : `anon-result:${(this._toolSeen.size || 0) + 1}`;
    if (this._toolSeen.has('result:' + key)) return;
    this._toolSeen.add('result:' + key);
    const isError = !!(
      block.is_error ||
      block.isError ||
      block.error ||
      block.status === 'error'
    );
    // content may be string | array of blocks | object
    let raw =
      block.content != null
        ? block.content
        : block.result != null
          ? block.result
          : block.output != null
            ? block.output
            : block;
    if (raw === block && (block.type === 'tool_result' || block.subtype === 'tool_result')) {
      // avoid dumping whole envelope when no content field
      raw = block.content != null ? block.content : block.result != null ? block.result : '';
    }
    const result = sanitizeToolPayload(raw, 2000);
    this.emit('tool', {
      phase: 'result',
      id: id ? String(id).slice(0, 80) : null,
      name: block.name ? String(block.name).slice(0, 120) : null,
      result,
      isError,
      ts: Date.now(),
    });
  }
}

/**
 * Cap tool input/result for SSE + storage. Returns a JSON-safe value.
 * @param {any} value
 * @param {number} maxChars
 */
function sanitizeToolPayload(value, maxChars) {
  const cap = Math.max(200, Math.min(8000, Number(maxChars) || 1200));
  try {
    if (value == null) return null;
    if (typeof value === 'string') {
      return value.length > cap
        ? value.slice(0, cap) + `…(+${value.length - cap})`
        : value;
    }
    // Anthropic content array → join text-ish parts
    if (Array.isArray(value)) {
      const parts = [];
      for (const b of value) {
        if (typeof b === 'string') parts.push(b);
        else if (b && typeof b === 'object') {
          if (typeof b.text === 'string') parts.push(b.text);
          else if (typeof b.content === 'string') parts.push(b.content);
          else if (b.type === 'text' && b.text) parts.push(String(b.text));
          else {
            try {
              parts.push(JSON.stringify(b));
            } catch {
              /* skip */
            }
          }
        }
        if (parts.join('\n').length > cap) break;
      }
      const s = parts.join('\n');
      return s.length > cap ? s.slice(0, cap) + `…(+${s.length - cap})` : s;
    }
    if (typeof value === 'object') {
      let s;
      try {
        s = JSON.stringify(value);
      } catch {
        s = String(value);
      }
      if (s.length > cap) {
        // Prefer a short summary object rather than hard cut mid-JSON
        const keys = Object.keys(value).slice(0, 12);
        return {
          _truncated: true,
          keys,
          preview: s.slice(0, cap) + `…(+${s.length - cap})`,
        };
      }
      return value;
    }
    const s = String(value);
    return s.length > cap ? s.slice(0, cap) + `…(+${s.length - cap})` : s;
  } catch {
    return null;
  }
}

/**
 * 规范化 stream-json 里的 usage，供状态栏 Context 条使用。
 * context 窗口：优先 modelUsage / result 字段，否则按模型名启发式（含 1M / 200k）。
 *
 * 注意：stream-json 在 assistant 中间事件里常带 usage:{input_tokens:0,output_tokens:0}
 * 占位；真正数字多半在 type=result。见 isMeaningfulUsage / preferUsage。
 */
function pickModelUsageEntry(resultEv) {
  if (!resultEv || typeof resultEv !== 'object') return null;
  const mu = resultEv.modelUsage;
  if (!mu || typeof mu !== 'object' || Array.isArray(mu)) return null;
  const keys = Object.keys(mu);
  if (!keys.length) return null;
  // 优先选 contextWindow 最大的条目（多模型时更稳）
  let bestKey = keys[0];
  let bestWin = 0;
  for (const k of keys) {
    const entry = mu[k];
    const win = Number(entry && (entry.contextWindow ?? entry.context_window));
    if (Number.isFinite(win) && win > bestWin) {
      bestWin = win;
      bestKey = k;
    }
  }
  return { key: bestKey, entry: mu[bestKey] };
}

function inferContextWindow(model, resultEv) {
  if (resultEv && typeof resultEv === 'object') {
    const direct =
      resultEv.context_window ||
      resultEv.contextWindow ||
      resultEv.max_tokens_context;
    const n = Number(direct);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);

    const picked = pickModelUsageEntry(resultEv);
    if (picked && picked.entry) {
      const w = Number(
        picked.entry.contextWindow ?? picked.entry.context_window
      );
      if (Number.isFinite(w) && w > 0) return Math.floor(w);
    }
  }
  const m = String(model || '').toLowerCase();
  if (/\[1m\]|1m\b|1000000|1,000,000/.test(m)) return 1000000;
  if (/200k|200000/.test(m)) return 200000;
  if (/haiku|sonnet|opus|fable|claude|grok/.test(m)) return 200000;
  // 中转大上下文常见 1M 标记；未知默认 200k
  return 200000;
}

function clampNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1e12);
}

/** 是否为“有实质 token 信息”的 usage（排除 stream 占位 0/0） */
function isMeaningfulUsage(u) {
  if (!u || typeof u !== 'object') return false;
  return (
    (Number(u.inputTokens) || 0) > 0 ||
    (Number(u.outputTokens) || 0) > 0 ||
    (Number(u.cacheReadInputTokens) || 0) > 0 ||
    (Number(u.cacheCreationInputTokens) || 0) > 0 ||
    (Number(u.contextUsed) || 0) > 0
  );
}

/**
 * 合并 usage：有意义的新值覆盖旧值；空占位不覆盖已有真实数据。
 * force=true（result 路径）时若新值有意义则采用，否则保留旧值。
 */
function preferUsage(prev, next, { force = false } = {}) {
  if (!next) return prev || null;
  if (!prev) return isMeaningfulUsage(next) || force ? next : null;
  if (isMeaningfulUsage(next)) {
    // 若新旧都有意义，取 contextUsed 更大者（避免中途 partial 回退）
    if (
      isMeaningfulUsage(prev) &&
      (Number(next.contextUsed) || 0) < (Number(prev.contextUsed) || 0) &&
      !force
    ) {
      return prev;
    }
    const merged = { ...next };
    if (
      (!merged.model || !/\[1m\]/i.test(String(merged.model))) &&
      prev.model &&
      /\[1m\]/i.test(String(prev.model))
    ) {
      merged.model = prev.model;
    }
    if (
      (Number(merged.contextWindow) || 0) < (Number(prev.contextWindow) || 0) &&
      (Number(prev.contextWindow) || 0) > 0
    ) {
      // 仅当新窗口明显偏小且旧窗口更大时保留旧窗口并重算 pct
      if (
        (Number(next.contextWindow) || 0) <= 200000 &&
        (Number(prev.contextWindow) || 0) >= 500000
      ) {
        merged.contextWindow = prev.contextWindow;
        const used = Number(merged.contextUsed) || 0;
        const win = Number(merged.contextWindow) || 0;
        merged.contextPct =
          win > 0
            ? Math.min(100, Math.round((used / win) * 1000) / 10)
            : merged.contextPct;
      }
    }
    return merged;
  }
  // 新值无意义：保留旧值（即使 force，也别用 0/0 冲掉）
  return prev;
}

function normalizeUsage(raw, model, resultEv) {
  const u =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  // modelUsage 可提供更准的 model 名与窗口
  const picked = pickModelUsageEntry(resultEv);
  let modelStr =
    model != null && String(model).trim()
      ? String(model).trim().slice(0, 200)
      : null;
  if (picked && picked.key) {
    // result.modelUsage 的 key 常带 [1M] 后缀，比 message.model 更准
    if (!modelStr || (!/\[1m\]/i.test(modelStr) && /\[1m\]/i.test(picked.key))) {
      modelStr = String(picked.key).trim().slice(0, 200);
    } else if (!modelStr) {
      modelStr = String(picked.key).trim().slice(0, 200);
    }
  }

  // 优先 raw；若 raw 全 0 而 modelUsage 有数，回退 modelUsage 计数
  let input = clampNonNegInt(u.input_tokens ?? u.inputTokens ?? 0);
  let output = clampNonNegInt(u.output_tokens ?? u.outputTokens ?? 0);
  let cacheRead = clampNonNegInt(
    u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? 0
  );
  let cacheCreate = clampNonNegInt(
    u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? 0
  );
  if (
    input + output + cacheRead + cacheCreate === 0 &&
    picked &&
    picked.entry &&
    typeof picked.entry === 'object'
  ) {
    const e = picked.entry;
    input = clampNonNegInt(e.inputTokens ?? e.input_tokens ?? 0);
    output = clampNonNegInt(e.outputTokens ?? e.output_tokens ?? 0);
    cacheRead = clampNonNegInt(
      e.cacheReadInputTokens ?? e.cache_read_input_tokens ?? 0
    );
    cacheCreate = clampNonNegInt(
      e.cacheCreationInputTokens ?? e.cache_creation_input_tokens ?? 0
    );
  }

  // 上下文占用≈非缓存输入 + 缓存读 + 新建缓存（常见 statusline 估算）
  const contextUsed = input + cacheRead + cacheCreate;
  const contextWindow = inferContextWindow(modelStr || model, resultEv);
  let pct = null;
  if (contextWindow > 0 && contextUsed > 0) {
    pct = Math.min(
      100,
      Math.round((contextUsed / contextWindow) * 1000) / 10
    );
    if (!Number.isFinite(pct)) pct = null;
  } else if (contextWindow > 0 && contextUsed === 0) {
    // 占位 0 token：不报 0%（前端显示 —），避免“假满空”
    pct = null;
  }
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheCreate,
    contextUsed,
    contextWindow,
    contextPct: pct,
    model: modelStr,
  };
}

/**
 * 把本地消息历史拼成可在无 --resume 时使用的上下文提示
 * （用于 /rewind 之后重新建立上下文）
 */
function buildHistoryPrompt(messages, latestUserText) {
  const hist = (messages || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .slice(-30); // 控制长度

  if (!hist.length) return latestUserText;

  const lines = [
    '以下是同一会话中此前的对话摘要（按时间顺序）。请在此基础上继续，不要重复寒暄。',
    '',
  ];
  for (const m of hist) {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const text = String(m.content).slice(0, 4000);
    lines.push(`${role}: ${text}`);
    lines.push('');
  }
  lines.push(`User: ${latestUserText}`);
  return lines.join('\n');
}

module.exports = {
  ClaudeTurn,
  buildHistoryPrompt,
  normalizeUsage,
  isMeaningfulUsage,
  preferUsage,
};
