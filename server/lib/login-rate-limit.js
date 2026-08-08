'use strict';

/**
 * 按 IP 的登录失败限流 + 老化回收。纯逻辑、无 HTTP/磁盘依赖，便于单测。
 *
 * 每条 entry（按 IP）：
 *  - n            : 当前窗口内失败次数；达 max → 封 blockMs
 *  - resetAt      : 计数窗口起点（窗口过期后重建计数）
 *  - blockedUntil : 封锁截止时间；封锁期间一律拒绝
 *  - lastAttemptAt: 最近一次失败时间，老化回收的基准
 *
 * 老化回收：闲置超 idleMs 且**未在封锁中**的条目才删。封锁中的条目即便闲置也
 * 保留——否则攻击者撑满阈值后只需等待老化即可绕过封锁。
 */
class LoginRateLimiter {
  constructor(opts = {}) {
    this.windowMs = Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 15 * 60 * 1000;
    this.max = Math.max(1, Number(opts.max) || 8);
    this.blockMs = Number(opts.blockMs) > 0 ? Number(opts.blockMs) : 5 * 60 * 1000;
    this.idleMs = Number(opts.idleMs) > 0 ? Number(opts.idleMs) : 10 * 60 * 1000;
    this.pruneThreshold = Math.max(1, Number(opts.pruneThreshold) || 64);
    this.fails = new Map();
  }

  /** 当前是否处于封锁期。返回 { blocked, retryAfterSec }。 */
  status(ip, now = Date.now()) {
    const f = this.fails.get(ip);
    if (!f) return { blocked: false, retryAfterSec: 0 };
    if (f.blockedUntil && now < f.blockedUntil) {
      return { blocked: true, retryAfterSec: Math.ceil((f.blockedUntil - now) / 1000) };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  /**
   * 记一次失败。返回 { blocked, retryAfterSec }（含本次失败可能触发的封锁）。
   * @param {string} ip
   * @param {number} [now]
   */
  recordFail(ip, now = Date.now()) {
    let f = this.fails.get(ip);
    if (!f || now > (f.resetAt || 0)) {
      f = { n: 0, resetAt: now + this.windowMs, blockedUntil: 0, lastAttemptAt: now };
    }
    f.n += 1;
    f.lastAttemptAt = now;
    if (f.n >= this.max) {
      f.blockedUntil = now + this.blockMs;
      f.n = 0;
      f.resetAt = now + this.windowMs;
    }
    this.fails.set(ip, f);
    this.prune(now);
    if (f.blockedUntil && now < f.blockedUntil) {
      return { blocked: true, retryAfterSec: Math.ceil((f.blockedUntil - now) / 1000) };
    }
    return { blocked: false, retryAfterSec: 0 };
  }

  /** 登录成功：清该 IP 的失败计数。 */
  reset(ip) {
    this.fails.delete(ip);
  }

  /**
   * 老化回收。只删「既不在封锁、又闲置超时」的条目。返回删除条数。
   * 仅当 map 规模超过 pruneThreshold 时才扫，避免每次失败都遍历。
   */
  prune(now = Date.now()) {
    if (this.fails.size < this.pruneThreshold) return 0;
    let removed = 0;
    for (const [ip, f] of this.fails) {
      if (!f) {
        this.fails.delete(ip);
        removed += 1;
        continue;
      }
      const blocked = f.blockedUntil && now < f.blockedUntil;
      if (blocked) continue; // 封锁未到：保留，防绕过
      const idleSince = f.lastAttemptAt || f.resetAt || now;
      if (now - idleSince > this.idleMs) {
        this.fails.delete(ip);
        removed += 1;
      }
    }
    return removed;
  }

  /** 调试/观测用。 */
  size() {
    return this.fails.size;
  }
}

module.exports = { LoginRateLimiter };
