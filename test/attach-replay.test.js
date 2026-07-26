'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeTurn } = require('../server/lib/claude-runner');

// 重启接管：ClaudeTurn.attach 从事件流文件重放。死 pid + 预写文件模拟
// 「服务停机期间任务已自行跑完」，断言按真实 result 完成收尾（而非中断）。

function tmpStream(lines) {
  const p = path.join(os.tmpdir(), `cp-attach-${Date.now()}-${Math.random().toString(36).slice(2)}.stream`);
  fs.writeFileSync(p, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return p;
}

test('attach：死进程 + 完整 result → 按完成收尾，追平期不广播', async () => {
  const p = tmpStream([
    { type: 'system', subtype: 'init', session_id: 'reattach-001', model: 'claude-test-1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: '停机期间算出的最终答案' }], usage: { input_tokens: 9, output_tokens: 5 }, model: 'claude-test-1' } },
    { type: 'result', subtype: 'success', is_error: false, result: '停机期间算出的最终答案', duration_ms: 42, session_id: 'reattach-001', usage: { input_tokens: 9, output_tokens: 5 } },
  ]);
  const turn = ClaudeTurn.attach({ streamPath: p, pid: 999999983, startedAt: Date.now() - 5000, timeoutMs: 60000 });
  const seen = { done: null, live: false };
  turn.on('live', () => { seen.live = true; });
  const doneP = new Promise((r) => turn.on('done', (d) => { seen.done = d; r(); }));
  assert.strictEqual(turn.isLive(), false, '追平前应为非 live');
  turn.attachStart();
  await doneP;
  assert.strictEqual(seen.live, true);
  assert.strictEqual(seen.done.ok, true, JSON.stringify(seen.done));
  assert.strictEqual(seen.done.assistantText, '停机期间算出的最终答案');
  assert.strictEqual(turn.claudeSessionId, 'reattach-001');
  fs.unlinkSync(p);
});

test('attach：死进程 + 无 result → ok=false（中断语义）', async () => {
  const p = tmpStream([
    { type: 'system', subtype: 'init', session_id: 'reattach-002', model: 'claude-test-1' },
    { type: 'assistant', message: { content: [{ type: 'text', text: '只算到一半' }] } },
  ]);
  const turn = ClaudeTurn.attach({ streamPath: p, pid: 999999983, startedAt: Date.now(), timeoutMs: 60000 });
  const doneP = new Promise((r) => turn.on('done', r));
  turn.attachStart();
  const d = await doneP;
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.assistantText, '只算到一半');
  fs.unlinkSync(p);
});
