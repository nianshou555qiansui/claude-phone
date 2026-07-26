'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  isSkippableUserText,
  isInternalBubbleContent,
} = require('../server/lib/session-import');

test('command 包装行被跳过', () => {
  assert.ok(isSkippableUserText('<command-name>/compact</command-name>'));
  assert.ok(isSkippableUserText('<command-message>compact</command-message>'));
  assert.ok(isSkippableUserText('<local-command-stdout>ok</local-command-stdout>'));
  assert.ok(isSkippableUserText('<system-reminder>背景信息</system-reminder>'));
});

test('skill 注入正文被跳过', () => {
  assert.ok(isSkippableUserText('Base directory for this skill: /home/x/.claude/skills/foo'));
  assert.ok(isSkippableUserText('Skill file content:\n# Foo Skill\n...'));
  assert.ok(isSkippableUserText('运行 ${CLAUDE_SKILL_DIR}/scripts/run.sh 前先检查'));
});

test('用户随口提到 skills 路径不被误杀（回归：过宽规则）', () => {
  assert.ok(
    !isSkippableUserText('我把技能装在 /home/me/.claude/skills/zh-readme 了，你看看装对没有')
  );
});

test('历史注入前导与 CLI 元状态行被跳过', () => {
  assert.ok(isSkippableUserText('以下是同一会话中此前的对话摘要（按时间顺序）。请在此基础上继续。'));
  assert.ok(isSkippableUserText('[Request interrupted by user]'));
  assert.ok(isSkippableUserText('No response requested.'));
});

test('tool_result JSON 误标为 user 时被跳过', () => {
  assert.ok(isSkippableUserText('{"type":"tool_result","content":[{"type":"text","text":"x"}]}'));
  assert.ok(isSkippableUserText('[{"tool_use_id":"t1","content":"x"}]'));
});

test('正常聊天内容不被跳过', () => {
  assert.ok(!isSkippableUserText('帮我看看首页样式哪里不对'));
  assert.ok(!isSkippableUserText('再试试'));
});

test('夹带 reminder 标签但真实内容占比高的消息保留', () => {
  const real = '请帮我检查一下昨天部署的备份脚本有没有正常跑起来，顺便看看归档权限对不对。';
  assert.ok(!isSkippableUserText(real + '<system-reminder>忽略</system-reminder>'));
  // 真实内容极短、几乎全是标签 → 跳过
  assert.ok(isSkippableUserText('好<system-reminder>' + '很长的内部提醒'.repeat(20) + '</system-reminder>'));
});

test('isInternalBubbleContent：user 委托 skip 规则，assistant 过滤空白', () => {
  assert.ok(isInternalBubbleContent('user', '<command-name>/clear</command-name>'));
  assert.ok(!isInternalBubbleContent('user', '帮我重启服务'));
  assert.ok(isInternalBubbleContent('assistant', '   '));
  assert.ok(!isInternalBubbleContent('assistant', '好的，已完成。'));
});
