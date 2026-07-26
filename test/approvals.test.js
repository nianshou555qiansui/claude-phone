'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  ApprovalRegistry,
  approvalDisposition,
} = require('../server/lib/approvals');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('分流策略：只读放行、风险工具问询、模式语义正确', () => {
  assert.strictEqual(approvalDisposition('Read', 'default'), 'passthrough');
  assert.strictEqual(approvalDisposition('Grep', 'default'), 'passthrough');
  assert.strictEqual(approvalDisposition('Bash', 'default'), 'ask');
  assert.strictEqual(approvalDisposition('Edit', 'default'), 'ask');
  assert.strictEqual(approvalDisposition('mcp__foo__bar', 'default'), 'ask');
  // acceptEdits：编辑类自动过，Bash 仍问
  assert.strictEqual(approvalDisposition('Write', 'acceptEdits'), 'passthrough');
  assert.strictEqual(approvalDisposition('Bash', 'acceptEdits'), 'ask');
  // bypass / plan 全部放回原生引擎
  assert.strictEqual(approvalDisposition('Bash', 'bypassPermissions'), 'passthrough');
  assert.strictEqual(approvalDisposition('Bash', 'plan'), 'passthrough');
});

test('允许流程：request→decide(allow)→wait 得到放行', async () => {
  const events = [];
  const reg = new ApprovalRegistry({
    timeoutMs: 5000,
    onEvent: (t, p) => events.push([t, p]),
  });
  const r = reg.request({
    jobId: 'j1',
    webSessionId: 's1',
    toolName: 'Bash',
    inputPreview: 'touch /x',
    permissionMode: 'default',
  });
  assert.strictEqual(r.decision, 'pending');
  assert.strictEqual(reg.listPending('s1').length, 1);
  assert.strictEqual(reg.listPending('别的会话').length, 0);

  const waiting = reg.wait(r.id, 3000);
  assert.strictEqual(reg.decide(r.id, 'allow'), true);
  const out = await waiting;
  assert.strictEqual(out.decision, 'allow');
  assert.match(out.reason, /允许/);
  assert.strictEqual(reg.listPending('s1').length, 0);
  // 重复决定无效
  assert.strictEqual(reg.decide(r.id, 'deny'), false);
  assert.deepStrictEqual(events.map((e) => e[0]), ['request', 'resolved']);
});

test('拒绝流程与非法决定', async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const r = reg.request({ jobId: 'j1', toolName: 'Edit', permissionMode: 'default' });
  assert.strictEqual(reg.decide(r.id, '乱写'), false);
  assert.strictEqual(reg.decide(r.id, 'deny'), true);
  const out = await reg.wait(r.id, 1000);
  assert.strictEqual(out.decision, 'deny');
  assert.match(out.reason, /拒绝/);
});

test('allow_all：本回合后续请求免打扰，跨回合不生效', () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const r1 = reg.request({ jobId: 'j1', toolName: 'Bash', permissionMode: 'default' });
  assert.strictEqual(reg.decide(r1.id, 'allow_all'), true);
  const r2 = reg.request({ jobId: 'j1', toolName: 'Write', permissionMode: 'default' });
  assert.strictEqual(r2.decision, 'allow');
  const r3 = reg.request({ jobId: 'j2', toolName: 'Bash', permissionMode: 'default' });
  assert.strictEqual(r3.decision, 'pending');
  reg.decide(r3.id, 'deny');
});

test('超时默认拒绝', async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 40 });
  const r = reg.request({ jobId: 'j1', toolName: 'Bash', permissionMode: 'default' });
  await sleep(80);
  const out = await reg.wait(r.id, 1000);
  assert.strictEqual(out.decision, 'deny');
  assert.match(out.reason, /超时|timed out/);
});

test('wait 长轮询：未决时按 maxMs 返回 pending', async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const r = reg.request({ jobId: 'j1', toolName: 'Bash', permissionMode: 'default' });
  const t0 = Date.now();
  const out = await reg.wait(r.id, 1000);
  assert.strictEqual(out.pending, true);
  assert.ok(Date.now() - t0 >= 900, '应等满窗口');
  reg.decide(r.id, 'deny');
});

test('clearJob：回合结束残留未决自动拒绝并清全允标记', async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const r1 = reg.request({ jobId: 'j1', toolName: 'Bash', permissionMode: 'default' });
  const rAll = reg.request({ jobId: 'j1', toolName: 'Edit', permissionMode: 'default' });
  reg.decide(rAll.id, 'allow_all');
  reg.clearJob('j1');
  const out = await reg.wait(r1.id, 1000);
  assert.strictEqual(out.decision, 'deny');
  assert.match(out.reason, /回合已结束|turn ended/);
  // 全允标记已清：同 job 新请求重新问询
  const r2 = reg.request({ jobId: 'j1', toolName: 'Bash', permissionMode: 'default' });
  assert.strictEqual(r2.decision, 'pending');
  reg.decide(r2.id, 'deny');
});

test('未知 id 的 wait 直接拒绝', async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const out = await reg.wait('不存在', 1000);
  assert.strictEqual(out.decision, 'deny');
});
