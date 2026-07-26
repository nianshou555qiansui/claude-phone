'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { settingsPath, readJsonSafe } = require('./settings-editor');

function userHome() {
  return process.env.HOME || os.homedir() || process.cwd();
}

function loadSettingsData() {
  const file = settingsPath();
  try {
    return readJsonSafe(file) || {};
  } catch {
    return {};
  }
}

const BUILTIN_ALIASES = [
  {
    id: 'default',
    alias: 'default',
    label: 'Default（推荐）',
    labelEn: 'Default (recommended)',
    description: '使用 Claude Code 当前默认模型（settings.model / 环境）',
    descriptionEn:
      'Use Claude Code default model (settings.model / environment)',
    group: 'alias',
    sort: 0,
  },
  {
    id: 'opus',
    alias: 'opus',
    label: 'Opus',
    labelEn: 'Opus',
    description: '高能力别名 · 映射到 DEFAULT_OPUS 或官方 Opus',
    descriptionEn: 'Highest capability alias · maps to DEFAULT_OPUS or Opus',
    group: 'alias',
    sort: 1,
  },
  {
    id: 'sonnet',
    alias: 'sonnet',
    label: 'Sonnet',
    labelEn: 'Sonnet',
    description: '均衡别名 · 映射到 DEFAULT_SONNET 或官方 Sonnet',
    descriptionEn: 'Balanced alias · maps to DEFAULT_SONNET or Sonnet',
    group: 'alias',
    sort: 2,
  },
  {
    id: 'haiku',
    alias: 'haiku',
    label: 'Haiku',
    labelEn: 'Haiku',
    description: '更快更便宜 · 映射到 DEFAULT_HAIKU 或官方 Haiku',
    descriptionEn: 'Faster / cheaper · maps to DEFAULT_HAIKU or Haiku',
    group: 'alias',
    sort: 3,
  },
  {
    id: 'fable',
    alias: 'fable',
    label: 'Fable',
    labelEn: 'Fable',
    description: 'Fable 别名 · 映射到 DEFAULT_FABLE',
    descriptionEn: 'Fable alias · maps to DEFAULT_FABLE',
    group: 'alias',
    sort: 4,
  },
];

const ENV_MAP_KEYS = [
  {
    envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    nameKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
    alias: 'opus',
    labelPrefix: 'Opus →',
  },
  {
    envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    nameKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
    alias: 'sonnet',
    labelPrefix: 'Sonnet →',
  },
  {
    envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    nameKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    alias: 'haiku',
    labelPrefix: 'Haiku →',
  },
  {
    envKey: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    nameKey: 'ANTHROPIC_DEFAULT_FABLE_MODEL_NAME',
    alias: 'fable',
    labelPrefix: 'Fable →',
  },
  {
    envKey: 'ANTHROPIC_MODEL',
    nameKey: null,
    alias: null,
    labelPrefix: 'ANTHROPIC_MODEL',
  },
  {
    envKey: 'CLAUDE_CODE_SUBAGENT_MODEL',
    nameKey: null,
    alias: null,
    labelPrefix: 'Subagent',
  },
];

function customModelsPath() {
  return path.join(userHome(), '.claude', 'claude-phone-models.json');
}

/**
 * @param {'zh'|'en'} [lang]
 */
function loadCustomModels(lang) {
  const p = customModelsPath();
  const fallbackDesc = lang === 'en' ? 'Custom model' : '自定义模型';
  try {
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.models || [];
    return list
      .filter((m) => m && (m.id || m.model || m.value))
      .map((m, i) => {
        const id = String(m.id || m.model || m.value);
        const userDesc = m.description || m.desc || '';
        // Only replace the stock Chinese placeholder when serving English
        let description = userDesc;
        if (!description) description = fallbackDesc;
        else if (lang === 'en' && description === '自定义模型') {
          description = 'Custom model';
        }
        return {
          id,
          alias: m.alias || null,
          label: m.label || m.name || id,
          description,
          resolved: String(m.model || m.value || m.id),
          group: 'custom',
          sort: 100 + i,
        };
      });
  } catch {
    return [];
  }
}

