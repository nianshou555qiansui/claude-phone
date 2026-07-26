'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildHistoryPrompt } = require('../server/lib/claude-runner');

test('无历史时原样返回最新输入', () => {
  assert.strictEqual(buildHistoryPrompt([], '继续'), '继续');
  assert.strictEqual(buildHistoryPrompt(null, '继续'), '继续');
});

test('包含前导说明与按序对话行', () => {
  const out = buildHistoryPrompt(
    [
      { role: 'user', content: '第一问' },
      { role: 'assistant', content: '第一答' },
    ],
    '第二问'
  );
  assert.ok(out.startsWith('以下是同一会话中此前的对话摘要'));
  assert.ok(out.includes('User: 第一问'));
  assert.ok(out.includes('Assistant: 第一答'));
  assert.ok(out.trimEnd().endsWith('User: 第二问'));
});

test('末条 user 与最新输入相同时去重（不重复发同一句）', () => {
  const out = buildHistoryPrompt(
    [
      { role: 'user', content: '早前的问题' },
      { role: 'assistant', content: '早前的回答' },
      { role: 'user', content: '再试试' },
    ],
    '再试试'
  );
  const hits = out.split('User: 再试试').length - 1;
  assert.strictEqual(hits, 1);
});

test('最多保留最近 30 条', () => {
  const msgs = [];
  for (let i = 0; i < 40; i++) {
    msgs.push({ role: i % 2 ? 'assistant' : 'user', content: `标记${i}号消息` });
  }
  const out = buildHistoryPrompt(msgs, '新问题');
  assert.ok(!out.includes('标记9号消息'));
  assert.ok(out.includes('标记10号消息'));
  assert.ok(out.includes('标记39号消息'));
});

test('单条超长内容截断到 4000 字符', () => {
  const out = buildHistoryPrompt(
    [{ role: 'assistant', content: 'x'.repeat(5000) }],
    '继续'
  );
  assert.ok(/x{4000}/.test(out));
  assert.ok(!/x{4001}/.test(out));
});

test('总量超预算时丢弃最早的消息', () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: i % 2 ? 'assistant' : 'user', content: `M${i}|` + 'y'.repeat(4000) });
  }
  const out = buildHistoryPrompt(msgs, '新问题');
  // 48000 / 4000 = 12 条：保留 M8..M19
  assert.ok(out.includes('M19|'));
  assert.ok(out.includes('M8|'));
  assert.ok(!out.includes('M7|'));
});

test('非对话角色与空内容被过滤', () => {
  const out = buildHistoryPrompt(
    [
      { role: 'system', content: '内部提示不该出现' },
      { role: 'user', content: '' },
      { role: 'user', content: '真实问题' },
    ],
    '新问题'
  );
  assert.ok(!out.includes('内部提示不该出现'));
  assert.ok(out.includes('User: 真实问题'));
});
