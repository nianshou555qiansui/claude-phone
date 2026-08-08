'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { LoginRateLimiter } = require('../server/lib/login-rate-limit');

// 小参数便于断言时序：max=3 失败封，blockMs=60s，windowMs=300s，idleMs=120s
function makeLimiter(overrides = {}) {
  return new LoginRateLimiter({
    windowMs: 300_000,
    max: 3,
    blockMs: 60_000,
    idleMs: 120_000,
    pruneThreshold: 4,
    ...overrides,
  });
}

test('未达阈值：连续失败仅计数，不封锁', () => {
  const lim = makeLimiter();
  let r0 = lim.recordFail('1.2.3.4', 1000);
  assert.strictEqual(r0.blocked, false);
  let r1 = lim.recordFail('1.2.3.4', 2000);
  assert.strictEqual(r1.blocked, false); // max=3，第 2 次不封
});

test('达阈值：第 max 次失败触发封锁，返回 blocked + retryAfter', () => {
  const lim = makeLimiter();
  lim.recordFail('1.2.3.4', 1000);
  lim.recordFail('1.2.3.4', 2000);
  const r = lim.recordFail('1.2.3.4', 3000); // 第 3 次 → 封
  assert.strictEqual(r.blocked, true);
  assert.ok(r.retryAfterSec > 0 && r.retryAfterSec <= 60);
  // status 同样报封锁
  assert.strictEqual(lim.status('1.2.3.4', 3000).blocked, true);
});

test('封锁期入口直接拒绝（无需再 recordFail）', () => {
  const lim = makeLimiter();
  for (let i = 1; i <= 3; i++) lim.recordFail('9.9.9.9', i * 1000);
  const st = lim.status('9.9.9.9', 4000);
  assert.strictEqual(st.blocked, true);
  assert.ok(st.retryAfterSec > 0);
});

test('封锁过期：status 恢复为未封锁', () => {
  const lim = makeLimiter();
  for (let i = 1; i <= 3; i++) lim.recordFail('8.8.8.8', i * 1000); // 封到 3000+60s
  assert.strictEqual(lim.status('8.8.8.8', 4000).blocked, true);
  assert.strictEqual(lim.status('8.8.8.8', 4000 + 61_000).blocked, false);
});

test('窗口过期：计数重建，旧失败不跨窗口累积', () => {
  const lim = makeLimiter();
  lim.recordFail('7.7.7.7', 1000);
  lim.recordFail('7.7.7.7', 2000);
  // 越过窗口（windowMs=300s）
  const r = lim.recordFail('7.7.7.7', 1000 + 301_000);
  assert.strictEqual(r.blocked, false); // 计数重置，仅算第 1 次
});

test('成功登录：reset 清掉该 IP 计数', () => {
  const lim = makeLimiter();
  lim.recordFail('6.6.6.6', 1000);
  lim.recordFail('6.6.6.6', 2000);
  lim.reset('6.6.6.6');
  // 重新两次失败不应封（max=3）
  const r = lim.recordFail('6.6.6.6', 3000);
  const r2 = lim.recordFail('6.6.6.6', 4000);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(r2.blocked, false);
});

test('闲置老化：超过 idleMs 的非封锁条目被回收', () => {
  const lim = makeLimiter({ pruneThreshold: 1 }); // 每次都扫
  lim.recordFail('5.5.5.5', 1000); // lastAttemptAt=1000，未封锁
  assert.strictEqual(lim.size(), 1);
  // 闲置超 idleMs(120s)，触发一次新失败（不同 IP）带起 prune
  lim.recordFail('4.4.4.4', 1000 + 121_000);
  assert.strictEqual(lim.size(), 1, '5.5.5.5 应被老化清除，只剩 4.4.4.4');
});

test('老化保护：封锁中的条目即便闲置也不被回收（防绕过）', () => {
  const lim = makeLimiter({ pruneThreshold: 1 });
  // 封锁区间 [3000, 63000]。idleMs=120s。
  for (let i = 1; i <= 3; i++) lim.recordFail('3.3.3.3', i * 1000);
  assert.strictEqual(lim.status('3.3.3.3', 4000).blocked, true);
  // 在封锁期内触发 prune（pruneThreshold=1 每次失败都扫）：封锁保护优先，
  // 3.3.3.3 必须保留——否则攻击者撑满阈值后等老化即可绕过封锁。
  lim.recordFail('2.2.2.2', 5000); // 仍在 3.3.3.3 封锁期(到63000)
  assert.strictEqual(
    lim.status('3.3.3.3', 5000).blocked,
    true,
    '封锁未到，条目必须仍在'
  );
  assert.strictEqual(lim.size(), 2);
});

test('pruneThreshold：未达规模时不扫（零开销）', () => {
  const lim = makeLimiter({ pruneThreshold: 64 });
  lim.recordFail('1.1.1.1', 1000);
  lim.recordFail('1.1.1.2', 1000 + 200_000); // 旧条目已闲置超 idleMs
  // 但 size=2 < 64，不扫 → 旧条目仍在
  assert.strictEqual(lim.size(), 2);
});

test('pruneThreshold：达规模后扫，仅删闲置非封锁条目', () => {
  // blockMs 拉长到 90s，idleMs 收到 2s，使「封锁中」与「闲置」能并存：
  // b.0.0.1 封到 3000+90s=93000；闲置条目在 1000 记录，now=5000 时已闲置 4s>2s。
  const lim = makeLimiter({ pruneThreshold: 3, blockMs: 90_000, idleMs: 2000 });
  for (let i = 1; i <= 3; i++) lim.recordFail('b.0.0.1', i * 1000);
  lim.recordFail('b.0.0.2', 1000); // 闲置（非封锁）
  lim.recordFail('b.0.0.3', 1000); // 闲置（非封锁）
  assert.strictEqual(lim.size(), 3);
  // 第 4 个不同 IP 失败（now=5000：仍在 b.0.0.1 封锁期 93000 内，
  // 且对 1000 记录的条目闲置 4s>2s）→ size 达阈值 → 扫：
  // 删两个闲置非封锁，保留封锁中的 b.0.0.1 与新的 b.0.0.4
  lim.recordFail('b.0.0.4', 5000);
  assert.strictEqual(lim.size(), 2, '应留封锁的 b.0.0.1 与新的 b.0.0.4');
  assert.strictEqual(lim.status('b.0.0.1', 5000).blocked, true);
});

test('不同 IP 独立计数', () => {
  const lim = makeLimiter();
  lim.recordFail('a.a.a.1', 1000);
  lim.recordFail('a.a.a.1', 2000);
  // 另一 IP 的失败不计入前者
  const r = lim.recordFail('a.a.a.2', 3000);
  assert.strictEqual(r.blocked, false);
  assert.strictEqual(lim.status('a.a.a.1', 3000).blocked, false); // 仅 2 次，未封
});