function saveCustomModels(models) {
  const p = customModelsPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  const list = (models || []).map((m) => ({
    id: m.id,
    label: m.label,
    description: m.description || '',
    model: m.resolved || m.model || m.id,
  }));
  const tmp = p + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ models: list }, null, 2) + '\n', {
    mode: 0o600,
  });
  fs.renameSync(tmp, p);
  try {
    fs.chmodSync(p, 0o600);
  } catch {
    /* ignore */
  }
  return loadCustomModels();
}

/**
 * Build catalog from settings env + builtins + custom file.
 * @param {'zh'|'en'} [lang] UI language for labels/descriptions (default zh)
 */
function buildModelCatalog(lang) {
  const uiLang = lang === 'en' ? 'en' : 'zh';
  const data = loadSettingsData();
  const env = (data.env && typeof data.env === 'object' ? data.env : {}) || {};
  const settingsModel = data.model ? String(data.model) : '';

  const items = [];
  const seen = new Set();

  function add(item) {
    const id = String(item.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push(item);
  }

  // Built-in aliases with resolved mapping
  for (const b of BUILTIN_ALIASES) {
    let resolved = b.alias;
    if (b.alias === 'default') {
      resolved = settingsModel || env.ANTHROPIC_MODEL || 'default';
    } else if (b.alias === 'opus') {
      resolved = env.ANTHROPIC_DEFAULT_OPUS_MODEL || 'opus';
    } else if (b.alias === 'sonnet') {
      resolved = env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'sonnet';
    } else if (b.alias === 'haiku') {
      resolved = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'haiku';
    } else if (b.alias === 'fable') {
      resolved = env.ANTHROPIC_DEFAULT_FABLE_MODEL || 'fable';
    }
    const nameHint =
      b.alias === 'opus'
        ? env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME
        : b.alias === 'sonnet'
          ? env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME
          : b.alias === 'haiku'
            ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME
            : b.alias === 'fable'
              ? env.ANTHROPIC_DEFAULT_FABLE_MODEL_NAME
              : null;

    add({
      id: b.id,
      alias: b.alias,
      group: b.group,
      sort: b.sort,
      label: uiLang === 'en' ? b.labelEn || b.label : b.label,
      description:
        uiLang === 'en' ? b.descriptionEn || b.description : b.description,
      resolved: String(resolved),
      displayResolved: nameHint
        ? `${resolved} · ${nameHint}`
        : String(resolved),
      isCurrentDefault:
        settingsModel === b.alias ||
        settingsModel === resolved ||
        (b.alias === 'default' && !settingsModel),
    });
  }

  // Env-mapped concrete models as selectable entries (id = full model string)
  for (const row of ENV_MAP_KEYS) {
    const val = env[row.envKey];
    if (!val) continue;
    const resolved = String(val);
    const name = row.nameKey && env[row.nameKey] ? String(env[row.nameKey]) : '';
    // Skip if already added as exact id
    if (seen.has(resolved)) {
      // annotate existing
      const existing = items.find((x) => x.id === resolved || x.resolved === resolved);
      if (existing && name) existing.displayResolved = `${resolved} · ${name}`;
      continue;
    }
    const mappedDesc =
      uiLang === 'en'
        ? `${row.labelPrefix} (from settings.env)`
        : `${row.labelPrefix}（来自 settings.env）`;
    add({
      id: resolved,
      alias: row.alias,
      label: name || resolved,
      description: mappedDesc,
      resolved,
      displayResolved: name ? `${resolved} · ${name}` : resolved,
      group: 'mapped',
      sort: 50,
      isCurrentDefault: settingsModel === resolved,
    });
  }

  // settings.model if custom string not already listed
  if (settingsModel && !seen.has(settingsModel)) {
    add({
      id: settingsModel,
      alias: null,
      label: settingsModel,
      description:
        uiLang === 'en' ? 'Current settings.model' : '当前 settings.model',
      resolved: settingsModel,
      displayResolved: settingsModel,
      group: 'mapped',
      sort: 40,
      isCurrentDefault: true,
    });
  }

  // Custom catalog
  for (const c of loadCustomModels(uiLang)) {
    add({
      ...c,
      isCurrentDefault: settingsModel === c.id || settingsModel === c.resolved,
    });
  }

  items.sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.label.localeCompare(b.label));

  /**
   * @param {'zh'|'en'} [lang]
   */
  const groupsFor = (lang) =>
    lang === 'en'
      ? [
          { id: 'alias', label: 'Claude aliases' },
          { id: 'mapped', label: 'Mapped / env' },
          { id: 'custom', label: 'Custom' },
        ]
      : [
          { id: 'alias', label: 'Claude 别名' },
          { id: 'mapped', label: '已映射 / 环境' },
          { id: 'custom', label: '自定义' },
        ];

  return {
    settingsModel: settingsModel || null,
    settingsPath: settingsPath(),
    customPath: customModelsPath(),
    effort: env.CLAUDE_CODE_EFFORT_LEVEL || null,
    baseUrl: env.ANTHROPIC_BASE_URL || null,
    models: items,
    // Default zh for backward compatibility; API layer may re-label via lang
    groups: groupsFor('zh'),
    groupsZh: groupsFor('zh'),
    groupsEn: groupsFor('en'),
  };
}

