'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const { StringDecoder } = require('string_decoder');
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
    // 手机审批：注入 hooks 设置文件与 hook 寻址环境变量
    this.settingsPath = opts.settingsPath || null;
    this.extraEnv = opts.extraEnv || null;
    // 事件流落盘：子进程直写文件（不接父管道），服务重启不断流；attach 可接管
    this.streamPath = opts.streamPath || null;
    this.errPath = opts.errPath || null;
    this.pid = null;
    this._tailPos = 0;
    this._errPos = 0;
    this._tailTimer = null;
    this._tailDecoder = null;
    this._pidDeadChecks = 0;
    this._sawResult = false;
    this._finished = false;
    this._live = true; // attach 追平前为 false（接线层据此静默重放）
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
    if (this.settingsPath) {
      args.push('--settings', this.settingsPath);
    }

    args.push(this.prompt);

    this.emit('status', {
      state: 'starting',
      workDir: this.workDir,
      permissionMode: this.permissionMode,
      resume: !!this.resumeSessionId,
    });

    // CLI 临时目录固定到持久路径：Claude Code 的后台任务目录取自 os.tmpdir()
    // （尊重 TMPDIR）。若留在 /tmp，systemd PrivateTmp 重启换新后基路径消失，
    // Bash 工具会 mkdir ENOENT——固定 TMPDIR 后既躲开该问题又保留 PrivateTmp 加固。
    const cliTmpDir = require('path').join(config.dataDir, 'cli-tmp');
    try {
      fs.mkdirSync(cliTmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
    const spawnEnv = {
      ...process.env,
      HOME: process.env.HOME || require('os').homedir(),
      PATH: process.env.PATH || '/usr/bin:/bin',
      TERM: 'dumb',
      NO_COLOR: '1',
      CI: '1',
      TMPDIR: cliTmpDir,
      ...(this.extraEnv || {}),
    };
    // 文件模式：子进程直写事件流文件。刻意【不用 detached】——实测 setsid 会
    // 破坏 Claude Code Bash 工具（沙箱建临时目录 ENOENT）。跨重启存活依靠：
    // 文件 stdio（父死管道不破裂）+ unref + systemd KillMode=process（只杀主进程）。
    let outFd = null;
    let errFd = null;
    if (this.streamPath) {
      try {
        if (!this.errPath) this.errPath = this.streamPath + '.err';
        fs.writeFileSync(this.streamPath, '');
        fs.writeFileSync(this.errPath, '');
        outFd = fs.openSync(this.streamPath, 'a');
        errFd = fs.openSync(this.errPath, 'a');
      } catch (err) {
        try { if (outFd != null) fs.closeSync(outFd); } catch { /* ignore */ }
        outFd = null;
        errFd = null;
        this.streamPath = null;
        this.errPath = null;
      }
    }

    try {
      this.proc = spawn(this.claudeBin, args, {
        cwd: this.workDir,
        env: spawnEnv,
        stdio: this.streamPath ? ['ignore', outFd, errFd] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      if (outFd != null) { try { fs.closeSync(outFd); } catch { /* ignore */ } }
      if (errFd != null) { try { fs.closeSync(errFd); } catch { /* ignore */ } }
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

    if (outFd != null) { try { fs.closeSync(outFd); } catch { /* ignore */ } }
    if (errFd != null) { try { fs.closeSync(errFd); } catch { /* ignore */ } }
    this.pid = (this.proc && this.proc.pid) || null;

    if (this.streamPath) {
      // 父进程可先退出（重启），子进程照常写文件
      this.proc.unref();
      this._startTail();
    } else {
      this.proc.stdout.setEncoding('utf8');
      this.proc.stderr.setEncoding('utf8');
      this.proc.stdout.on('data', (chunk) => this._onStdout(chunk));
      this.proc.stderr.on('data', (chunk) => this._onStderrText(String(chunk)));
    }

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
      if (this._finished) return;
      this._finished = true;
      this._clearTimer();
      this._stopTail();
      this.exitCode = code;
      if (this.streamPath) {
        this._readNewOnce();
        this._readErrOnce();
      }
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
    // 单 pid 击杀（未 detached，与父同进程组，禁用 -pid 组杀）；
    // CLI 收到 SIGTERM 会自行清理其工具子进程。attach 模式只有 pid 没有 proc。
    const pid = (this.proc && this.proc.pid) || this.pid;
    const killOne = (sig) => {
      try {
        process.kill(pid, sig);
      } catch {
        /* ignore */
      }
    };
    if (pid) {
      killOne('SIGTERM');
      setTimeout(() => killOne('SIGKILL'), 2000).unref?.();
    }
    this.emit('aborted', { reason });
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** 接线层用：attach 追平期间为 false（此时不广播，只重建状态） */
  isLive() {
    return this._live;
  }

  _onStderrText(text) {
    if (!text || !text.trim()) return;
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
  }

  // ===== 事件流文件尾随（文件模式执行 + 重启接管共用）=====

  _startTail() {
    if (this._tailTimer) return;
    if (!this._tailDecoder) this._tailDecoder = new StringDecoder('utf8');
    this._tailTimer = setInterval(() => {
      this._readNewOnce();
      this._readErrOnce();
      // attach 模式没有 proc 句柄：靠 pid 探活判断进程结束
      if (!this.proc) this._checkPidAlive();
    }, 250);
    if (this._tailTimer.unref) this._tailTimer.unref();
  }

  _stopTail() {
    if (this._tailTimer) {
      clearInterval(this._tailTimer);
      this._tailTimer = null;
    }
  }

  /** 读事件流新增字节（StringDecoder 保多字节边界），喂进行解析器 */
  _readNewOnce() {
    if (!this.streamPath) return false;
    let progressed = false;
    try {
      const st = fs.statSync(this.streamPath);
      while (st.size > this._tailPos) {
        const fd = fs.openSync(this.streamPath, 'r');
        try {
          const len = Math.min(st.size - this._tailPos, 1024 * 1024);
          const buf = Buffer.alloc(len);
          const read = fs.readSync(fd, buf, 0, len, this._tailPos);
          if (read <= 0) break;
          this._tailPos += read;
          progressed = true;
          const text = this._tailDecoder
            ? this._tailDecoder.write(buf.subarray(0, read))
            : buf.subarray(0, read).toString('utf8');
          if (text) this._onStdout(text);
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {
      /* 文件暂不可读：下个 tick 再试 */
    }
    return progressed;
  }

  _readErrOnce() {
    if (!this.errPath) return;
    try {
      const st = fs.statSync(this.errPath);
      if (st.size > this._errPos) {
        const fd = fs.openSync(this.errPath, 'r');
        try {
          const len = Math.min(st.size - this._errPos, 256 * 1024);
          const buf = Buffer.alloc(len);
          const read = fs.readSync(fd, buf, 0, len, this._errPos);
          if (read > 0) {
            this._errPos += read;
            this._onStderrText(buf.subarray(0, read).toString('utf8'));
          }
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch {
      /* ignore */
    }
  }

  _checkPidAlive() {
    if (!this.pid || this._finished) return;
    try {
      process.kill(this.pid, 0);
      this._pidDeadChecks = 0;
    } catch {
      this._pidDeadChecks += 1;
      // 连续两次探不到（约 500ms）判死，排干残余后终局化
      if (this._pidDeadChecks >= 2) this._finishFromTail();
    }
  }

  /** attach 模式终局化：拿不到 exit code，以 result 事件为完成依据 */
  _finishFromTail() {
    if (this._finished) return;
    this._finished = true;
    this._stopTail();
    this._clearTimer();
    this._readNewOnce();
    this._readErrOnce();
    if (this.stdoutBuf.trim()) {
      this._handleLine(this.stdoutBuf.trim());
      this.stdoutBuf = '';
    }
    const ok = !this.killed && this._sawResult && !this.lastResultIsError;
    this.emit('done', {
      ok,
      assistantText: this.assistantText,
      claudeSessionId: this.claudeSessionId,
      code: this._sawResult ? 0 : null,
      usage: this.lastUsage,
      model: this.lastModel,
      durationMs: this.lastDurationMs || Date.now() - this.startedAt,
      errorMessage: this.lastErrorMessage,
      resultIsError: this.lastResultIsError,
    });
  }

  /**
   * 服务重启后接管仍在运行（或停机期间已自行跑完）的回合。
   * 先整文件静默重放重建状态（isLive()=false），随后转 live 尾随。
   */
  static attach(opts) {
    const t = new ClaudeTurn({
      prompt: '(reattach)',
      workDir: opts.workDir,
      permissionMode: opts.permissionMode,
      timeoutMs: opts.timeoutMs,
    });
    t.streamPath = opts.streamPath;
    t.errPath = opts.errPath || null;
    t.pid = opts.pid || null;
    t.startedAt = Number(opts.startedAt) || Date.now();
    t.claudeSessionId = opts.claudeSessionId || null;
    t._live = false;
    return t;
  }

  attachStart() {
    this._tailDecoder = new StringDecoder('utf8');
    while (this._readNewOnce()) {
      /* 追平既有内容 */
    }
    this._readErrOnce();
    this._live = true;
    this.emit('live', {
      assistantText: this.assistantText,
      claudeSessionId: this.claudeSessionId,
    });

    let alive = false;
    if (this.pid) {
      try {
        process.kill(this.pid, 0);
        alive = true;
      } catch {
        /* dead */
      }
    }
    if (!alive) {
      // 停机期间已自行结束：从文件终局化（有 result 即按完成收尾）
      this._finishFromTail();
      return this;
    }
    const remain = Math.max(30000, this.timeoutMs - (Date.now() - this.startedAt));
    this.timer = setTimeout(() => {
      this.emit('error', { message: `超时 ${Math.round(this.timeoutMs / 1000)}s` });
      this.abort('timeout');
    }, remain);
    this._startTail();
    return this;
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
      this._sawResult = true;
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
        // 中转/API 错误常见形状：subtype=success + is_error，错误文本在 result 里
        const resultMsg =
          typeof ev.result === 'string' && ev.result.trim() ? ev.result.trim() : '';
        const msg =
          errParts.filter(Boolean).join('; ') ||
          resultMsg ||
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
    // full：落盘/按需详情；input：SSE 摘要（小）
    const rawIn = block.input != null ? block.input : block.arguments;
    const full = sanitizeToolPayload(rawIn, 48000);
    const input = summarizeToolPayload(full, 1200);
    this.emit('tool', {
      phase: 'start',
      id: id ? String(id).slice(0, 80) : null,
      name,
      input,
      fullInput: full,
      ts: Date.now(),
    });
  }

  /**
   * Normalize + emit tool_result. Matches start by tool_use_id when present.
   */
  _emitToolResult(block) {
    if (!block || typeof block !== 'object') return;
    // Ignore pure envelope types without a result body (prevents self-dump)
    if (
      (block.type === 'tool_result' || block.subtype === 'tool_result') &&
      block.content == null &&
      block.result == null &&
      block.output == null &&
      !block.is_error &&
      !block.isError &&
      !block.error
    ) {
      return;
    }
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
    let raw;
    if (block.content != null) raw = block.content;
    else if (block.result != null) raw = block.result;
    else if (block.output != null) raw = block.output;
    else if (block.error != null) raw = block.error;
    else raw = '';
    const full = sanitizeToolPayload(raw, 96000);
    const result = summarizeToolPayload(full, 2000);
    this.emit('tool', {
      phase: 'result',
      id: id ? String(id).slice(0, 80) : null,
      name: block.name ? String(block.name).slice(0, 120) : null,
      result,
      fullResult: full,
      isError,
      ts: Date.now(),
    });
  }
}

/**
 * 规范化工具载荷为 JSON 安全值，并做硬上限截断。
 * full 用较大 cap（落盘/按需详情）；summarizeToolPayload 再压成 SSE 摘要。
 * @param {any} value
 * @param {number} maxChars
 */
function sanitizeToolPayload(value, maxChars) {
  // 硬上限抬到 96KB 级：够看完整 Bash 输出/文件片段，又不至于单步撑爆 2c2g
  const cap = Math.max(200, Math.min(96_000, Number(maxChars) || 1200));
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
 * 从 full 载荷再压一版摘要（供 SSE / 消息气泡默认展示）。
 * 若本身已短，原样返回；否则带 _truncated 标记，前端可显示「加载全文」。
 */
function summarizeToolPayload(value, maxChars) {
  const cap = Math.max(200, Math.min(8000, Number(maxChars) || 1200));
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value.length <= cap) return value;
    return value.slice(0, cap) + `…(+${value.length - cap})`;
  }
  if (typeof value === 'object' && value._truncated) {
    // 已经是截断摘要对象
    return value;
  }
  let s;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (s.length <= cap) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return {
      _truncated: true,
      keys: Object.keys(value).slice(0, 12),
      preview: s.slice(0, cap) + `…(+${s.length - cap})`,
    };
  }
  return s.slice(0, cap) + `…(+${s.length - cap})`;
}

/** 判断摘要是否相对 full 有损失（决定是否显示「加载全文」） */
function toolPayloadIsTruncated(summary, full) {
  if (full == null) return false;
  if (summary == null) return true;
  if (summary && typeof summary === 'object' && summary._truncated) return true;
  try {
    const a =
      typeof summary === 'string' ? summary : JSON.stringify(summary);
    const b = typeof full === 'string' ? full : JSON.stringify(full);
    if (typeof a === 'string' && /…\(\+\d+\)\s*$/.test(a)) return true;
    return a !== b && b.length > a.length;
  } catch {
    return false;
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
 * 把网页权限模式写成模型可见的短前缀。
 * CLI 的 --permission-mode 只影响工具门闸，不会进入对话上下文；用户问
 * 「现在什么模式」时模型会误答「普通 agent」。每轮前缀一小段即可对齐体感。
 * 注意与 Plan / Ultracode / Fast 等对话编排模式区分开。
 */
const PERMISSION_MODE_BLURBS = {
  bypassPermissions:
    '全部放行（bypassPermissions）：工具执行不经手机审批；CLI 已加 --dangerously-skip-permissions。',
  acceptEdits:
    '接受编辑（acceptEdits）：工作区内文件编辑等自动放行；有副作用的 Bash/MCP 仍可能触发手机审批。',
  plan: '仅计划（plan）：只读探索，不改源码；不触发手机审批。',
  default:
    '默认（default）：有副作用的工具经手机审批卡片；只读工具自动放行。',
  dontAsk:
    '仅白名单（dontAsk）：不在 permissions.allow 中的工具一律拒绝；不弹手机审批。',
  auto: '自动（auto）：由 CLI 自动模式处理权限（需 CLI 支持）。',
};

function permissionModeContext(mode) {
  const m = String(mode || '').trim() || 'default';
  const blurb = PERMISSION_MODE_BLURBS[m] || `权限模式: ${m}`;
  return [
    '[Claude Phone 运行环境 — 非用户原话]',
    `当前网页权限模式: ${blurb}`,
    '这与 Plan / Ultracode / Fast 等对话编排模式不同。若用户问「当前模式 / 是不是 bypass / 全部放行吗」，请按上述权限模式回答，并说明工具门闸状态。',
    '',
  ].join('\n');
}

/** 给本轮 prompt 加上权限模式前缀（幂等：已带标记则不重复） */
function decoratePromptWithPermissionMode(prompt, mode) {
  const body = String(prompt || '');
  if (!body.trim()) return body;
  if (body.startsWith('[Claude Phone 运行环境')) return body;
  return permissionModeContext(mode) + body;
}

/**
 * 把本地消息历史拼成可在无 --resume 时使用的上下文提示
 * （用于 /rewind 之后重新建立上下文）
 */
function buildHistoryPrompt(messages, latestUserText) {
  const latest = String(latestUserText || '').trim();
  let hist = (messages || []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && m.content
  );

  // 再保险：若末条 user 与 latest 相同则去掉（调用方通常已去掉）
  if (hist.length && latest) {
    const last = hist[hist.length - 1];
    if (
      last.role === 'user' &&
      String(last.content || '').trim() === latest
    ) {
      hist = hist.slice(0, -1);
    }
  }

  // 控制条数与总字符，避免 2c2g 上 prompt 过大拖垮 CLI
  hist = hist.slice(-30);
  const MAX_TOTAL = 48000;
  let total = 0;
  const clipped = [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const text = String(hist[i].content || '').slice(0, 4000);
    if (total + text.length > MAX_TOTAL && clipped.length) break;
    total += text.length;
    clipped.push({ role: hist[i].role, content: text });
  }
  clipped.reverse();

  if (!clipped.length) return latestUserText;

  const lines = [
    '以下是同一会话中此前的对话摘要（按时间顺序）。请在此基础上继续，不要重复寒暄。',
    '',
  ];
  for (const m of clipped) {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    lines.push(`${role}: ${m.content}`);
    lines.push('');
  }
  lines.push(`User: ${latestUserText}`);
  return lines.join('\n');
}

/**
 * 清理 cli-tmp 中老化的 CC 任务目录。原先在 /tmp 时由系统老化机制回收，
 * TMPDIR 固定进 data/cli-tmp 后由这里接管。只在会话级目录（第 3 层）按
 * mtime 判老：运行中的会话至多分钟级龄，7 天阈值绝对安全。
 */
function cleanupOldTmpEntries(dir, maxAgeMs = 7 * 24 * 3600 * 1000) {
  const path = require('path');
  const now = Date.now();
  let removed = 0;
  const walk = (d, depth) => {
    let names;
    try {
      names = fs.readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p2 = path.join(d, name);
      let st;
      try {
        st = fs.statSync(p2);
      } catch {
        continue;
      }
      if (!st.isDirectory()) {
        if (now - st.mtimeMs > maxAgeMs) {
          try { fs.rmSync(p2, { force: true }); removed += 1; } catch { /* ignore */ }
        }
        continue;
      }
      if (depth >= 2) {
        if (now - st.mtimeMs > maxAgeMs) {
          try { fs.rmSync(p2, { recursive: true, force: true }); removed += 1; } catch { /* ignore */ }
        }
      } else {
        walk(p2, depth + 1);
      }
    }
  };
  walk(dir, 0);
  return removed;
}

module.exports = {
  ClaudeTurn,
  cleanupOldTmpEntries,
  buildHistoryPrompt,
  decoratePromptWithPermissionMode,
  permissionModeContext,
  sanitizeToolPayload,
  summarizeToolPayload,
  toolPayloadIsTruncated,
  normalizeUsage,
  isMeaningfulUsage,
  preferUsage,
};
