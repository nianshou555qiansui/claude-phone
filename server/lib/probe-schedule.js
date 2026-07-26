'use strict';

const fs = require('fs');
const path = require('path');

/**
 * CLI 契约探针巡检的纯逻辑（判定/落盘），便于单测。
 * 真正 spawn 探针进程的 runner 在 server.js 注入。
 *
 * 巡检节奏：调度器每 30 分钟"检查"一次，检查时只有满足
 * 「距上次运行 ≥ 间隔 且 当前没有活跃回合」才真的跑——
 * 2c2g 上避免探针 CLI 与用户回合叠加吃内存；忙时自然顺延到下轮检查。
 */

const BUSY_POSTPONE = 'busy';

function loadStatus(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

function saveStatus(file, status) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 原子写：先落临时文件再 rename，防崩溃截断 JSON
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(status, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * @param {object|null} status  上次结果 { ok, at, ... }
 * @param {number} now
 * @param {number} intervalMs  0/负数 = 巡检关闭
 * @param {boolean} busy       是否有活跃回合
 * @returns {{run: boolean, reason?: string}}
 */
function shouldRun(status, now, intervalMs, busy) {
  if (!intervalMs || intervalMs <= 0) return { run: false, reason: 'disabled' };
  const last = (status && Number(status.at)) || 0;
  if (now - last < intervalMs) return { run: false, reason: 'fresh' };
  if (busy) return { run: false, reason: BUSY_POSTPONE };
  return { run: true };
}

/** meta/hello 里暴露给前端的裁剪视图（不带多余字段） */
function publicView(status) {
  if (!status || typeof status !== 'object') return null;
  return {
    ok: !!status.ok,
    at: Number(status.at) || 0,
    model: status.model || null,
    error: status.ok ? null : String(status.error || '').slice(0, 240),
  };
}

module.exports = { loadStatus, saveStatus, shouldRun, publicView, BUSY_POSTPONE };
