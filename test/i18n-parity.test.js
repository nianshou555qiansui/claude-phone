'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 前端 I18N 是手工维护的双表；此测试防止新增文案只加了一种语言。
// 依赖 app.js 中 `zh: {` / `en: {` 的块结构——若重构 I18N 结构需同步更新此解析。
test('前端 I18N zh/en 键完全对齐', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'app.js'),
    'utf8'
  );
  const zhStart = src.indexOf('zh: {');
  const enStart = src.indexOf('en: {');
  assert.ok(zhStart > -1 && enStart > zhStart, '未找到 I18N zh/en 块');

  const zhBlock = src.slice(zhStart, enStart);
  const enBlock = src.slice(enStart, src.indexOf('};', enStart));
  const keyRe = /'([^']+)':\s*['"`]/g;
  const zh = new Set([...zhBlock.matchAll(keyRe)].map((m) => m[1]));
  const en = new Set([...enBlock.matchAll(keyRe)].map((m) => m[1]));

  assert.ok(zh.size > 100, `zh 键数异常（${zh.size}），解析可能失效`);
  const onlyZh = [...zh].filter((k) => !en.has(k));
  const onlyEn = [...en].filter((k) => !zh.has(k));
  assert.deepStrictEqual(onlyZh, [], `仅 zh 有: ${onlyZh.join(', ')}`);
  assert.deepStrictEqual(onlyEn, [], `仅 en 有: ${onlyEn.join(', ')}`);
});
