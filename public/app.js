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
  const btnImportSession = $('btn-import-session');
  const btnMode = $('btn-mode');
  const btnCmd = $('btn-cmd');
  const btnSettings = $('btn-settings');
  const btnModel = $('btn-model');
  const modelChipLabel = $('model-chip-label');
  const modelSheet = $('model-sheet');
  const modelSheetMask = $('model-sheet-mask');
  const modelList = $('model-list');
  const modelSearch = $('model-search');
  const modelSheetMsg = $('model-sheet-msg');
  const modelSheetSub = $('model-sheet-sub');
  const btnModelClose = $('btn-model-close');
  const btnModelAdd = $('btn-model-add');
  const modelCustomId = $('model-custom-id');
  const modelCustomLabel = $('model-custom-label');
  const resumeSheet = $('resume-sheet');
  const resumeSheetMask = $('resume-sheet-mask');
  const resumeList = $('resume-list');
  const resumeSearch = $('resume-search');
  const resumeSheetMsg = $('resume-sheet-msg');
  const resumeSheetSub = $('resume-sheet-sub');
  const btnResumeClose = $('btn-resume-close');
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

  /** @type {{ models: any[], settingsModel: string|null, groups: any[] }|null} */
  let modelCatalog = null;
  let modelScope = 'session'; // session | default
  let modelFilter = '';
  let selectingModel = false;

  /** @type {any[]|null} */
  let resumeCatalog = null;
  let resumeFilter = '';
  let importingResume = false;

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
    const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 60000;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const { timeoutMs: _t, headers: extraHeaders, ...rest } = opts;
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
        ...rest,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || data.message || res.statusText);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('请求超时');
        err.status = 408;
        throw err;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function openSidebar(open) {
    sidebar.classList.toggle('hidden', !open);
    sidebarMask.classList.toggle('hidden', !open);
  }

  function hidePanels() {
    modePanel.classList.add('hidden');
    cmdPanel.classList.add('hidden');
    if (settingsPanel) settingsPanel.classList.add('hidden');
    closeModelSheet();
    closeResumeSheet();
  }

  function formatRelativeTime(ms) {
    if (!ms) return '';
    const diff = Date.now() - Number(ms);
    if (diff < 0) return '刚刚';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + '秒前';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + '分钟前';
    const hr = Math.floor(min / 60);
    if (hr < 48) return hr + '小时前';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + '天前';
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return '';
    }
  }

  function currentSessionModel() {
    const s = currentSession();
    if (s && s.sessionModel) return s.sessionModel;
    return null;
  }

  function effectiveModelId() {
    return currentSessionModel() || (modelCatalog && modelCatalog.settingsModel) || 'default';
  }

  function modelLabelForId(id) {
    if (!id || id === 'default') return 'Default';
    const m = (modelCatalog && modelCatalog.models) || [];
    const hit = m.find((x) => x.id === id || x.resolved === id);
    return (hit && (hit.label || hit.id)) || id;
  }

  function updateModelChip() {
    if (!modelChipLabel) return;
    const sessionM = currentSessionModel();
    const id = sessionM || (modelCatalog && modelCatalog.settingsModel) || 'default';
    modelChipLabel.textContent = modelLabelForId(id === 'default' ? 'default' : id);
    const dot = btnModel && btnModel.querySelector('.model-chip-dot');
    if (dot) {
      dot.classList.toggle('session', !!sessionM);
      dot.title = sessionM ? '本会话覆盖' : '全局默认';
    }
    if (modelSheetSub) {
      const def = modelCatalog && modelCatalog.settingsModel;
      modelSheetSub.textContent = sessionM
        ? `本会话: ${modelLabelForId(sessionM)} · 默认: ${modelLabelForId(def || 'default')}`
        : `全局默认: ${modelLabelForId(def || 'default')}`;
    }
  }

  async function loadModels() {
    try {
      modelCatalog = await api('/api/models', { timeoutMs: 15000 });
      updateModelChip();
      renderModelList();
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || '加载模型失败';
    }
  }

  function openModelSheet() {
    hidePanels();
    if (modelSheet) {
      modelSheet.hidden = false;
      modelSheet.classList.remove('hidden');
    }
    if (modelSheetMask) {
      modelSheetMask.hidden = false;
      modelSheetMask.classList.remove('hidden');
    }
    if (btnModel) btnModel.setAttribute('aria-expanded', 'true');
    loadModels();
    setTimeout(() => modelSearch && modelSearch.focus(), 50);
  }

  function closeModelSheet() {
    if (modelSheet) {
      modelSheet.classList.add('hidden');
      modelSheet.hidden = true;
    }
    if (modelSheetMask) {
      modelSheetMask.classList.add('hidden');
      modelSheetMask.hidden = true;
    }
    if (btnModel) btnModel.setAttribute('aria-expanded', 'false');
  }

  let resumeLoadSeq = 0;

  function openResumeSheet() {
    // 不调用 hidePanels，避免 closeResumeSheet 自关；只关其它面板
    modePanel.classList.add('hidden');
    cmdPanel.classList.add('hidden');
    if (settingsPanel) settingsPanel.classList.add('hidden');
    closeModelSheet();
    openSidebar(false);
    if (resumeSheet) {
      resumeSheet.hidden = false;
      resumeSheet.classList.remove('hidden');
    }
    if (resumeSheetMask) {
      resumeSheetMask.hidden = false;
      resumeSheetMask.classList.remove('hidden');
    }
    if (resumeSheetMsg) resumeSheetMsg.textContent = '扫描本机会话中…';
    if (resumeList) resumeList.innerHTML = `<div class="model-empty">加载中…</div>`;
    loadResumeCatalog();
    setTimeout(() => resumeSearch && resumeSearch.focus(), 50);
  }

  function closeResumeSheet() {
    if (resumeSheet) {
      resumeSheet.classList.add('hidden');
      resumeSheet.hidden = true;
    }
    if (resumeSheetMask) {
      resumeSheetMask.classList.add('hidden');
      resumeSheetMask.hidden = true;
    }
  }

  async function loadResumeCatalog() {
    const seq = ++resumeLoadSeq;
    try {
      const data = await api('/api/sessions/import?limit=100', { timeoutMs: 30000 });
      // 丢弃过期响应（快速连点打开/关闭/再开）
      if (seq !== resumeLoadSeq) return;
      resumeCatalog = Array.isArray(data.sessions) ? data.sessions : [];
      if (resumeSheetSub) {
        const n = data.count != null ? data.count : resumeCatalog.length;
        // 不把完整 home 路径铺到副标题（隐私 + 过长）；只显示条数
        resumeSheetSub.textContent = `共 ${n} 条本机 CLI 会话 · 点选后 --resume`;
      }
      if (resumeSheetMsg) {
        resumeSheetMsg.textContent = resumeCatalog.length
          ? '点选导入；已在网页的会直接跳转'
          : '没有找到可导入的 CLI 会话';
      }
      renderResumeList();
    } catch (e) {
      if (seq !== resumeLoadSeq) return;
      if (resumeSheetMsg) resumeSheetMsg.textContent = e.message || '扫描失败';
      resumeCatalog = [];
      renderResumeList();
    }
  }

  function renderResumeList() {
    if (!resumeList) return;
    if (!resumeCatalog) {
      resumeList.innerHTML = `<div class="model-empty">加载中…</div>`;
      return;
    }
    const q = (resumeFilter || '').trim().toLowerCase();
    const items = resumeCatalog.filter((s) => {
      if (!s || !s.claudeSessionId) return false;
      if (!q) return true;
      const blob = `${s.title || ''} ${s.preview || ''} ${s.workDir || ''} ${s.claudeSessionId || ''}`.toLowerCase();
      return blob.includes(q);
    });
    if (!items.length) {
      resumeList.innerHTML = `<div class="model-empty">${
        resumeCatalog.length ? '没有匹配的会话' : '没有找到可导入的 CLI 会话'
      }</div>`;
      return;
    }
    resumeList.innerHTML = items
      .map((s) => {
        const badge = s.imported
          ? `<span class="badge in-web">已在网页</span>`
          : `<span class="badge">本机 CLI</span>`;
        const when = formatRelativeTime(s.updatedAt);
        const cwd = s.workDir || '（未知目录）';
        const sid = String(s.claudeSessionId || '');
        const sidShort = sid.slice(0, 8);
        const disabled = importingResume ? ' disabled' : '';
        return `<button type="button" class="model-item resume-item ${s.imported ? 'selected' : ''}" role="option" data-claude-session="${escapeHtml(sid)}" data-web-session="${escapeHtml(s.webSessionId || '')}" data-imported="${s.imported ? '1' : '0'}"${disabled}>
          <div class="ml">${escapeHtml(s.title || sidShort)}${badge}</div>
          <div class="mk">${s.imported ? '→' : '+'}</div>
          <div class="md">${escapeHtml(s.preview || '')}</div>
          <div class="meta-line"><span>${escapeHtml(when)}</span><code title="${escapeHtml(cwd)}">${escapeHtml(cwd)}</code><span>${escapeHtml(sidShort)}</span></div>
        </button>`;
      })
      .join('');
  }

  async function importOrOpenResume(claudeSessionId, webSessionId, already) {
    const sid = String(claudeSessionId || '').trim();
    if (!sid || importingResume) return;
    importingResume = true;
    renderResumeList(); // 禁用列表项，防连点
    if (resumeSheetMsg) resumeSheetMsg.textContent = already ? '打开已有对话…' : '导入中…';
    try {
      if (already && webSessionId) {
        closeResumeSheet();
        await selectSession(webSessionId);
        setStatus('已切换到绑定该 CLI 会话的网页对话', false);
        return;
      }
      const data = await api('/api/sessions/import', {
        method: 'POST',
        body: JSON.stringify({ claudeSessionId: sid }),
        timeoutMs: 20000,
      });
      await loadSessions();
      closeResumeSheet();
      if (data.session && data.session.id) {
        await selectSession(data.session.id);
        let tip;
        if (data.backfilled && data.historyCount > 0) {
          tip =
            `已补载 ${data.historyCount} 条历史` +
            (data.historyTruncated ? '（已截断）' : '') +
            ' · 下一条 --resume 继续';
        } else if (data.already && !(data.historyCount > 0)) {
          tip = '该会话已存在，已打开';
        } else if (data.already) {
          tip = `已打开（含 ${data.historyCount} 条历史）`;
        } else if (data.historyCount > 0) {
          tip =
            `已导入 ${data.historyCount} 条历史` +
            (data.historyTruncated ? '（已截断）' : '') +
            ' · 下一条 --resume 继续';
        } else if (data.fileFound !== false) {
          tip = '已导入（transcript 无可展示文本）· 下一条 --resume 继续';
        } else {
          tip = '已导入 · 下一条消息将 --resume 继续';
        }
        if (data.fileFound === false) {
          tip += '（未在本机找到 jsonl，resume 可能失败）';
        }
        setStatus(tip, false);
      } else {
        setStatus('导入响应异常', false);
      }
    } catch (e) {
      if (resumeSheetMsg) {
        resumeSheetMsg.textContent =
          e.status === 409
            ? e.message || '正在导入，请稍候'
            : e.message || '导入失败';
      }
      setStatus(e.message || '导入失败', false);
    } finally {
      importingResume = false;
      // sheet 可能已关；若仍开着则恢复可点
      if (resumeSheet && !resumeSheet.hidden) renderResumeList();
    }
  }

  function renderModelList() {
    if (!modelList || !modelCatalog) return;
    const q = (modelFilter || '').trim().toLowerCase();
    const models = (modelCatalog.models || []).filter((m) => {
      if (!q) return true;
      const blob = `${m.label || ''} ${m.id || ''} ${m.resolved || ''} ${m.description || ''}`.toLowerCase();
      return blob.includes(q);
    });

    const selected = effectiveModelId();
    const groups = modelCatalog.groups || [
      { id: 'alias', label: 'Claude 别名' },
      { id: 'mapped', label: '已映射 / 环境' },
      { id: 'custom', label: '自定义' },
    ];

    if (!models.length) {
      modelList.innerHTML = `<div class="model-empty">没有匹配的模型<br/>可在下方添加自定义 ID</div>`;
      return;
    }

    let html = '';
    for (const g of groups) {
      const items = models.filter((m) => m.group === g.id);
      if (!items.length) continue;
      html += `<div class="model-group-label">${escapeHtml(g.label)}</div>`;
      for (const m of items) {
        const isSel =
          selected === m.id ||
          selected === m.resolved ||
          (selected === 'default' && m.id === 'default') ||
          (!!m.isCurrentDefault && !currentSessionModel() && modelScope === 'default');
        const showDel = m.group === 'custom';
        html += `<button type="button" class="model-item ${isSel ? 'selected' : ''}" role="option" aria-selected="${isSel}" data-model-id="${escapeHtml(m.id)}">
          <div class="ml">${escapeHtml(m.label || m.id)}</div>
          ${isSel && !showDel ? '<div class="mk">✓</div>' : ''}
          ${showDel ? `<span class="mdel" data-del-model="${escapeHtml(m.id)}" title="删除自定义">删</span>` : ''}
          <div class="md">${escapeHtml(m.description || '')}</div>
          <div class="mr">${escapeHtml(m.displayResolved || m.resolved || m.id)}</div>
        </button>`;
      }
    }
    modelList.innerHTML = html;
  }

  async function selectModel(modelId) {
    if (selectingModel || !modelId) return;
    if (running && modelScope === 'session') {
      if (modelSheetMsg) {
        modelSheetMsg.textContent = '生成中，请结束后再切换本会话模型';
      }
      return;
    }
    selectingModel = true;
    if (btnModel) btnModel.disabled = true;
    if (modelSheetMsg) modelSheetMsg.textContent = '切换中…';
    const prevSessions = sessions;
    try {
      const body = {
        model: modelId,
        scope: modelScope,
      };
      if (modelScope === 'session') {
        if (!currentId) await newChat();
        body.sessionId = currentId;
      }
      const res = await api('/api/models/select', {
        method: 'POST',
        body: JSON.stringify(body),
        timeoutMs: 20000,
      });
      if (res.catalog) modelCatalog = res.catalog;
      else await loadModels();

      if (modelScope === 'session' && currentId) {
        sessions = sessions.map((s) =>
          s.id === currentId
            ? {
                ...s,
                sessionModel: modelId === 'default' ? null : modelId,
              }
            : s
        );
      }
      updateModelChip();
      renderModelList();
      const scopeText = modelScope === 'session' ? '本会话' : '全局默认';
      setStatus(
        `模型已切换为 ${modelLabelForId(modelId)}（${scopeText}）· 下一条消息生效`,
        false
      );
      if (modelSheetMsg) {
        modelSheetMsg.textContent =
          modelScope === 'default'
            ? '已写入 settings.model，新对话默认使用'
            : '仅本会话有效，不影响全局默认';
      }
      setTimeout(() => closeModelSheet(), 280);
    } catch (e) {
      sessions = prevSessions;
      updateModelChip();
      if (modelSheetMsg) {
        modelSheetMsg.textContent =
          e.status === 409
            ? e.message || '忙碌中，稍后再试'
            : e.message || '切换失败';
      }
    } finally {
      selectingModel = false;
      if (btnModel) btnModel.disabled = false;
    }
  }

  async function addCustomModelUI() {
    if (selectingModel) return;
    const id = (modelCustomId && modelCustomId.value.trim()) || '';
    const label = (modelCustomLabel && modelCustomLabel.value.trim()) || '';
    if (!id) {
      if (modelSheetMsg) modelSheetMsg.textContent = '请填写模型 ID';
      return;
    }
    if (id.length > 200) {
      if (modelSheetMsg) modelSheetMsg.textContent = '模型 ID 过长（最多 200）';
      return;
    }
    if (btnModelAdd) btnModelAdd.disabled = true;
    try {
      const res = await api('/api/models/custom', {
        method: 'POST',
        body: JSON.stringify({ id, model: id, label: label || id }),
        timeoutMs: 15000,
      });
      modelCatalog = res.catalog || modelCatalog;
      if (modelCustomId) modelCustomId.value = '';
      if (modelCustomLabel) modelCustomLabel.value = '';
      renderModelList();
      if (modelSheetMsg) modelSheetMsg.textContent = '已添加，点选即可使用';
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || '添加失败';
    } finally {
      if (btnModelAdd) btnModelAdd.disabled = false;
    }
  }

  async function deleteCustomModelUI(id) {
    if (!id || !confirm(`删除自定义模型 ${id}？`)) return;
    try {
      const res = await api(`/api/models/custom/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      modelCatalog = res.catalog || modelCatalog;
      renderModelList();
    } catch (e) {
      if (modelSheetMsg) modelSheetMsg.textContent = e.message || '删除失败';
    }
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

  /** Markdown → safe HTML (assistant). Falls back to escaped plain text. */
  let mdReady = false;
  function renderFence(code, infostring) {
    const lang = String(infostring || '').trim().split(/\s+/)[0] || '';
    const langClass = lang ? ` language-${escapeHtml(lang)}` : '';
    const label = lang || 'code';
    return (
      `<div class="md-code-wrap">` +
      `<div class="md-code-bar"><span class="md-code-lang">${escapeHtml(label)}</span>` +
      `<button type="button" class="md-copy" data-md-copy>复制</button></div>` +
      `<pre class="md-pre"><code class="md-code${langClass}">${escapeHtml(code)}</code></pre>` +
      `</div>`
    );
  }

  function initMarkdown() {
    if (mdReady) return true;
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      return false;
    }
    try {
      marked.setOptions({
        gfm: true,
        breaks: true,
        pedantic: false,
        silent: true,
      });
      // marked v5–15: Renderer prototype hooks (most compatible across builds)
      if (marked.Renderer) {
        const renderer = new marked.Renderer();
        const origCode = renderer.code ? renderer.code.bind(renderer) : null;
        renderer.code = function (code, infostring, escaped) {
          // marked v11+ may pass token object as first arg
          if (code && typeof code === 'object') {
            const tok = code;
            return renderFence(tok.text || '', tok.lang || infostring || '');
          }
          return renderFence(code, infostring);
        };
        renderer.link = function (href, title, text) {
          if (href && typeof href === 'object') {
            // token form
            const tok = href;
            href = tok.href;
            title = tok.title;
            text = tok.text;
          }
          const h = String(href || '');
          if (/^\s*javascript:/i.test(h) || /^\s*vbscript:/i.test(h) || /^\s*data:text\/html/i.test(h)) {
            return escapeHtml(String(text || h));
          }
          const t = title ? ` title="${escapeHtml(title)}"` : '';
          // text may already be html from marked — purify later
          return `<a href="${escapeHtml(h)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
        };
        marked.setOptions({ renderer });
      }
      mdReady = true;
      return true;
    } catch (e) {
      console.warn('markdown init failed', e);
      return false;
    }
  }

  const PURIFY_OPTS = {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      'a',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'del',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'span',
      'div',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'img',
      'button',
    ],
    ALLOWED_ATTR: [
      'href',
      'title',
      'target',
      'rel',
      'class',
      'src',
      'alt',
      'type',
      'data-md-copy',
    ],
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['style', 'onerror', 'onclick', 'onload'],
  };

  function formatMarkdown(src) {
    const text = src == null ? '' : String(src);
    if (!text) return '';
    if (!initMarkdown()) {
      return `<pre class="md-fallback">${escapeHtml(text)}</pre>`;
    }
    try {
      // marked v11+: marked.parse; older: marked()
      const parse = typeof marked.parse === 'function' ? marked.parse.bind(marked) : marked;
      let html = parse(text);
      // If custom renderer didn't run (CDN build quirks), enhance <pre><code>
      if (html && html.indexOf('md-code-wrap') === -1 && html.indexOf('<pre>') !== -1) {
        html = html.replace(
          /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g,
          (_, lang, code) => {
            const label = lang || 'code';
            return (
              `<div class="md-code-wrap"><div class="md-code-bar">` +
              `<span class="md-code-lang">${escapeHtml(label)}</span>` +
              `<button type="button" class="md-copy" data-md-copy>复制</button></div>` +
              `<pre class="md-pre"><code class="md-code${lang ? ` language-${escapeHtml(lang)}` : ''}">${code}</code></pre></div>`
            );
          }
        );
      }
      return DOMPurify.sanitize(html, PURIFY_OPTS);
    } catch (e) {
      return `<pre class="md-fallback">${escapeHtml(text)}</pre>`;
    }
  }

  function enhanceCodeBlocks(root) {
    if (!root) return;
    root.querySelectorAll('[data-md-copy]').forEach((btn) => {
      if (btn.__mdBound) return;
      btn.__mdBound = true;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wrap = btn.closest('.md-code-wrap');
        const codeEl = wrap && wrap.querySelector('code');
        const raw = codeEl ? codeEl.textContent || '' : '';
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(raw);
          } else {
            const ta = document.createElement('textarea');
            ta.value = raw;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          const prev = btn.textContent;
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = prev || '复制';
            btn.classList.remove('copied');
          }, 1200);
        } catch (_) {
          btn.textContent = '失败';
          setTimeout(() => {
            btn.textContent = '复制';
          }, 1200);
        }
      });
    });
  }

  let streamMdTimer = null;
  function scheduleStreamMarkdown(el, text) {
    if (!el) return;
    if (streamMdTimer) cancelAnimationFrame(streamMdTimer);
    streamMdTimer = requestAnimationFrame(() => {
      streamMdTimer = null;
      el.innerHTML = formatMarkdown(text || '');
      enhanceCodeBlocks(el);
    });
  }

  function renderEmpty() {
    messagesEl.innerHTML = `
      <div class="empty">
        <h2>Claude Phone</h2>
        <div>手机聊天驱动本机 Claude Code<br/>历史可上下滑 · 支持中转 · Markdown</div>
        <div style="margin-top:14px;font-size:13px;line-height:1.6">
          右上角 <b>/</b> 命令 · <b>⚙</b> 中转/API · 模型芯片<br/>
          <code>/rewind</code> 回退 · 权限芯片 ≈ Shift+Tab<br/>
          <b>后台任务</b>：勾选=关网页继续；不勾选=断开约4秒后停止
        </div>
      </div>`;
  }

  function bubbleHtml(m, { typing } = {}) {
    const role = m.role;
    if (role === 'system') {
      return `<div class="msg system" data-id="${escapeHtml(m.id || '')}">
        <div class="bubble bubble-plain">${escapeHtml(m.content || '')}</div>
      </div>`;
    }
    const canRewind = role === 'user' && m.id && !String(m.id).startsWith('tmp-');
    const actions = canRewind
      ? `<div class="actions"><button type="button" data-rewind-to="${escapeHtml(m.id)}">回退到此之前</button></div>`
      : role === 'assistant' && m.id && !String(m.id).startsWith('tmp-')
        ? `<div class="actions"><button type="button" data-rewind-last="1">回退本轮 /rewind</button></div>`
        : '';
    // User: keep mostly plain (escape) but allow light markdown if they paste md
    // Assistant: full markdown
    const body =
      role === 'assistant'
        ? formatMarkdown(m.content || (typing ? '…' : ''))
        : formatMarkdown(m.content || '');
    return `
      <div class="msg ${role}" data-id="${escapeHtml(m.id || '')}" data-role="${role}">
        <div class="bubble md-body ${typing ? 'typing' : ''}">${body}</div>
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
    enhanceCodeBlocks(messagesEl);
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
    // 预加载模型目录（失败不阻塞）
    loadModels().catch(() => {});
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

    // 同步会话级模型覆盖
    if (data.session) {
      sessions = sessions.map((s) =>
        s.id === id ? { ...s, ...data.session } : s
      );
      if (!sessions.find((s) => s.id === id)) sessions.unshift(data.session);
    }

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
    updateModelChip();
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
      try {
        es.onmessage = null;
        es.onerror = null;
        es.close();
      } catch (_) {
        /* ignore */
      }
      es = null;
    }
    const url = `/api/sessions/${encodeURIComponent(sessionId)}/events`;
    es = new EventSource(url);
    const boundId = sessionId;
    es.onmessage = (ev) => {
      // 切换会话后忽略旧连接残留（close 异步）
      if (currentId !== boundId) return;
      let data;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      handleEvent(data);
    };
    es.onerror = () => {
      if (currentId !== boundId) return;
      setStatus('连接中断，重连中…', false);
    };
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
            scheduleStreamMarkdown(last, streamingText);
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
          sessions = sessions.map((s) =>
            s.id === ev.session.id ? { ...s, ...ev.session } : s
          );
          if (currentId === ev.session.id) {
            chatTitle.textContent = ev.session.title || '对话';
            renderModes();
            updateModelChip();
          }
          renderSessions();
        }
        break;
      case 'open_model_picker':
        openModelSheet();
        break;
      case 'open_resume_picker':
        openResumeSheet();
        break;
      case 'session_imported':
        // /resume <id> 从服务端导入后：刷新列表并切到新会话
        if (ev.session && ev.session.id) {
          loadSessions()
            .then(() => selectSession(ev.session.id))
            .catch((err) => {
              setStatus((err && err.message) || '切换导入会话失败', false);
            });
        }
        break;
      default:
        break;
    }
  }

  async function sendMessage(textOverride) {
    const text = (textOverride != null ? textOverride : inputEl.value).trim();
    if (!text || running) return;
    // 纯 /model 打开选择器，不发往服务端冒泡
    if (text === '/model' || text === '/models') {
      if (textOverride == null) {
        inputEl.value = '';
        autoGrow();
      }
      openModelSheet();
      return;
    }
    // 纯 /resume|/import 打开本机会话导入（带参数的仍走服务端）
    if (
      text === '/resume' ||
      text === '/import' ||
      text === '/resume ' ||
      text === '/import '
    ) {
      if (textOverride == null) {
        inputEl.value = '';
        autoGrow();
      }
      openResumeSheet();
      return;
    }
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
  if (btnImportSession) {
    btnImportSession.addEventListener('click', () => {
      openSidebar(false);
      openResumeSheet();
    });
  }
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

  // Model sheet
  if (btnModel) {
    btnModel.addEventListener('click', () => {
      const open = modelSheet && !modelSheet.classList.contains('hidden') && !modelSheet.hidden;
      if (open) closeModelSheet();
      else openModelSheet();
    });
  }
  if (btnModelClose) btnModelClose.addEventListener('click', () => closeModelSheet());
  if (modelSheetMask) modelSheetMask.addEventListener('click', () => closeModelSheet());
  if (modelSearch) {
    modelSearch.addEventListener('input', () => {
      modelFilter = modelSearch.value || '';
      renderModelList();
    });
  }
  document.querySelectorAll('.scope-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      modelScope = tab.getAttribute('data-scope') || 'session';
      document.querySelectorAll('.scope-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      renderModelList();
    });
  });
  if (modelList) {
    modelList.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-model]');
      if (del) {
        e.preventDefault();
        e.stopPropagation();
        deleteCustomModelUI(del.getAttribute('data-del-model'));
        return;
      }
      const item = e.target.closest('[data-model-id]');
      if (item) selectModel(item.getAttribute('data-model-id'));
    });
  }
  if (btnModelAdd) btnModelAdd.addEventListener('click', () => addCustomModelUI());

  // Resume sheet
  if (btnResumeClose) btnResumeClose.addEventListener('click', () => closeResumeSheet());
  if (resumeSheetMask) resumeSheetMask.addEventListener('click', () => closeResumeSheet());
  if (resumeSearch) {
    resumeSearch.addEventListener('input', () => {
      resumeFilter = resumeSearch.value || '';
      renderResumeList();
    });
  }
  if (resumeList) {
    resumeList.addEventListener('click', (e) => {
      const item = e.target.closest('[data-claude-session]');
      if (!item) return;
      importOrOpenResume(
        item.getAttribute('data-claude-session'),
        item.getAttribute('data-web-session') || '',
        item.getAttribute('data-imported') === '1'
      );
    });
  }

  // /model · /resume sheets
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModelSheet();
      closeResumeSheet();
    }
  });

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
    if (cmd === '/model') {
      openModelSheet();
      return;
    }
    if (cmd === '/resume' || cmd === '/import') {
      openResumeSheet();
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
