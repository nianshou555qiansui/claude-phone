'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ClaudeTurn } = require('../server/lib/claude-runner');

// 录制回放：把 stream-json 标本逐行喂给 ClaudeTurn._handleLine，
// 断言解析层对已知格式的行为。CLI 升级后若解析失败，先重录标本
// （node bin/cli-probe.js --record ...）对比 diff 即可定位格式变化。
// 测试直接调用 _handleLine 内部方法——若重构该方法名需同步更新此文件。

function replay(fixtureName) {
  const lines = fs
    .readFileSync(path.join(__dirname, 'fixtures', fixtureName), 'utf8')
    .split('\n')
    .filter(Boolean);
  const turn = new ClaudeTurn({ prompt: 'fixture-replay' });
  const events = { tool: [], delta: [], session: [], raw: [], error: [] };
  for (const k of Object.keys(events)) {
    turn.on(k, (e) => events[k].push(e));
  }
  for (const line of lines) turn._handleLine(line);
  return { turn, events };
}

test('工具事件：四种包裹形状都能解析，空壳与重复被拦', () => {
  const { events } = replay('stream-tools.jsonl');
  const tools = events.tool;
  // 9 行标本里含 1 个空壳 tool_result 和 1 个重复 tool_use——都不该产生事件
  assert.strictEqual(tools.length, 4, JSON.stringify(tools, null, 2));

  assert.deepStrictEqual(
    tools.map((t) => [t.phase, t.id]),
    [
      ['start', 'toolu_A'],
      ['result', 'toolu_A'],
      ['start', 'toolu_B'],
      ['result', 'toolu_B'],
    ]
  );
  assert.strictEqual(tools[0].name, 'Bash');
  assert.ok(JSON.stringify(tools[0].input).includes('ls -la'));
  assert.strictEqual(tools[1].isError, false);
  assert.ok(JSON.stringify(tools[1].result).includes('file1'));
  assert.strictEqual(tools[2].name, 'WebFetch');
  assert.strictEqual(tools[3].isError, true);
  assert.ok(JSON.stringify(tools[3].result).includes('fetch failed'));
});

test('会话 id、正文、模型、usage 均从流中提取', () => {
  const { turn, events } = replay('stream-tools.jsonl');
  assert.strictEqual(turn.claudeSessionId, 'probe-fixture-001');
  assert.strictEqual(events.session[0].claudeSessionId, 'probe-fixture-001');
  assert.strictEqual(turn.assistantText, '清单已经列好了。');
  assert.strictEqual(turn.lastModel, 'claude-test-1');
  assert.ok(turn.lastUsage, '应解析出 usage');
  assert.strictEqual(turn.lastUsage.inputTokens, 100);
  assert.strictEqual(turn.lastUsage.outputTokens, 25);
  assert.strictEqual(turn.lastUsage.model, 'claude-test-1');
});

// stream-ping.jsonl：2026-07-26 中转恢复后用 claude-fable-5 真实录制
// （--record 自动脱敏），完整成功封套含 thinking_tokens 与 stream_event 增量。
test('真实成功流：正文、模型、usage、流式增量全解析', () => {
  const { turn, events } = replay('stream-ping.jsonl');
  assert.strictEqual(turn.lastResultIsError, false);
  assert.strictEqual(turn.assistantText, 'pong');
  assert.strictEqual(turn.lastModel, 'claude-fable-5');
  assert.strictEqual(turn.lastUsage.inputTokens, 2);
  assert.strictEqual(turn.lastUsage.outputTokens, 67);
  assert.strictEqual(turn.lastUsage.cacheCreationInputTokens, 37467);
  assert.ok(events.delta.length >= 1, '应有流式增量');
  assert.strictEqual(events.tool.length, 0);
  assert.strictEqual(events.error.length, 0);
  assert.strictEqual(
    turn.claudeSessionId,
    '00000000-0000-4000-8000-0000000000aa'
  );
});

// stream-error.jsonl 由 bin/cli-probe.js --record 于 2026-07-26 中转 424 故障
// 期间录制的真实错误流脱敏而来（session_id/uuid/清单字段固定化，hook 行剔除）。
// 真实契约细节：subtype=success 但 is_error=true，错误文本在 result 字段。
test('真实中转错误流：is_error 与错误文本正确落地', () => {
  const { turn, events } = replay('stream-error.jsonl');
  assert.strictEqual(turn.lastResultIsError, true);
  assert.match(turn.lastErrorMessage, /424 No available accounts/);
  assert.ok(turn.assistantText.includes('API Error: 424'));
  assert.strictEqual(events.tool.length, 0, '错误流不应产生工具事件');
  assert.ok(events.error.length >= 1, '应发出 error 事件');
  assert.strictEqual(
    turn.claudeSessionId,
    '00000000-0000-4000-8000-000000000424'
  );
  // 无先前 usage 时零占位会被采纳（仅在已有真实 usage 时拒绝被零覆盖）
  assert.strictEqual(turn.lastUsage.inputTokens, 0);
  assert.strictEqual(turn.lastUsage.outputTokens, 0);
});

test('非 JSON 行走 raw 通道，不崩溃', () => {
  const turn = new ClaudeTurn({ prompt: 'x' });
  const raws = [];
  turn.on('raw', (e) => raws.push(e));
  assert.doesNotThrow(() => turn._handleLine('THIS IS NOT JSON'));
  assert.strictEqual(raws.length, 1);
  assert.ok(raws[0].line.includes('NOT JSON'));
});
