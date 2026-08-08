'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeToolPayload,
  summarizeToolPayload,
  toolPayloadIsTruncated,
} = require('../server/lib/claude-runner');

test('sanitize 大字符串截断并保留长度提示', () => {
  const s = 'x'.repeat(5000);
  const out = sanitizeToolPayload(s, 1000);
  assert.ok(typeof out === 'string');
  assert.ok(out.startsWith('xxx'));
  assert.ok(/\+4000\)/.test(out) || out.includes('…(+'));
});

test('summarize 对已短内容原样返回', () => {
  assert.strictEqual(summarizeToolPayload('hi', 100), 'hi');
  assert.deepStrictEqual(summarizeToolPayload({ a: 1 }, 100), { a: 1 });
});

test('summarize 长对象带 _truncated', () => {
  const big = { cmd: 'y'.repeat(3000), other: 1 };
  const sum = summarizeToolPayload(big, 200);
  assert.ok(sum && sum._truncated);
  assert.ok(Array.isArray(sum.keys));
});

test('toolPayloadIsTruncated 检测摘要损失', () => {
  const full = 'z'.repeat(5000);
  const sum = summarizeToolPayload(full, 100);
  assert.strictEqual(toolPayloadIsTruncated(sum, full), true);
  assert.strictEqual(toolPayloadIsTruncated('same', 'same'), false);
});