/**
 * Resolve what to pass as --model (null = omit flag, use CLI default).
 */
function resolveModelForCli(selection) {
  if (selection == null) return null;
  const s = String(selection).trim();
  if (!s || s === 'default') return null;
  // 若是目录里的别名项，优先把 --model 设为 alias（opus/sonnet/…），
  // 让 Claude Code 自己走 DEFAULT_* 映射；若 id 是具体串则原样传递。
  try {
    const catalog = buildModelCatalog();
    // id 精确匹配优先：多个内置别名可能 resolved 到同一串（中转映射），
    // 若混在一起 find 会错命中先出现的同 resolved 项（例：claude-fable-5
    // 撞上 resolved 相同的 haiku 项 → 误发 --model haiku 走错账号池）。
    const found =
      catalog.models.find((m) => m.id === s) ||
      catalog.models.find((m) => m.resolved === s);
    if (found) {
      if (found.id === 'default') return null;
      if (
        found.alias &&
        ['opus', 'sonnet', 'haiku', 'fable'].includes(found.alias) &&
        found.id === found.alias
      ) {
        return found.alias;
      }
      return String(found.resolved || found.id);
    }
  } catch {
    /* fall through */
  }
  // 防止异常超长污染 argv
  if (s.length > 200) return s.slice(0, 200);
  return s;
}

/**
 * Set permanent default model in settings.json (settings.model).
 * Also optionally sync ANTHROPIC_MODEL env for relays.
 */
/**
 * @param {string} modelId
 * @param {{ syncAnthropicModel?: boolean, lang?: 'zh'|'en' }} [opts]
 */
function setDefaultModel(modelId, { syncAnthropicModel = true, lang } = {}) {
  const catalog = buildModelCatalog(lang);
  const found = catalog.models.find((m) => m.id === modelId || m.resolved === modelId);
  const value =
    modelId === 'default'
      ? ''
      : found
        ? found.alias && ['opus', 'sonnet', 'haiku', 'fable'].includes(found.alias) &&
          found.id === found.alias
          ? found.alias
          : found.resolved || found.id
        : String(modelId);

  const envUpdates = {};
  if (syncAnthropicModel) {
    if (!value) {
      // don't clear ANTHROPIC_MODEL automatically
    } else {
      // For aliases, prefer writing alias to settings.model; keep env maps as-is
      if (!['opus', 'sonnet', 'haiku', 'fable'].includes(value)) {
        envUpdates.ANTHROPIC_MODEL = value;
      }
    }
  }

  // empty model = remove key by writing via raw merge
  const file = settingsPath();
  let data = {};
  if (fs.existsSync(file)) {
    data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(dir, `settings.json.bak.${ts}`));
  }

  if (!value) {
    delete data.model;
  } else {
    data.model = value;
  }
  if (!data.env || typeof data.env !== 'object') data.env = {};
  for (const [k, v] of Object.entries(envUpdates)) {
    data.env[k] = v;
  }

  const tmp = file + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }

  return buildModelCatalog(lang);
}

/**
 * @param {{ id?: string, label?: string, model?: string, description?: string }} opts
 * @param {'zh'|'en'} [lang]
 */
