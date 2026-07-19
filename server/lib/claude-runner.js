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
      if (text.trim()) this.emit('stderr', { text });
    });

    this.proc.on('error', (err) => {
      this._clearTimer();
      this.emit('error', { message: err.message });
      this.emit('done', {
        ok: false,
        assistantText: this.assistantText,
        claudeSessionId: this.claudeSessionId,
        code: null,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs || Date.now() - this.startedAt,
      });
    });

    this.proc.on('close', (code, signal) => {
      this._clearTimer();
      this.exitCode = code;
      if (this.stdoutBuf.trim()) {
        this._handleLine(this.stdoutBuf.trim());
        this.stdoutBuf = '';
      }
      this.emit('done', {
        ok: code === 0 && !this.killed,
        assistantText: this.assistantText,
        claudeSessionId: this.claudeSessionId,
        code,
        signal,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs || Date.now() - this.startedAt,
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
            this.emit('tool', {
              name: block.name,
              id: block.id,
              input: block.input,
            });
          }
        }
      }
      // 有些路径 message.usage 带在 assistant 上
      if (ev.message.usage) {
        this.lastUsage = normalizeUsage(ev.message.usage, ev.message.model || this.lastModel);
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
      if (ev.usage) {
        this.lastUsage = normalizeUsage(ev.usage, this.lastModel, ev);
      }
      if (ev.duration_ms != null) this.lastDurationMs = Number(ev.duration_ms) || null;
      if (ev.model) this.lastModel = ev.model;
      // modelUsage 取第一个模型名
      if (!this.lastModel && ev.modelUsage && typeof ev.modelUsage === 'object') {
        const keys = Object.keys(ev.modelUsage);
        if (keys[0]) this.lastModel = keys[0];
      }
      if (this.lastUsage) this.emit('usage', this.lastUsage);
      this.emit('result', {
        ...ev,
        usage: this.lastUsage,
        model: this.lastModel,
        durationMs: this.lastDurationMs,
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
}

/**
 * 规范化 stream-json 里的 usage，供状态栏 Context 条使用。
 * context 窗口：优先 result 字段，否则按模型名启发式（含 1M / 200k）。
 */
function inferContextWindow(model, resultEv) {
  if (resultEv && typeof resultEv === 'object') {
    const direct =
      resultEv.context_window ||
      resultEv.contextWindow ||
      resultEv.max_tokens_context;
    const n = Number(direct);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  const m = String(model || '').toLowerCase();
  if (/\[1m\]|1m\b|1000000|1,000,000/.test(m)) return 1000000;
  if (/200k|200000/.test(m)) return 200000;
  if (/haiku|sonnet|opus|fable|claude/.test(m)) return 200000;
  // 中转大上下文常见 1M 标记；未知默认 200k
  return 200000;
}

function clampNonNegInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), 1e12);
}

function normalizeUsage(raw, model, resultEv) {
  const u =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const input = clampNonNegInt(u.input_tokens ?? u.inputTokens ?? 0);
  const output = clampNonNegInt(u.output_tokens ?? u.outputTokens ?? 0);
  const cacheRead = clampNonNegInt(
    u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? 0
  );
  const cacheCreate = clampNonNegInt(
    u.cache_creation_input_tokens ?? u.cacheCreationInputTokens ?? 0
  );
  // 上下文占用≈非缓存输入 + 缓存读 + 新建缓存（常见 statusline 估算）
  const contextUsed = input + cacheRead + cacheCreate;
  const contextWindow = inferContextWindow(model, resultEv);
  let pct = null;
  if (contextWindow > 0) {
    pct = Math.min(
      100,
      Math.round((contextUsed / contextWindow) * 1000) / 10
    );
    if (!Number.isFinite(pct)) pct = null;
  }
  const modelStr =
    model != null && String(model).trim()
      ? String(model).trim().slice(0, 200)
      : null;
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

module.exports = { ClaudeTurn, buildHistoryPrompt, normalizeUsage };
