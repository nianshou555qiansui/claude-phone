'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { extractChatHistory } = require('../server/lib/session-import');

// CLI transcript（~/.claude/projects/*.jsonl）格式回放：
// 标本含 10 行——4 行真实对话 + 6 行应被过滤的内部行
// （summary / command 包装 / skill 注入 / 纯 tool_result / 中断标记 / 空 assistant）。

const FIXTURE = path.join(__dirname, 'fixtures', 'cli-transcript.jsonl');

test('导入只保留真实对话，内部行全部过滤', () => {
  const out = extractChatHistory(FIXTURE);
  assert.strictEqual(out.fileFound, true);
  assert.strictEqual(out.scanned, 10, '应扫描全部 10 行');

  const roles = out.messages.map((m) => m.role);
  assert.deepStrictEqual(roles, ['user', 'assistant', 'user', 'assistant']);

  const texts = out.messages.map((m) => m.content);
  assert.deepStrictEqual(texts, [
    '帮我看看首页样式',
    '好的，我看了首页样式，主要问题是间距不统一。',
    '再试试',
    '收到，重新跑了一遍，这次通过了。',
  ]);
});

test('导入保留 cliUuid 与时间戳（同步去重依赖）', () => {
  const out = extractChatHistory(FIXTURE);
  assert.deepStrictEqual(
    out.messages.map((m) => m.meta && m.meta.cliUuid),
    ['u-1', 'a-1', 'u-6', 'a-3']
  );
  for (const m of out.messages) {
    assert.strictEqual(m.meta.source, 'cli-transcript');
    assert.ok(Number.isFinite(m.createdAt) && m.createdAt > 0);
  }
});

test('文件不存在时优雅返回空结果', () => {
  const out = extractChatHistory(path.join(__dirname, 'fixtures', 'no-such.jsonl'));
  assert.strictEqual(out.fileFound, false);
  assert.deepStrictEqual(out.messages, []);
});
