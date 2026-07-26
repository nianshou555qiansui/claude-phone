'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildModelCatalog } = require('../server/lib/models');
const {
  LOCAL_COMMANDS,
  commandSummary,
  parseSlash,
} = require('../server/lib/commands');

test('parseSlash 解析命令与参数', () => {
  assert.deepStrictEqual(parseSlash('/model claude-3'), {
    cmd: '/model',
    arg: 'claude-3',
    raw: '/model claude-3',
  });
  assert.strictEqual(parseSlash('随便说点什么'), null);
  assert.strictEqual(parseSlash('/MODE').cmd, '/mode');
  assert.strictEqual(parseSlash('  /clear  ').cmd, '/clear');
});

test('每个本地命令都有中英摘要（防新增命令漏翻译）', () => {
  for (const cmd of LOCAL_COMMANDS) {
    assert.ok(cmd.summary, `${cmd.cmd} 缺 summary`);
    assert.ok(cmd.summaryEn, `${cmd.cmd} 缺 summaryEn`);
  }
});

test('commandSummary 按语言取值并互为兜底', () => {
  const c = { summary: '中文摘要', summaryEn: 'English summary' };
  assert.strictEqual(commandSummary(c, 'zh'), '中文摘要');
  assert.strictEqual(commandSummary(c, 'en'), 'English summary');
  assert.strictEqual(commandSummary({ summary: '只有中文' }, 'en'), '只有中文');
  assert.strictEqual(commandSummary(null, 'zh'), '');
});

test('buildModelCatalog 内置项存在且按语言本地化', () => {
  const zh = buildModelCatalog('zh');
  const en = buildModelCatalog('en');
  assert.ok(Array.isArray(zh.models) && zh.models.length > 0);

  const zhDefault = zh.models.find((m) => m.id === 'default');
  const enDefault = en.models.find((m) => m.id === 'default');
  assert.ok(zhDefault && enDefault, '内置 default 项应存在');
  assert.notStrictEqual(
    zhDefault.description,
    enDefault.description,
    'zh/en 描述应本地化而非同一份'
  );
  assert.ok(zh.groupsZh && zh.groupsEn, '分组标签应双语齐备');
});
