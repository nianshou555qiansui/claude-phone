'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../server/lib/sessions-auth');

test('sign/verify 往返成功', () => {
  const secret = 'x'.repeat(64);
  const token = auth.signToken({
    user: 'claude',
    pass: 's3cret',
    secret,
  });
  const ok = auth.verifyToken(token, {
    user: 'claude',
    pass: 's3cret',
    secret,
  });
  assert.ok(ok);
  assert.strictEqual(ok.user, 'claude');
});

test('改密后旧 token 失效', () => {
  const secret = 'y'.repeat(64);
  const token = auth.signToken({ user: 'u', pass: 'old', secret });
  assert.strictEqual(
    auth.verifyToken(token, { user: 'u', pass: 'new', secret }),
    null
  );
});

test('用户名不匹配 / 篡改签名 / 过期 → null', () => {
  const secret = 'z'.repeat(64);
  const token = auth.signToken({ user: 'a', pass: 'p', secret, ttlMs: 60_000 });
  assert.strictEqual(
    auth.verifyToken(token, { user: 'b', pass: 'p', secret }),
    null
  );
  const tampered = token.slice(0, -2) + 'ab';
  assert.strictEqual(
    auth.verifyToken(tampered, { user: 'a', pass: 'p', secret }),
    null
  );
  const expired = auth.signToken({
    user: 'a',
    pass: 'p',
    secret,
    ttlMs: 1,
    now: Date.now() - 10_000,
  });
  assert.strictEqual(
    auth.verifyToken(expired, { user: 'a', pass: 'p', secret }),
    null
  );
});

test('parseCookies + sessionCookieValue', () => {
  const req = {
    headers: { cookie: 'a=1; cp_session=tok%2Bval; b=x' },
  };
  assert.strictEqual(auth.sessionCookieValue(req), 'tok+val');
  assert.deepStrictEqual(auth.parseCookies('x=1; y=two'), { x: '1', y: 'two' });
});

test('build/clear Set-Cookie 含 HttpOnly 与 Secure 可选', () => {
  const c = auth.buildSessionCookie('abc', { secure: true, maxAgeSec: 100 });
  assert.ok(c.includes('cp_session=abc'));
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('SameSite=Lax'));
  assert.ok(c.includes('Secure'));
  assert.ok(c.includes('Max-Age=100'));
  const cleared = auth.clearSessionCookie({ secure: false });
  assert.ok(cleared.includes('Max-Age=0'));
  assert.ok(!cleared.includes('Secure'));
});

test('ensureSecret 持久化到 dataDir 且 mode 可读', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-auth-'));
  const s1 = auth.ensureSecret(dir);
  const s2 = auth.ensureSecret(dir);
  assert.strictEqual(s1, s2);
  assert.ok(s1.length >= 32);
  assert.ok(fs.existsSync(path.join(dir, 'session-secret')));
  fs.rmSync(dir, { recursive: true, force: true });
});
