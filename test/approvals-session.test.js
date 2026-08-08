'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ApprovalRegistry } = require('../server/lib/approvals');

test('会话白名单：命中则 request 直接 allow', () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  reg.setSessionAllowTools('sess-1', ['Bash']);
  const r = reg.request({
    jobId: 'j1',
    webSessionId: 'sess-1',
    toolName: 'Bash',
    permissionMode: 'default',
  });
  assert.strictEqual(r.decision, 'allow');
  assert.ok(/session allowlist/i.test(r.reason));
});

test('allow_session 决定写入白名单，后续同工具放行', () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const r1 = reg.request({
    jobId: 'j1',
    webSessionId: 'sess-2',
    toolName: 'Edit',
    permissionMode: 'default',
  });
  assert.strictEqual(r1.decision, 'pending');
  assert.ok(reg.decide(r1.id, 'allow_session', 'user'));
  assert.deepStrictEqual(reg.getSessionAllowTools('sess-2'), ['Edit']);
  const r2 = reg.request({
    jobId: 'j2',
    webSessionId: 'sess-2',
    toolName: 'Edit',
    permissionMode: 'default',
  });
  assert.strictEqual(r2.decision, 'allow');
});

test('白名单不串会话', () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  reg.setSessionAllowTools('A', ['Bash']);
  const r = reg.request({
    jobId: 'j',
    webSessionId: 'B',
    toolName: 'Bash',
    permissionMode: 'default',
  });
  assert.strictEqual(r.decision, 'pending');
});
