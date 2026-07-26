'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadStatus,
  saveStatus,
  shouldRun,
  publicView,
} = require('../server/lib/probe-schedule');

const H = 3600 * 1000;

test('shouldRun：间隔为 0 = 巡检关闭', () => {
  assert.strictEqual(shouldRun(null, Date.now(), 0, false).run, false);
});

test('shouldRun：从未跑过 + 空闲 → 跑', () => {
  assert.strictEqual(shouldRun(null, Date.now(), 24 * H, false).run, true);
});

test('shouldRun：距上次不足间隔 → 不跑', () => {
  const st = { ok: true, at: Date.now() - 2 * H };
  const d = shouldRun(st, Date.now(), 24 * H, false);
  assert.strictEqual(d.run, false);
  assert.strictEqual(d.reason, 'fresh');
});

test('shouldRun：到期但有活跃回合 → 顺延', () => {
  const st = { ok: true, at: Date.now() - 25 * H };
  const d = shouldRun(st, Date.now(), 24 * H, true);
  assert.strictEqual(d.run, false);
  assert.strictEqual(d.reason, 'busy');
});

test('shouldRun：到期且空闲 → 跑', () => {
  const st = { ok: false, at: Date.now() - 25 * H };
  assert.strictEqual(shouldRun(st, Date.now(), 24 * H, false).run, true);
});

test('save/load 往返 + publicView 裁剪 + 原子写不留 .tmp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-probe-'));
  const f = path.join(dir, 'probe-status.json');
  const st = {
    ok: false,
    at: 1234567,
    model: 'claude-test-1',
    error: 'x'.repeat(500),
    internal: 'should-not-leak',
  };
  saveStatus(f, st);
  const back = loadStatus(f);
  assert.strictEqual(back.at, 1234567);
  const pub = publicView(back);
  assert.deepStrictEqual(Object.keys(pub).sort(), ['at', 'error', 'model', 'ok']);
  assert.ok(pub.error.length <= 240, '错误信息应截断');
  assert.strictEqual(publicView({ ok: true, at: 1, error: 'old' }).error, null);
  assert.strictEqual(publicView(null), null);
  // 原子 rename 后不应残留 .tmp.*
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('.tmp.'));
  assert.deepStrictEqual(leftovers, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadStatus：文件不存在/损坏 → null 不抛', () => {
  assert.strictEqual(loadStatus('/nonexistent/probe.json'), null);
  const f = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'cp-probe-')),
    'bad.json'
  );
  fs.writeFileSync(f, '{broken');
  assert.strictEqual(loadStatus(f), null);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});
