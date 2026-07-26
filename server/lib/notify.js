'use strict';

/**
 * 轻量手机推送（可选功能，NOTIFY_URL 非空才启用）。
 * fire-and-forget：任何失败只 console.warn，绝不阻塞/影响主流程。
 *
 * 三种投递格式（NOTIFY_KIND）：
 *   ntfy  POST <url>，纯文本 body，标题并入首行
 *         （ntfy 的 Title header 只收 latin1，中文标题走 header 会乱码）
 *   bark  POST <url>/<title>/<body>（URL 编码），兼容 api.day.app 与自托管 bark-server
 *   json  POST <url>，{"title","body"}，接自定义 webhook
 *
 * 安全：公共 ntfy 主题等同可被猜订阅的广播频道，推送内容默认只含
 * 工具名/会话名等低敏信息；正文预览需 NOTIFY_PREVIEW=1 显式打开。
 */

const TIMEOUT_MS = 5000;
const KINDS = ['ntfy', 'bark', 'json'];

function buildRequest(kind, url, title, body) {
  const t = String(title || '').slice(0, 120);
  const b = String(body || '').slice(0, 900);
  if (kind === 'bark') {
    return {
      url:
        url.replace(/\/+$/, '') +
        '/' +
        encodeURIComponent(t || 'Claude Phone') +
        '/' +
        encodeURIComponent(b || ' '),
      init: { method: 'POST' },
    };
  }
  if (kind === 'json') {
    return {
      url,
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t, body: b }),
      },
    };
  }
  // ntfy
  return {
    url,
    init: {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: t ? `${t}\n${b}` : b,
    },
  };
}

function createNotifier(opts = {}) {
  const url = String(opts.url || '').trim();
  const kindRaw = String(opts.kind || 'ntfy').toLowerCase().trim();
  const kind = KINDS.includes(kindRaw) ? kindRaw : 'ntfy';
  // 仅允许 http(s)，拒绝 file:// 等；URL 由运维在 config.env 配置，非用户输入
  const enabled = /^https?:\/\//i.test(url);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  async function send(title, body) {
    if (!enabled) return false;
    try {
      const req = buildRequest(kind, url, title, body);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      if (timer.unref) timer.unref();
      let res;
      try {
        res = await fetchImpl(req.url, { ...req.init, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) console.warn(`[notify] 推送返回 HTTP ${res.status}`);
      return res.ok;
    } catch (e) {
      console.warn('[notify] 推送失败:', (e && e.message) || e);
      return false;
    }
  }

  return { enabled, kind, send };
}

module.exports = { createNotifier, buildRequest };