function addCustomModel({ id, label, model, description }, lang) {
  const resolved = String(model || id || '').trim();
  if (!resolved) {
    const err = new Error('model id required');
    err.status = 400;
    throw err;
  }
  if (resolved.length > 200) {
    const err = new Error('model id too long (max 200)');
    err.status = 400;
    throw err;
  }
  // 禁止路径分隔与控制字符，避免奇怪文件/展示问题
  if (/[\x00-\x1f/\\]/.test(resolved)) {
    const err = new Error('model id contains invalid characters');
    err.status = 400;
    throw err;
  }
  const safeLabel = String(label || resolved).trim().slice(0, 80) || resolved;
  // Persist neutral description; UI localizes stock placeholder by language
  const safeDesc = String(description || '').trim().slice(0, 200);
  const customs = loadCustomModels().filter(
    (m) => m.id !== resolved && m.resolved !== resolved
  );
  if (customs.length >= 50) {
    const err = new Error('too many custom models (max 50)');
    err.status = 400;
    throw err;
  }
  customs.push({
    id: resolved,
    label: safeLabel,
    description: safeDesc,
    resolved,
    group: 'custom',
    sort: 100 + customs.length,
  });
  saveCustomModels(customs);
  return buildModelCatalog(lang);
}

/**
 * @param {string} id
 * @param {'zh'|'en'} [lang]
 */
function removeCustomModel(id, lang) {
  const target = String(id || '').trim();
  if (!target) {
    const err = new Error('model id required');
    err.status = 400;
    throw err;
  }
  const before = loadCustomModels();
  const customs = before.filter((m) => m.id !== target && m.resolved !== target);
  if (customs.length === before.length) {
    const err = new Error('custom model not found');
    err.status = 404;
    throw err;
  }
  saveCustomModels(customs);
  return buildModelCatalog(lang);
}

/**
 * 从上游（中转 / 官方）拉取模型列表：GET {base}/v1/models。
 * 先按 Anthropic 风格（x-api-key），失败再按 OpenAI 风格（Bearer）。
 * 只读请求；token 不离开服务端。
 *
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ style:string, url:string, count:number, models:Array<{id:string,displayName:string|null,created:string|null,ownedBy:string|null}> }>}
 */
async function fetchUpstreamModels({ timeoutMs = 10000 } = {}) {
  const data = loadSettingsData();
  const env = (data.env && typeof data.env === 'object' ? data.env : {}) || {};
  const baseRaw = String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').trim();
  const token = String(
    env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''
  ).trim();
  if (!token) {
    const e = new Error('no_token');
    e.code = 'no_token';
    throw e;
  }
  let base = baseRaw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) {
    const e = new Error('bad_base_url');
    e.code = 'bad_base_url';
    throw e;
  }
  // ANTHROPIC_BASE_URL 有的填根，有的已带 /v1
  const url = /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;

  const attempts = [
    {
      style: 'anthropic',
      headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' },
    },
    { style: 'openai', headers: { Authorization: `Bearer ${token}` } },
  ];

  let lastErr = null;
  for (const att of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${url}?limit=1000`, {
        headers: { ...att.headers, Accept: 'application/json' },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        const detail =
          json && json.error
            ? typeof json.error === 'string'
              ? json.error
              : json.error.message || JSON.stringify(json.error).slice(0, 200)
            : text.slice(0, 200);
        lastErr = new Error(`HTTP ${res.status}: ${detail}`);
        lastErr.status = res.status;
        continue;
      }
      const list =
        json && Array.isArray(json.data)
          ? json.data
          : json && Array.isArray(json.models)
            ? json.models
            : null;
      if (!list) {
        lastErr = new Error('unrecognized /v1/models response');
        continue;
      }
      const models = list
        .filter((m) => m && (m.id || m.name))
        .slice(0, 500)
        .map((m) => ({
          id: String(m.id || m.name).slice(0, 200),
          displayName: m.display_name || m.displayName || null,
          created:
            m.created_at ||
            (m.created && Number.isFinite(Number(m.created))
              ? new Date(Number(m.created) * 1000).toISOString()
              : null),
          ownedBy: m.owned_by || null,
        }));
      return { style: att.style, url, count: models.length, models };
    } catch (e) {
      lastErr =
        e && e.name === 'AbortError'
          ? Object.assign(new Error('timeout'), { code: 'timeout' })
          : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('upstream fetch failed');
}

module.exports = {
  buildModelCatalog,
  resolveModelForCli,
  setDefaultModel,
  addCustomModel,
  removeCustomModel,
  loadCustomModels,
  customModelsPath,
  fetchUpstreamModels,
};
