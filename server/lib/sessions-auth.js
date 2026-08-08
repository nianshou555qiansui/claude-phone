'use strict';

/**
 * 网页登录会话（Cookie）。
 * 用 HMAC 签名 token，不落服务端状态：重启不掉线、多进程也一致。
 * 密码仍来自 config.env 的 AUTH_USER/AUTH_PASS；改密后旧 cookie 因
 * 密码指纹变化自动失效。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE_NAME = 'cp_session';
const DEFAULT_TTL_MS = 30 * 24 * 3600 * 1000; // 30 天

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function ensureSecret(dataDir) {
  const file = path.join(dataDir, 'session-secret');
  try {
    if (fs.existsSync(file)) {
      const s = fs.readFileSync(file, 'utf8').trim();
      if (s.length >= 32) return s;
    }
  } catch {
    /* fall through */
  }
  const s = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, s, { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* ignore */
    }
  } catch {
    /* 写不进 dataDir 时仍返回内存密钥（重启会换） */
  }
  return s;
}

function passFingerprint(pass) {
  return crypto.createHash('sha256').update(String(pass || ''), 'utf8').digest().subarray(0, 8);
}

function signToken({ user, pass, secret, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  const exp = now + (ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS);
  const payload = {
    u: String(user || ''),
    e: exp,
    p: b64url(passFingerprint(pass)),
  };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac('sha256', String(secret)).update(body).digest()
  );
  return `${body}.${sig}`;
}

function verifyToken(token, { user, pass, secret, now = Date.now() }) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expect = b64url(
    crypto.createHmac('sha256', String(secret)).update(body).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (Number(payload.e) < now) return null;
  if (String(payload.u) !== String(user || '')) return null;
  const want = b64url(passFingerprint(pass));
  const got = String(payload.p || '');
  const pa = Buffer.from(got);
  const pb = Buffer.from(want);
  if (pa.length !== pb.length || !crypto.timingSafeEqual(pa, pb)) return null;
  return { user: payload.u, exp: payload.e };
}

function parseCookies(header) {
  const out = {};
  const raw = String(header || '');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    let v = part.slice(i + 1).trim();
    try {
      v = decodeURIComponent(v);
    } catch {
      /* keep raw */
    }
    if (k) out[k] = v;
  }
  return out;
}

function sessionCookieValue(req) {
  const cookies = parseCookies(req.headers && req.headers.cookie);
  return cookies[COOKIE_NAME] || '';
}

/**
 * @param {object} opts
 * @param {boolean} [opts.secure] 是否加 Secure（HTTPS / 反代）
 * @param {number} [opts.maxAgeSec]
 */
function buildSessionCookie(token, opts = {}) {
  const maxAge =
    opts.maxAgeSec != null
      ? Math.max(0, Math.floor(opts.maxAgeSec))
      : Math.floor(DEFAULT_TTL_MS / 1000);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(opts = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function wantSecureCookie(req) {
  const xf = String((req.headers && req.headers['x-forwarded-proto']) || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (xf === 'https') return true;
  // 直连 https 极少见；loopback 开发不加 Secure，方便 http://127.0.0.1
  return false;
}

module.exports = {
  COOKIE_NAME,
  DEFAULT_TTL_MS,
  ensureSecret,
  signToken,
  verifyToken,
  parseCookies,
  sessionCookieValue,
  buildSessionCookie,
  clearSessionCookie,
  wantSecureCookie,
  passFingerprint,
  b64url,
};
