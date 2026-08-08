'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ChatStore } = require('../server/lib/store');

function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-store-'));
  return { store: new ChatStore({ dataDir: dir }), dir };
}

describe('store 跨会话并发写', () => {
  it('两个会话各自更新自己的字段，sessions.json 都保留', () => {
    const { store } = freshStore();
    const a = store.createSession({ title: 'A' });
    const b = store.createSession({ title: 'B' });

    // 模拟两条 turn 同时结束各自更新状态：Node 单线程下这些同步调用
    // 会穿插执行（交错），但 updateSession 是同步快照写，各改各的 key。
    store.updateSession(a.id, { status: 'done', activeJobId: null });
    store.updateSession(b.id, { status: 'done', activeJobId: null });
    store.updateSession(a.id, { status: 'idle' });
    store.updateSession(b.id, { status: 'idle' });

    assert.equal(store.getSession(a.id).status, 'idle');
    assert.equal(store.getSession(b.id).status, 'idle');
  });

  it('同一会话的 jsonl 只有一个写者：追加不会交错', () => {
    const { store } = freshStore();
    const s = store.createSession({ title: 'S' });
    // 连续追加多条，验证每行都是合法单条 JSON（没被打断成半行）
    for (let i = 0; i < 50; i++) {
      store.appendMessage(s.id, { role: 'user', content: `msg ${i}` });
    }
    const raw = fs.readFileSync(
      path.join(store.messagesDir, `${s.id}.jsonl`),
      'utf8'
    );
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, 50);
    for (const line of lines) {
      // 每行必须能独立 parse —— 交错会让一行变成两段碎片
      const m = JSON.parse(line);
      assert.ok(m.role === 'user');
    }
  });

  it('updateMessageMeta 重写整文件不丢其它会话数据', () => {
    const { store } = freshStore();
    const a = store.createSession({ title: 'A' });
    const b = store.createSession({ title: 'B' });
    const am = store.appendMessage(a.id, { role: 'user', content: 'hi' });
    store.appendMessage(b.id, { role: 'user', content: 'yo' });

    store.updateMessageMeta(a.id, am.id, { flagged: true });

    // b 的消息不受影响
    const bMsgs = store.listMessages(b.id);
    assert.equal(bMsgs.length, 1);
    assert.equal(bMsgs[0].content, 'yo');
    // a 的 meta 写进去了
    const aMsgs = store.listMessages(a.id);
    assert.equal(aMsgs[0].meta.flagged, true);
  });

  it('rewind 只影响目标会话', () => {
    const { store } = freshStore();
    const a = store.createSession({ title: 'A' });
    const b = store.createSession({ title: 'B' });
    store.appendMessage(a.id, { role: 'user', content: 'a1' });
    const am2 = store.appendMessage(a.id, { role: 'user', content: 'a2' });
    store.appendMessage(b.id, { role: 'user', content: 'b1' });

    store.rewindTo(a.id, am2.id);

    assert.equal(store.listMessages(a.id).length, 2);
    assert.equal(store.listMessages(b.id).length, 1);
  });
});
