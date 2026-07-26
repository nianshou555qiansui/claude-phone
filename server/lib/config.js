'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function loadEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const fileEnv = loadEnvFile(path.join(ROOT, 'config.env'));

function env(key, fallback) {
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  if (fileEnv[key] != null && fileEnv[key] !== '') return fileEnv[key];
  return fallback;
}

// CLI 支持的 --permission-mode 取值（与 claude --help 对齐）
// 注意：在 -p 非交互模式下，"manual" 实际会落成 default，且无法弹窗确认
const PERMISSION_MODES = [
  'acceptEdits',
  'plan',
  'default',
  'dontAsk',
  'auto',
  'bypassPermissions',
];

// 兼容旧会话里存的 manual
const PERMISSION_MODE_ALIASES = {
  manual: 'default',
};

const config = {
  root: ROOT,
  bind: env('BIND', '127.0.0.1'),
  port: Number(env('PORT', '7681')) || 7681,
  workDir: env('WORK_DIR', process.env.HOME || process.cwd()),
  defaultPermissionMode: env('DEFAULT_PERMISSION_MODE', 'acceptEdits'),
  turnTimeoutMs: Number(env('TURN_TIMEOUT_MS', '600000')) || 600000,
  maxConcurrentTurns: Number(env('MAX_CONCURRENT_TURNS', '1')) || 1,
  // 手机工具审批卡片的等待时限（超时默认拒绝）
  approvalTimeoutMs: Number(env('APPROVAL_TIMEOUT_MS', '120000')) || 120000,
  // 默认是否按后台任务发送（可被单次请求覆盖）
  defaultBackground: String(env('DEFAULT_BACKGROUND', '1')) !== '0',
  publicUrl: env('PUBLIC_URL', ''),
  publicHost: env('PUBLIC_HOST', ''),
  // 手机推送（可选）：空 = 关闭。见 server/lib/notify.js
  notifyUrl: env('NOTIFY_URL', ''),
  notifyKind: env('NOTIFY_KIND', 'ntfy'),
  // 推送正文是否携带内容预览（工具入参/回复片段）。推送服务是第三方，默认不带
  notifyPreview: String(env('NOTIFY_PREVIEW', '0')) === '1',
  // CLI 契约探针巡检间隔（小时）；0 = 关闭
  probeIntervalHours: Number(env('PROBE_INTERVAL_H', '24')) || 0,
  claudeBin: env('CLAUDE_BIN', 'claude'),
  dataDir: path.join(ROOT, 'data'),
  permissionModes: PERMISSION_MODES,
};

if (!PERMISSION_MODES.includes(config.defaultPermissionMode)) {
  // 兼容旧值 manual
  if (config.defaultPermissionMode === 'manual') {
    config.defaultPermissionMode = 'default';
  } else {
    config.defaultPermissionMode = 'acceptEdits';
  }
}

function normalizePermissionMode(mode) {
  if (!mode) return config.defaultPermissionMode;
  const m = PERMISSION_MODE_ALIASES[mode] || mode;
  if (PERMISSION_MODES.includes(m)) return m;
  return config.defaultPermissionMode;
}

module.exports = {
  config,
  PERMISSION_MODES,
  PERMISSION_MODE_ALIASES,
  normalizePermissionMode,
  loadEnvFile,
  ROOT,
};
