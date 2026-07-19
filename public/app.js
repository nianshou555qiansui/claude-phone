/* Claude Phone Chat — mobile UI v2 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const inputEl = $('input');
  const btnSend = $('btn-send');
  const btnStop = $('btn-stop');
  const btnMenu = $('btn-menu');
  const btnCloseSidebar = $('btn-close-sidebar');
  const btnNewChat = $('btn-new-chat');
  const btnMode = $('btn-mode');
  const btnCmd = $('btn-cmd');
  const btnSettings = $('btn-settings');
  const sidebar = $('sidebar');
  const sidebarMask = $('sidebar-mask');
  const sessionList = $('session-list');
  const chatTitle = $('chat-title');
  const chatSub = $('chat-sub');
  const statusLine = $('status-line');
  const modePanel = $('mode-panel');
  const modeOptions = $('mode-options');
  const cmdPanel = $('cmd-panel');
  const cmdOptions = $('cmd-options');
  const settingsPanel = $('settings-panel');
  const settingsEnvFields = $('settings-env-fields');
  const settingsModel = $('settings-model');
  const settingsRaw = $('settings-raw');
  const settingsPathEl = $('settings-path');
  const settingsRuntime = $('settings-runtime');
  const settingsMsg = $('settings-msg');
  const btnSettingsSave = $('btn-settings-save');
  const btnSettingsReload = $('btn-settings-reload');
  const chkBackground = $('chk-background');
  const jobPill = $('job-pill');

  let meta = {
    permissionModes: [],
    defaultPermissionMode: 'acceptEdits',
    defaultBackground: true,
    workDir: '',
    commands: [],
  };
  let sessions = [];
  let currentId = null;
  let messages = [];
  let running = false;
  let es = null;
  let streamingId = null;
  let streamingText = '';
  let optimisticId = null;
  let activeJobId = null;

  const BG_KEY = 'cp_background';
  try {
    const saved = localStorage.getItem(BG_KEY);
    if (saved != null) chkBackground.checked = saved === '1';
  } catch {
    /* ignore */
  }
  chkBackground.addEventListener('change', () => {
    try {
      localStorage.setItem(BG_KEY, chkBackground.checked ? '1' : '0');
    } catch {
      /* ignore */
    }
  });

  function modeLabel(id) {
    const m = (meta.permissionModes || []).find((x) => x.id === id);
    return (m && m.label) || id;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      cache: 'no-store',
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || data.message || res.statusText);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function openSidebar(open) {
    sidebar.classList.toggle('hidden', !open);
    sidebarMask.classList.toggle('hidden', !open);
  }

  function hidePanels() {
    modePanel.classList.add('hidden');
    cmdPanel.classList.add('hidden');
    if (settingsPanel) settingsPanel.classList.add('hidden');
  }

  let settingsCache = null;

  async function loadSettings() {
    settingsMsg.textContent = '加载中…';
    try {
      settingsCache = await api('/api/settings');
      renderSettings(settingsCache);
      settingsMsg.textContent = '';
    } catch (e) {
      settingsMsg.textContent = e.message || '加载失败';
    }
  }

  function renderSettings(view) {
    if (!view || !view.ok) {
      settingsEnvFields.innerHTML = `<div class="muted">无法读取 settings</div>`;
      return;
    }
    settingsRuntime.textContent = `${view.user || 'claude'} · uid ${view.uid ?? '?'}`;
    settingsPathEl.textContent = view.path || '';
    settingsModel.value = view.model || '';

    const env = view.env || {};
    const keys = [];
    const seen = new Set();
    for (const k of view.preferredEnvKeys || []) {
      if (!seen.has(k)) {
        keys.push(k);
        seen.add(k);
      }
    }
    for (const k of Object.keys(env)) {
      if (!seen.has(k)) {
        keys.push(k);
        seen.add(k);
      }
    }
    // 保证常用键即使未设置也显示
    for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL']) {
      if (!seen.has(k)) keys.unshift(k);
    }

    settingsEnvFields.innerHTML = keys
      .map((k) => {
        const meta = env[k] || { value: '', secret: /TOKEN|KEY|SECRET|PASS|AUTH/i.test(k), set: false };
        const ph = meta.secret
          ? meta.set
            ? '已设置（留空=不修改；填 __CLEAR__ 删除）'
            : '未设置'
          : '';
        const val = meta.secret ? '' : meta.value || '';
        return `<label class="settings-label"><span class="k">${escapeHtml(k)}</span>
          <input type="${meta.secret ? 'password' : 'text'}" class="settings-input" data-env-key="${escapeHtml(k)}" data-secret="${meta.secret ? '1' : '0'}" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}" autocomplete="off" spellcheck="false" />
        </label>`;
      })
      .join('');

    // raw：仅展示非 secret 的浅拷贝提示
    settingsRaw.value = '（保存时若填写下方 JSON，将整份覆盖 settings.json。密钥请用上方字段改。）\n';
  }

  async function saveSettings() {
    settingsMsg.textContent = '保存中…';
    const envUpdates = {};
    settingsEnvFields.querySelectorAll('[data-env-key]').forEach((input) => {
      const k = input.getAttribute('data-env-key');
      const secret = input.getAttribute('data-secret') === '1';
      const v = input.value;
      if (secret) {
        if (!v) return; // 留空不改
        if (v === '__CLEAR__') {
          envUpdates[k] = '__CLEAR__';
          return;
        }
        envUpdates[k] = v;
      } else {
        // 非 secret：允许清空为删除？这里空字符串写空
        envUpdates[k] = v;
      }
    });

    const body = {
      env: envUpdates,
      model: settingsModel.value.trim() || undefined,
    };

    // 若用户在 raw 里贴了完整 JSON 对象，优先用 raw
    const raw = settingsRaw.value.trim();
    if (raw.startsWith('{')) {
      try {
        body.rawJson = JSON.parse(raw);
        delete body.env;
        delete body.model;
      } catch (e) {
        settingsMsg.textContent = 'raw JSON 无效: ' + e.message;
        return;
      }
    }

    try {
      settingsCache = await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      renderSettings(settingsCache);
      settingsMsg.textContent = '已保存。新开的对话轮次会读到新配置（进行中的任务仍用旧进程环境）。';
      // 清掉 input 里的 secret，避免残留
      settingsEnvFields.querySelectorAll('[data-secret="1"]').forEach((i) => {
        i.value = '';
      });
    } catch (e) {
      settingsMsg.textContent = e.message || '保存失败';
    }
  }

  function setStatus(text, runningFlag) {
    if (!text) {
      statusLine.classList.add('hidden');
      statusLine.textContent = '';
      return;
    }
    statusLine.classList.remove('hidden');
    statusLine.classList.toggle('running', !!runningFlag);
    statusLine.textContent = text;
  }

  function setRunning(v, { background } = {}) {
    running = !!v;
    btnSend.classList.toggle('hidden', running);
    btnStop.classList.toggle('hidden', !running);
    btnSend.disabled = running || !inputEl.value.trim();
    chatSub.textContent = running
      ? background || chkBackground.checked
        ? '后台任务运行中…'
        : '生成中…'
      : '准备就绪';
    if (running && (background || chkBackground.checked)) {
      jobPill.classList.remove('hidden');
      jobPill.textContent = '后台运行中 · 可关网页';
    } else if (!running) {
      jobPill.classList.add('hidden');
      activeJobId = null;
    }
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
  }

  function scrollToBottom(force) {
    const near =
      messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
    if (force || near) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderEmpty() {
    messagesEl.innerHTML = `
      <div class="empty">
        <h2>Claude Phone</h2>
        <div>手机聊天驱动本机 Claude Code<br/>历史可上下滑 · 支持中转</div>
        <div style="margin-top:14px;font-size:13px;line-height:1.6">
          右上角 <b>/</b> 命令 · <b>⚙</b> 中转/API 设置<br/>
          <code>/rewind</code> 回退 · 权限芯片 ≈ Shift+Tab<br/>
          <b>后台任务</b>：勾选=关网页继续；不勾选=断开约4秒后停止
        </div>
      </div>`;
  }

  function bubbleHtml(m, { typing } = {}) {
    const role = m.role;
    if (role === 'system') {
      return `<div class="msg system" data-id="${escapeHtml(m.id || '')}">
        <div class="bubble">${escapeHtml(m.content || '')}</div>
      </div>`;
    }
    const canRewind = role === 'user' && m.id && !String(m.id).startsWith('tmp-');
    const actions = canRewind
      ? `<div class="actions"><button type="button" data-rewind-to="${escapeHtml(m.id)}">回退到此之前</button></div>`
      : role === 'assistant' && m.id
        ? `<div class="actions"><button type="button" data-rewind-last="1">回退本轮 /rewind</button></div>`
        : '';
    return `
      <div class="msg ${role}" data-id="${escapeHtml(m.id || '')}" data-role="${role}">
        <div class="bubble ${typing ? 'typing' : ''}">${escapeHtml(m.content || '')}</div>
        <div class="meta">${role === 'user' ? '你' : 'Claude'}</div>
        ${actions}
      </div>`;
  }

  function renderMessages() {
    if (!messages.length && !streamingId) {
      renderEmpty();
      return;
    }
    let html = messages.map((m) => bubbleHtml(m)).join('');
    if (streamingId != null) {
      html += bubbleHtml(
        { id: streamingId, role: 'assistant', content: streamingText || '…' },
        { typing: true }
      );
    }
    messagesEl.innerHTML = html;
    scrollToBottom(true);
  }

  function renderSessions() {
    if (!sessions.length) {
      sessionList.innerHTML = `<div class="muted tiny" style="padding:8px">暂无对话</div>`;
      return;
    }
    sessionList.innerHTML = sessions
      .map((s) => {
        const active = s.id === currentId ? 'active' : '';
        const t = escapeHtml(s.title || '对话');
        const when = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '';
        return `<div class="session-item ${active}" data-id="${s.id}">
          <div class="row">
            <div style="min-width:0;flex:1">
              <div class="t">${t}</div>
              <div class="s">${escapeHtml(when)} · ${escapeHtml(modeLabel(s.permissionMode))}</div>
            </div>
            <button type="button" class="del" data-del="${s.id}" aria-label="删除">删</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderModes() {
    const cur = currentSession()?.permissionMode || meta.defaultPermissionMode;
    modeOptions.innerHTML = (meta.permissionModes || [])
      .map((m) => {
        const active = m.id === cur ? 'active' : '';
        return `<button type="button" class="mode-opt ${active}" data-mode="${m.id}">
          <div class="n">${escapeHtml(m.label || m.id)}</div>
          <div class="h">${escapeHtml(m.hint || '')}</div>
        </button>`;
      })
      .join('');
    btnMode.textContent = modeLabel(cur);
  }

  function renderCommands() {
    const cmds = meta.commands || [];
    if (!cmds.length) {
      cmdOptions.innerHTML = `<div class="muted tiny">输入 /help</div>`;
      return;
    }
    cmdOptions.innerHTML = cmds
      .map((c) => {
        const alias = (c.aliases && c.aliases[0]) || '/' + c.id;
        return `<button type="button" class="cmd-opt" data-cmd="${escapeHtml(alias)}">
          <div class="n">${escapeHtml(alias)}</div>
          <div class="h">${escapeHtml(c.summary || '')}</div>
        </button>`;
      })
      .join('');
  }

  function currentSession() {
    return sessions.find((s) => s.id === currentId) || null;
  }

  async function loadMeta() {
    meta = await api('/api/meta');
    renderModes();
    renderCommands();
    if (meta.runtime) {
      chatSub.title = `运行用户: ${meta.runtime.user} · ${meta.runtime.settingsPath || ''}`;
    }
    // 仅当本地没存过开关时，跟随服务端默认
    try {
      if (localStorage.getItem(BG_KEY) == null && meta.defaultBackground != null) {
        chkBackground.checked = !!meta.defaultBackground;
      }
    } catch {
      /* ignore */
    }
  }

  async function loadSessions() {
    const data = await api('/api/sessions');
    sessions = data.sessions || [];
    renderSessions();
  }

  async function selectSession(id) {
    currentId = id;
    connectSSE(id);
    const data = await api(`/api/sessions/${encodeURIComponent(id)}`);
    messages = data.messages || [];
    streamingId = null;
    streamingText = '';
    optimisticId = null;

    // 重连恢复进行中的后台任务 partial
    if (data.activeJob && data.activeJob.status === 'running') {
      activeJobId = data.activeJob.id;
      streamingId = data.activeJob.assistantId;
      streamingText = data.activeJob.partialText || '';
      setRunning(true, { background: !!data.activeJob.background });
      setStatus(
        data.activeJob.background
          ? '后台任务仍在运行（已恢复进度）…'
          : '任务仍在运行…',
        true
      );
    } else {
      setRunning(!!data.running);
    }

    chatTitle.textContent = data.session?.title || '对话';
    renderMessages();
    renderSessions();
    renderModes();
    openSidebar(false);
    hidePanels();
  }

  async function newChat() {
    const data = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ permissionMode: meta.defaultPermissionMode }),
    });
    await loadSessions();
    await selectSession(data.session.id);
    inputEl.focus();
  }

  async function deleteSession(id) {
    if (!confirm('删除这个对话？')) return;
    await api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (currentId === id) {
      currentId = null;
      messages = [];
      if (es) {
        es.close();
        es = null;
      }
      chatTitle.textContent = 'Claude Phone';
      renderEmpty();
      setRunning(false);
    }
    await loadSessions();
    if (!currentId && sessions[0]) await selectSession(sessions[0].id);
  }

  function connectSSE(sessionId) {
    if (es) {
      es.close();
      es = null;
    }
    es = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    es.onmessage = (ev) => {
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(data);
    };
    es.onerror = () => setStatus('连接中断，重连中…', false);
  }

  function upsertMessage(msg) {
    if (!msg || !msg.id) {
      messages.push(msg);
      return;
    }
    const i = messages.findIndex((m) => m.id === msg.id);
    if (i >= 0) messages[i] = msg;
    else messages.push(msg);
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case 'hello':
        if (ev.activeJob && ev.activeJob.status === 'running') {
          activeJobId = ev.activeJob.id;
          streamingId = ev.activeJob.assistantId || streamingId;
          if (ev.activeJob.partialText && !streamingText) {
            streamingText = ev.activeJob.partialText;
          }
          setRunning(true, { background: !!ev.activeJob.background });
          setStatus(
            ev.activeJob.background
              ? '后台任务运行中（可关网页）…'
              : '生成中…',
            true
          );
          renderMessages();
        } else {
          setRunning(!!ev.running);
          setStatus(ev.running ? '生成中…' : '', !!ev.running);
        }
        break;
      case 'job_started':
        if (ev.job) {
          activeJobId = ev.job.id;
          setRunning(true, { background: !!ev.job.background });
          if (ev.job.background) {
            setStatus('后台任务已启动 · 关掉网页也会继续', true);
            jobPill.classList.remove('hidden');
          }
        }
        if (ev.permissionMode) {
          setStatus(
            `运行中 · 权限 ${modeLabel(ev.permissionMode)}`,
            true
          );
        }
        break;
      case 'permission_mode':
        setStatus(
          `权限生效: ${ev.label || ev.effective || ev.requested}` +
            (ev.effective && ev.requested && ev.effective !== ev.requested
              ? `（请求 ${ev.requested}）`
              : ''),
          true
        );
        break;
      case 'job_updated':
        if (ev.job && ev.job.id === activeJobId && ev.job.status !== 'running') {
          jobPill.classList.add('hidden');
        }
        break;
      case 'user_message':
        if (ev.message) {
          if (optimisticId) {
            messages = messages.filter((m) => m.id !== optimisticId);
            optimisticId = null;
          }
          upsertMessage(ev.message);
          renderMessages();
        }
        break;
      case 'system_message':
        if (ev.message) {
          upsertMessage(ev.message);
          renderMessages();
        }
        break;
      case 'rewound':
        messages = ev.messages || [];
        streamingId = null;
        streamingText = '';
        setRunning(false);
        setStatus('已回退', false);
        if (ev.session) {
          sessions = sessions.map((s) => (s.id === ev.session.id ? ev.session : s));
          chatTitle.textContent = ev.session.title || '对话';
          renderModes();
        }
        renderMessages();
        loadSessions();
        break;
      case 'assistant_start':
        streamingId = ev.messageId;
        if (!ev.resume) streamingText = '';
        if (ev.jobId) activeJobId = ev.jobId;
        setRunning(true, { background: !!ev.background || chkBackground.checked });
        setStatus(
          chkBackground.checked
            ? '后台任务运行中 · 可关网页…'
            : 'Claude 正在思考 / 操作…',
          true
        );
        renderMessages();
        break;
      case 'assistant_delta':
        if (ev.messageId === streamingId || streamingId == null) {
          streamingId = ev.messageId;
          // resume 推送的是全量 partial，普通 delta 是增量
          if (ev.resume) streamingText = ev.text || '';
          else streamingText += ev.text || '';
          const bubbles = messagesEl.querySelectorAll('.msg.assistant .bubble.typing');
          const last = bubbles[bubbles.length - 1];
          if (last) {
            last.textContent = streamingText;
            scrollToBottom(false);
          } else {
            renderMessages();
          }
        }
        break;
      case 'tool':
        setStatus(`工具: ${ev.tool?.name || '…'}`, true);
        break;
      case 'assistant_done':
        streamingId = null;
        streamingText = '';
        if (ev.message) upsertMessage(ev.message);
        setRunning(false);
        setStatus('');
        renderMessages();
        loadSessions();
        break;
      case 'status':
        setRunning(ev.state === 'running');
        if (ev.state === 'running') setStatus('生成中…', true);
        else if (!statusLine.textContent.includes('已回退')) setStatus('');
        break;
      case 'aborted':
        setRunning(false);
        setStatus('已停止', false);
        streamingId = null;
        break;
      case 'error':
        setStatus(ev.message || '出错', false);
        break;
      case 'session_updated':
        if (ev.session) {
          sessions = sessions.map((s) => (s.id === ev.session.id ? ev.session : s));
          if (currentId === ev.session.id) {
            chatTitle.textContent = ev.session.title || '对话';
            renderModes();
          }
          renderSessions();
        }
        break;
      default:
        break;
    }
  }

  async function sendMessage(textOverride) {
    const text = (textOverride != null ? textOverride : inputEl.value).trim();
    if (!text || running) return;
    if (!currentId) await newChat();
    if (textOverride == null) {
      inputEl.value = '';
      autoGrow();
    }
    btnSend.disabled = true;
    hidePanels();

    optimisticId = 'tmp-' + Date.now();
    messages.push({
      id: optimisticId,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    });
    renderMessages();

    try {
      const res = await api(`/api/sessions/${encodeURIComponent(currentId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: text,
          background: !!chkBackground.checked,
        }),
      });
      if (res.jobId) activeJobId = res.jobId;
      // 本地命令：不会有 assistant 流，刷新列表
      if (res.local) {
        optimisticId = null;
        const data = await api(`/api/sessions/${encodeURIComponent(currentId)}`);
        messages = data.messages || [];
        setRunning(false);
        renderMessages();
        loadSessions();
      } else if (res.background) {
        setStatus('后台任务已提交 · 关掉网页也会继续跑', true);
        jobPill.classList.remove('hidden');
        jobPill.textContent = '后台运行中 · 可关网页';
      }
    } catch (e) {
      if (optimisticId) {
        messages = messages.filter((m) => m.id !== optimisticId);
        optimisticId = null;
        renderMessages();
      }
      setStatus(e.message || '发送失败', false);
      setRunning(false);
      if (e.status === 409) setStatus('还在生成中，请稍候或点停止', false);
    }
  }

  async function stopTurn() {
    if (!currentId || !running) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(currentId)}/abort`, {
        method: 'POST',
        body: '{}',
      });
    } catch (e) {
      setStatus(e.message || '停止失败', false);
    }
  }

  async function setMode(mode) {
    if (!currentId) {
      meta.defaultPermissionMode = mode;
      renderModes();
      hidePanels();
      return;
    }
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissionMode: mode }),
      });
      const pm = data.session?.permissionMode || mode;
      sessions = sessions.map((s) =>
        s.id === currentId ? { ...s, permissionMode: pm } : s
      );
      renderModes();
      hidePanels();
      setStatus(`权限已设为 ${modeLabel(pm)} · 下一条消息生效`, false);
    } catch (e) {
      setStatus(e.message || '切换失败', false);
    }
  }

  async function rewindLast() {
    if (!currentId || running) return;
    if (!confirm('回退最近一轮用户消息及其回复？')) return;
    try {
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}/rewind`, {
        method: 'POST',
        body: JSON.stringify({ turns: 1 }),
      });
      messages = data.messages || [];
      renderMessages();
      loadSessions();
    } catch (e) {
      setStatus(e.message || '回退失败', false);
    }
  }

  async function rewindTo(messageId) {
    if (!currentId || running) return;
    if (!confirm('回退到该条消息之前？（该条及之后都会删除）')) return;
    try {
      // 回退到「该条之前」= keep 上一条
      const idx = messages.findIndex((m) => m.id === messageId);
      const keepId = idx > 0 ? messages[idx - 1].id : null;
      const data = await api(`/api/sessions/${encodeURIComponent(currentId)}/rewind`, {
        method: 'POST',
        body: JSON.stringify(keepId ? { messageId: keepId } : { turns: 999 }),
      });
      // 若 keepId null 用 clear 语义：turns 大
      if (!keepId) {
        await sendMessage('/clear');
        return;
      }
      messages = data.messages || [];
      renderMessages();
      loadSessions();
    } catch (e) {
      setStatus(e.message || '回退失败', false);
    }
  }

  // events
  btnMenu.addEventListener('click', () => openSidebar(true));
  btnCloseSidebar.addEventListener('click', () => openSidebar(false));
  sidebarMask.addEventListener('click', () => openSidebar(false));
  btnNewChat.addEventListener('click', () => newChat());
  btnSend.addEventListener('click', () => sendMessage());
  btnStop.addEventListener('click', () => stopTurn());
  btnMode.addEventListener('click', () => {
    const open = modePanel.classList.contains('hidden');
    hidePanels();
    if (open) modePanel.classList.remove('hidden');
  });
  btnCmd.addEventListener('click', () => {
    const open = cmdPanel.classList.contains('hidden');
    hidePanels();
    if (open) cmdPanel.classList.remove('hidden');
  });
  btnSettings.addEventListener('click', () => {
    const open = settingsPanel.classList.contains('hidden');
    hidePanels();
    if (open) {
      settingsPanel.classList.remove('hidden');
      loadSettings();
    }
  });
  btnSettingsSave.addEventListener('click', () => saveSettings());
  btnSettingsReload.addEventListener('click', () => loadSettings());

  sessionList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      deleteSession(del.getAttribute('data-del'));
      return;
    }
    const item = e.target.closest('.session-item');
    if (item) selectSession(item.getAttribute('data-id'));
  });

  modeOptions.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-mode]');
    if (opt) setMode(opt.getAttribute('data-mode'));
  });

  cmdOptions.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-cmd]');
    if (!opt) return;
    const cmd = opt.getAttribute('data-cmd');
    hidePanels();
    if (cmd === '/rewind' || cmd === '/rw' || cmd === '/undo') {
      rewindLast();
      return;
    }
    if (cmd === '/help' || cmd === '/clear' || cmd === '/status' || cmd === '/compact') {
      sendMessage(cmd);
      return;
    }
    // 需要参数的：填入输入框
    inputEl.value = cmd + ' ';
    autoGrow();
    inputEl.focus();
  });

  messagesEl.addEventListener('click', (e) => {
    const to = e.target.closest('[data-rewind-to]');
    if (to) {
      rewindTo(to.getAttribute('data-rewind-to'));
      return;
    }
    const last = e.target.closest('[data-rewind-last]');
    if (last) rewindLast();
  });

  inputEl.addEventListener('input', () => {
    autoGrow();
    btnSend.disabled = running || !inputEl.value.trim();
    if (inputEl.value.trim() === '/') {
      hidePanels();
      cmdPanel.classList.remove('hidden');
    }
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  (async function boot() {
    try {
      await loadMeta();
      await loadSessions();
      if (sessions[0]) await selectSession(sessions[0].id);
      else await newChat();
    } catch (e) {
      chatSub.textContent = '加载失败: ' + (e.message || e);
      renderEmpty();
    }
  })();
})();
