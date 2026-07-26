'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createNotifier, buildRequest } = require('../server/lib/notify');

test('buildRequest：ntfy 标题并入正文首行，UTF-8 纯文本', () => {
  const r = buildRequest('ntfy', 'https://ntfy.example/topic', '标题', '正文内容');
  assert.strictEqual(r.url, 'https://ntfy.example/topic');
  assert.strictEqual(r.init.body, '标题\n正文内容');
  assert.match(r.init.headers['content-type'], /text\/plain/);
});

test('buildRequest：bark 走路径段并 URL 编码', () => {
  const r = buildRequest('bark', 'https://api.day.app/KEY/', '审批: Bash', 'a/b 空格');
  assert.strictEqual(
    r.url,
    'https://api.day.app/KEY/' +
      encodeURIComponent('审批: Bash') +
      '/' +
      encodeURIComponent('a/b 空格')
  );
});

test('buildRequest：json 发 {title, body}', () => {
  const r = buildRequest('json', 'https://hook.example/x', 'T', 'B');
  assert.deepStrictEqual(JSON.parse(r.init.body), { title: 'T', body: 'B' });
});

test('createNotifier：URL 为空则禁用，send 直接 false', async () => {
  const n = createNotifier({ url: '', kind: 'ntfy' });
  assert.strictEqual(n.enabled, false);
  assert.strictEqual(await n.send('t', 'b'), false);
});

test('createNotifier：kind 大小写不敏感，非法 kind 回落 ntfy', () => {
  assert.strictEqual(createNotifier({ url: 'http://x', kind: 'BARK' }).kind, 'bark');
  assert.strictEqual(createNotifier({ url: 'http://x', kind: ' Json ' }).kind, 'json');
  assert.strictEqual(createNotifier({ url: 'http://x', kind: 'foo' }).kind, 'ntfy');
  assert.strictEqual(createNotifier({ url: 'file:///etc/passwd', kind: 'ntfy' }).enabled, false);
});

test('createNotifier：真实 HTTP 投递到本地服务器', async () => {
  const got = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ method: req.method, url: req.url, body });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const n = createNotifier({ url: `http://127.0.0.1:${port}/t`, kind: 'ntfy' });
  const ok = await n.send('探针失败', '424 no accounts');
  srv.close();
  assert.strictEqual(ok, true);
  assert.strictEqual(got.length, 1);
  assert.strictEqual(got[0].method, 'POST');
  assert.strictEqual(got[0].body, '探针失败\n424 no accounts');
});

test('createNotifier：服务器 500 → send 返回 false 但不抛', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const n = createNotifier({ url: `http://127.0.0.1:${port}/t`, kind: 'json' });
  assert.strictEqual(await n.send('t', 'b'), false);
  srv.close();
});
