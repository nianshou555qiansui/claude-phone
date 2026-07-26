'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  messageFingerprint,
  contentFingerprint,
  normalizeBubbleText,
  isNearDuplicateContent,
  isNearDuplicateOfExisting,
} = require('../server/lib/dedupe');

test('normalizeBubbleText 折叠空白并保留正文', () => {
  assert.strictEqual(normalizeBubbleText('a\r\nb'), 'a\nb');
  assert.strictEqual(normalizeBubbleText('你好   世界\t\t！'), '你好 世界 ！');
  // 单个空白不折叠（{2,} 起步）
  assert.strictEqual(normalizeBubbleText('你好 世界'), '你好 世界');
  assert.strictEqual(normalizeBubbleText('  x \n\n\n\n y  '), 'x\n\n y');
  assert.strictEqual(normalizeBubbleText(null), '');
});

test('messageFingerprint 优先 cliUuid，其次内容 hash', () => {
  assert.strictEqual(messageFingerprint({ meta: { cliUuid: 'u1' } }), 'cli:u1');
  const a = { role: 'user', createdAt: 100, content: '同一句话' };
  const b = { role: 'user', createdAt: 100, content: '同一句话' };
  const c = { role: 'user', createdAt: 100, content: '不同的话' };
  assert.strictEqual(messageFingerprint(a), messageFingerprint(b));
  assert.notStrictEqual(messageFingerprint(a), messageFingerprint(c));
});

test('contentFingerprint 对空白差异不敏感、对角色敏感', () => {
  const a = { role: 'user', content: '你好  世界' };
  const b = { role: 'user', content: '你好 世界' };
  const c = { role: 'assistant', content: '你好 世界' };
  assert.strictEqual(contentFingerprint(a), contentFingerprint(b));
  assert.notStrictEqual(contentFingerprint(b), contentFingerprint(c));
});

test('近重复：完全相同 / 仅空白差异', () => {
  assert.ok(isNearDuplicateContent('测试内容一致。', '测试内容一致。'));
  assert.ok(isNearDuplicateContent('测试  内容\r\n一致。', '测试 内容\n一致。'));
});

test('近重复：markdown 强调差异（**温馨提示** vs 温馨提示）', () => {
  assert.ok(
    isNearDuplicateContent('**温馨提示**：请勿重启服务', '温馨提示：请勿重启服务')
  );
});

test('近重复：CLI 拆条首句（带句末标点的短前缀）折叠', () => {
  // 用户实际遇到的回归案例：14 字首句被 CLI 单独记一条
  const lead = '网络受限，我换几个来源再试。';
  const full = '网络受限，我换几个来源再试。稍等一下，我先查另一个镜像站再汇报结果。';
  assert.ok(isNearDuplicateContent(lead, full));
  assert.ok(isNearDuplicateContent(full, lead));
});

test('近重复：极短词只做全等，不误折叠', () => {
  assert.ok(!isNearDuplicateContent('好', '好的，我来处理这个问题。'));
  assert.ok(isNearDuplicateContent('好', '好'));
});

test('近重复：句末标点子串（后半段被单独记录）折叠', () => {
  const clause = '请先备份数据库。';
  const full = '注意事项：请先备份数据库。然后再执行迁移脚本，避免数据丢失。';
  assert.ok(isNearDuplicateContent(clause, full));
});

test('近重复：不同话题不折叠', () => {
  assert.ok(
    !isNearDuplicateContent(
      '这个功能已经上线了，请查收邮件通知。',
      '服务器磁盘空间不足，需要清理日志文件。'
    )
  );
});

test('近重复：长文同前缀 + 长度接近（markdown 小差异）折叠', () => {
  const base =
    '本次发布包含界面优化与稳定性修复，请在低峰期执行更新操作并观察日志输出，'.repeat(6);
  const a = base + '完毕。';
  const b = base + '完毕，另外记得同步更新文档说明。';
  assert.ok(isNearDuplicateContent(a, b));
});

test('近重复：长文 token 重叠（Jaccard）折叠，主题不同不折叠', () => {
  const body =
    '服务 已经 重启 完成，配置 文件 校验 通过，健康 检查 接口 返回 正常，备份 任务 已经 建立，定时器 触发 时间 设定 凌晨，磁盘 空间 剩余 充足，日志 输出 干净 稳定，监控 面板 显示 绿色 状态，'.repeat(2);
  assert.ok(isNearDuplicateContent('总结：' + body, '汇报：' + body));

  const other =
    '前端 页面 样式 调整 完成，按钮 颜色 换成 主题 色，字体 大小 统一 调整，间距 布局 重新 计算，深色 模式 适配 完毕，移动 端 断点 验证 通过，浏览器 兼容 测试 覆盖 主流 版本，'.repeat(2);
  assert.ok(!isNearDuplicateContent('总结：' + body, '汇报：' + other));
});

test('isNearDuplicateOfExisting 要求同角色；空候选视为重复', () => {
  const existing = [{ role: 'assistant', content: '部署完成，服务已恢复。' }];
  assert.ok(
    isNearDuplicateOfExisting(existing, {
      role: 'assistant',
      content: '部署完成，服务已恢复。',
    })
  );
  assert.ok(
    !isNearDuplicateOfExisting(existing, {
      role: 'user',
      content: '部署完成，服务已恢复。',
    })
  );
  assert.ok(isNearDuplicateOfExisting(existing, { role: 'user', content: '   ' }));
});
