'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRET_KEY_RE =
  /(TOKEN|SECRET|PASSWORD|PASS|KEY|AUTH|CREDENTIAL|PRIVATE)/i;

function userHome() {
  return process.env.HOME || os.homedir() || process.cwd();
}

function settingsPath() {
  return path.join(userHome(), '.claude', 'settings.json');
}

function localSettingsPath() {
  return path.join(userHome(), '.claude', 'settings.local.json');
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function isSecretKey(k) {
  return SECRET_KEY_RE.test(String(k || ''));
}

function maskValue(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.length <= 8) return '********';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

/**
 * 返回给前端的安全视图（secret 已脱敏）
 */
function getSettingsView() {
  const file = settingsPath();
  const localFile = localSettingsPath();
  let data = {};
  let exists = false;
  try {
    if (fs.existsSync(file)) {
      data = readJsonSafe(file) || {};
      exists = true;
    }
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      path: file,
      user: process.env.USER || os.userInfo().username || 'user',
      home: userHome(),
    };
  }

  const env = data.env && typeof data.env === 'object' ? data.env : {};
  const envView = {};
  for (const [k, v] of Object.entries(env)) {
    envView[k] = {
      value: isSecretKey(k) ? maskValue(v) : v == null ? '' : String(v),
      secret: isSecretKey(k),
      set: v != null && String(v).length > 0,
    };
  }

  // 常用中转字段优先排序
  const preferred = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'CLAUDE_CODE_SUBAGENT_MODEL',
    'CLAUDE_CODE_EFFORT_LEVEL',
  ];

  return {
    ok: true,
    path: file,
    localPath: localFile,
    localExists: fs.existsSync(localFile),
    exists,
    user: process.env.USER || require('os').userInfo().username || 'user',
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    home: userHome(),
    model: data.model || '',
    env: envView,
    preferredEnvKeys: preferred,
    // 非 env 的只读摘要，避免误改插件结构
    otherKeys: Object.keys(data).filter((k) => k !== 'env'),
    rawEditable: true,
  };
}

/**
 * 更新 env / model。
 * envUpdates: { KEY: "newvalue" | null }
 *  - null / "" 且 secret：表示不修改
 *  - 特殊 "__CLEAR__"：删除该 key
 * rawJson: 若提供，整文件替换（需合法 JSON 对象）
 */
function updateSettings({ envUpdates, model, rawJson } = {}) {
  const file = settingsPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  let data = {};
  if (fs.existsSync(file)) {
    data = readJsonSafe(file) || {};
  }

  // 备份
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(file)) {
    const bak = path.join(dir, `settings.json.bak.${ts}`);
    fs.copyFileSync(file, bak);
  }

  if (rawJson != null) {
    if (typeof rawJson === 'string') {
      data = JSON.parse(rawJson);
    } else if (typeof rawJson === 'object' && !Array.isArray(rawJson)) {
      data = rawJson;
    } else {
      throw Object.assign(new Error('rawJson must be object'), { status: 400 });
    }
  } else {
    if (!data.env || typeof data.env !== 'object') data.env = {};
    if (envUpdates && typeof envUpdates === 'object') {
      for (const [k, v] of Object.entries(envUpdates)) {
        if (!k || k.includes('\0')) continue;
        if (v === '__CLEAR__') {
          delete data.env[k];
          continue;
        }
        if (v == null) continue;
        const s = String(v);
        // secret 字段若仍是脱敏占位，跳过
        if (isSecretKey(k) && (s === '' || s.includes('…') || s.includes('...'))) {
          continue;
        }
        if (s === '' && isSecretKey(k)) continue;
        data.env[k] = s;
      }
    }
    if (model != null && String(model).trim() !== '') {
      data.model = String(model).trim();
    }
  }

  const tmp = file + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }

  return getSettingsView();
}

module.exports = {
  settingsPath,
  localSettingsPath,
  getSettingsView,
  updateSettings,
  isSecretKey,
  maskValue,
};
