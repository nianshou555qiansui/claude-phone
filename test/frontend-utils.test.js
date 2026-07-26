'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 前端是零依赖 IIFE，无法 require；从源码抽取纯函数做单测，
// 守住「流式尾部截断」的关键逻辑（围栏奇偶补偿、按换行切割）。

const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app.js'),
  'utf8'
);

function extractFn(name) {
  const m = src.match(
    new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`)
  );
  assert.ok(m, `public/app.js 里应能找到 function ${name}`);
  return m[0];
}

function makeStreamTail() {
  const body = extractFn('streamTailForRender');
  // 用 vm 求值抽取的源码并注入依赖（渲染上限常量 + i18n t()）。
  // 被求值的是本仓库自己的 public/app.js，与测试同信任域；vm 在这里
  // 只为依赖注入，不承担安全隔离。
  const CAP = 48 * 1024;
  const sandbox = { STREAM_RENDER_CAP: CAP, t: (k) => `[[${k}]]` };
  vm.createContext(sandbox);
  const fn = vm.runInContext(`(${body})`, sandbox);
  return { fn, CAP };
}

test('streamTailForRender：短文本原样返回', () => {
  const { fn } = makeStreamTail();
  assert.strictEqual(fn('hello **md**'), 'hello **md**');
});

test('streamTailForRender：超长文本折叠前文，带提示且在换行处切', () => {
  const { fn, CAP } = makeStreamTail();
  const line = 'x'.repeat(99) + '\n';
  const text = line.repeat(Math.ceil((CAP + 8000) / 100));
  const out = fn(text);
  assert.ok(out.startsWith('[[chat.streamFolded]]\n\n'), '应有折叠提示前缀');
  const tail = out.slice('[[chat.streamFolded]]\n\n'.length);
  assert.ok(tail.length <= CAP, '尾部不超过渲染上限');
  assert.ok(tail.startsWith('x'), '应在换行边界后开始，不切断行');
  assert.ok(text.endsWith(tail), '尾部必须是原文的真实后缀');
});

test('streamTailForRender：前文有未闭合代码围栏时给尾部补开栏', () => {
  const { fn, CAP } = makeStreamTail();
  // 前段：一个打开未闭合的围栏；尾段：普通文本填满超过 CAP
  const head = 'intro\n```js\nconst a = 1;\n';
  const filler = ('y'.repeat(79) + '\n').repeat(Math.ceil((CAP + 4000) / 80));
  const out = fn(head + filler);
  const tail = out.slice('[[chat.streamFolded]]\n\n'.length);
  assert.ok(tail.startsWith('```\n'), '奇数围栏应补一个开栏');
});

test('streamTailForRender：前文围栏成对闭合则不补', () => {
  const { fn, CAP } = makeStreamTail();
  const head = 'intro\n```js\nconst a = 1;\n```\n';
  const filler = ('z'.repeat(79) + '\n').repeat(Math.ceil((CAP + 4000) / 80));
  const out = fn(head + filler);
  const tail = out.slice('[[chat.streamFolded]]\n\n'.length);
  assert.ok(!tail.startsWith('```\n'), '偶数围栏不应补开栏');
});
