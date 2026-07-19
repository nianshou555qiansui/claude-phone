'use strict';

/**
 * 聊天层本地命令（print 模式不支持交互式 slash UI，这里做等价能力）
 * 返回：
 *  - { handled:false } 交给 claude
 *  - { handled:true, ... } 本地处理
 */

const LOCAL_COMMANDS = [
  {
    id: 'help',
    aliases: ['/help', '/?', '/commands'],
    summary: '显示可用命令',
  },
  {
    id: 'rewind',
    aliases: ['/rewind', '/rw', '/undo'],
    summary: '回退对话：/rewind 或 /rewind 1（回退 N 个用户回合）',
  },
  {
    id: 'clear',
    aliases: ['/clear', '/new'],
    summary: '清空当前对话上下文（保留会话壳）',
  },
  {
    id: 'compact',
    aliases: ['/compact'],
    summary: '压缩：本地丢弃过早消息，只保留最近若干轮',
  },
  {
    id: 'status',
    aliases: ['/status'],
    summary: '显示当前会话状态（模式/目录/是否可 resume）',
  },
  {
    id: 'mode',
    aliases: ['/mode', '/permission'],
    summary: '切换权限：/mode acceptEdits|plan|default|dontAsk|bypassPermissions',
  },
  {
    id: 'cwd',
    aliases: ['/cwd', '/cd'],
    summary: '查看或切换工作目录：/cwd 或 /cwd /path',
  },
  {
    id: 'model',
    aliases: ['/model'],
    summary: '打开模型选择器（或 /model <id> 指定）',
  },
  {
    id: 'resume',
    aliases: ['/resume', '/import'],
    summary: '导入本机 CLI 会话（扫 ~/.claude/projects，--resume 继续）',
  },
];

function parseSlash(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const m = raw.match(/^(\/[^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] || '').trim();
  return { cmd, arg, raw };
}

function findCommand(cmdToken) {
  const t = String(cmdToken || '').toLowerCase();
  return LOCAL_COMMANDS.find((c) => c.aliases.includes(t)) || null;
}

/**
 * @returns {null | { type:string, payload:object, reply:string, stopClaude?:boolean }}
 */
function resolveLocalCommand(text, ctx) {
  const parsed = parseSlash(text);
  if (!parsed) return null;
  const def = findCommand(parsed.cmd);
  if (!def) {
    // 未知 /xxx：仍交给 claude，但提示用户可用 /help
    return {
      type: 'unknown_slash',
      payload: { cmd: parsed.cmd, arg: parsed.arg },
      reply: null,
      stopClaude: false,
      passThrough: true,
      note: `未识别本地命令 ${parsed.cmd}。输入 /help 查看手机端可用命令；部分交互式 slash（如 TUI 里的面板）在 -p 模式不可用。`,
    };
  }

  switch (def.id) {
    case 'help': {
      const lines = [
        '手机端可用命令（聊天层实现）：',
        ...LOCAL_COMMANDS.map((c) => `• ${c.aliases[0]} — ${c.summary}`),
        '',
        '说明：完整 Claude Code 交互式 TUI 命令（弹窗选文件等）在聊天 API 模式下不可用；',
        '回退用 /rewind，清上下文用 /clear，权限用右上角或 /mode。',
      ];
      return {
        type: 'help',
        payload: {},
        reply: lines.join('\n'),
        stopClaude: true,
      };
    }
    case 'rewind': {
      const n = parsed.arg ? Math.max(1, parseInt(parsed.arg, 10) || 1) : 1;
      return {
        type: 'rewind',
        payload: { turns: n },
        reply: `已回退最近 ${n} 个用户回合。后续消息会基于剩余历史继续（不再 resume 旧 CLI session）。`,
        stopClaude: true,
      };
    }
    case 'clear':
      return {
        type: 'clear',
        payload: {},
        reply: '已清空本对话消息与 CLI 会话绑定。可以重新开始。',
        stopClaude: true,
      };
    case 'compact': {
      const keep = parsed.arg ? Math.max(2, parseInt(parsed.arg, 10) || 12) : 12;
      return {
        type: 'compact',
        payload: { keepTurns: keep },
        reply: `已压缩：只保留最近约 ${keep} 轮用户消息相关上下文。`,
        stopClaude: true,
      };
    }
    case 'status': {
      const s = ctx.session || {};
      const lines = [
        `会话: ${s.title || s.id}`,
        `权限模式: ${s.permissionMode}`,
        `工作目录: ${s.workDir}`,
        `Claude resume: ${s.claudeSessionId || '（无，将注入历史）'}`,
        `状态: ${s.status}`,
        `消息数: ${ctx.messageCount ?? '?'}`,
      ];
      return {
        type: 'status',
        payload: {},
        reply: lines.join('\n'),
        stopClaude: true,
      };
    }
    case 'mode': {
      if (!parsed.arg) {
        return {
          type: 'mode_help',
          payload: {},
          reply: `当前模式: ${ctx.session?.permissionMode}\n用法: /mode acceptEdits|manual|plan|auto|bypassPermissions|dontAsk`,
          stopClaude: true,
        };
      }
      return {
        type: 'mode',
        payload: { mode: parsed.arg },
        reply: `权限模式已切换为: ${parsed.arg}`,
        stopClaude: true,
      };
    }
    case 'cwd': {
      if (!parsed.arg) {
        return {
          type: 'cwd',
          payload: { path: null },
          reply: `当前工作目录: ${ctx.session?.workDir}`,
          stopClaude: true,
        };
      }
      return {
        type: 'cwd',
        payload: { path: parsed.arg },
        reply: `工作目录将切换为: ${parsed.arg}`,
        stopClaude: true,
      };
    }
    case 'model':
      // 无参数：前端拦截打开 sheet；有参数：本地设置会话模型
      return {
        type: 'model',
        payload: { model: parsed.arg || null },
        reply: parsed.arg
          ? `将切换模型: ${parsed.arg}（若由网页处理则以 UI 为准）`
          : '请使用网页模型选择器，或 /model <id>',
        stopClaude: true,
        passThrough: false,
        openModelPicker: !parsed.arg,
      };
    case 'resume':
      // 有参数：按 claude session id 导入；无参数：打开选择器
      return {
        type: 'resume',
        payload: { claudeSessionId: parsed.arg || null },
        reply: parsed.arg
          ? `将导入本机会话: ${parsed.arg}`
          : '请使用会话列表选择要 resume 的本机 CLI 对话。',
        stopClaude: true,
        passThrough: false,
        openResumePicker: !parsed.arg,
      };
    default:
      return null;
  }
}

module.exports = {
  LOCAL_COMMANDS,
  parseSlash,
  findCommand,
  resolveLocalCommand,
};
