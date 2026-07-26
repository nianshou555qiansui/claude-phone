'use strict';

const crypto = require('crypto');

// 手机审批注册表：PreToolUse hook 把工具调用报到这里，
// 网页端点「允许/拒绝」后决定流回 hook。超时默认拒绝。
//
// 分流策略：
// - 只读/无副作用工具 → passthrough（不出卡片，交回 CLI 原生权限引擎，
//   原生引擎本就会自动放行安全操作、拦截越权操作）
// - acceptEdits 模式下的编辑类工具 → passthrough（该模式的语义即自动接受编辑）
// - bypassPermissions / plan / dontAsk / auto → passthrough（全放行 / 原生只读 /
//   字面「别问我」 / CLI 自动决定——这四种模式用户已明确表示不要打扰）
// - 其余（Bash / 编辑类 / mcp__* 等）→ ask（出卡片等手机决定）

const AUTO_PASSTHROUGH = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'TodoRead',
  'NotebookRead',
  'Task',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'ExitPlanMode',
  'AskUserQuestion',
]);

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function approvalDisposition(toolName, permissionMode) {
  const name = String(toolName || '');
  const mode = String(permissionMode || 'default');
  if (
    mode === 'bypassPermissions' ||
    mode === 'plan' ||
    mode === 'dontAsk' ||
    mode === 'auto'
  ) {
    return 'passthrough';
  }
  if (AUTO_PASSTHROUGH.has(name)) return 'passthrough';
  if (mode === 'acceptEdits' && EDIT_TOOLS.has(name)) return 'passthrough';
  return 'ask';
}

class ApprovalRegistry {
  /**
   * @param {{timeoutMs?:number, onEvent?:(type:string,payload:object)=>void}} [opts]
   */
  constructor(opts = {}) {
    this.timeoutMs = Number(opts.timeoutMs) || 120000;
    this.onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
    this.pending = new Map(); // id -> entry
    this.autoAllowJobs = new Set(); // 「本回合全部允许」的 jobId
  }

  /**
   * hook 报到。返回：
   *  {decision:'passthrough'} 立即放回原生引擎
   *  {decision:'allow', reason} 本回合已全允
   *  {decision:'pending', id, expiresAt} 等手机决定
   */
  request(info) {
    const disp = approvalDisposition(info.toolName, info.permissionMode);
    if (disp === 'passthrough') return { decision: 'passthrough' };
    if (info.jobId && this.autoAllowJobs.has(info.jobId)) {
      return { decision: 'allow', reason: '本回合已设为全部允许 (allow-all for this turn)' };
    }
    const id = crypto.randomBytes(8).toString('hex');
    const entry = {
      id,
      jobId: info.jobId || null,
      webSessionId: info.webSessionId || null,
      toolName: String(info.toolName || 'tool').slice(0, 120),
      inputPreview: String(info.inputPreview || '').slice(0, 600),
      toolUseId: info.toolUseId || null,
      permissionMode: info.permissionMode || 'default',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.timeoutMs,
      decision: null,
      decidedBy: null,
      waiters: [],
      timer: null,
    };
    entry.timer = setTimeout(
      () => this._resolve(id, 'deny', 'timeout'),
      this.timeoutMs
    );
    if (entry.timer.unref) entry.timer.unref();
    this.pending.set(id, entry);
    if (this.onEvent) this.onEvent('request', this.describe(entry));
    return { decision: 'pending', id, expiresAt: entry.expiresAt };
  }

  /** hook 长轮询。已决 → {decision, reason}；未决等 maxMs → {pending:true} */
  wait(id, maxMs) {
    const e = this.pending.get(id);
    if (!e) {
      return Promise.resolve({
        decision: 'deny',
        reason: '审批请求不存在或已过期 (unknown approval id)',
      });
    }
    if (e.decision) {
      return Promise.resolve({ decision: e.decision, reason: e.reason || '' });
    }
    return new Promise((resolve) => {
      const cap = Math.max(1000, Math.min(Number(maxMs) || 25000, 25000));
      const fn = (out) => {
        clearTimeout(t);
        resolve(out);
      };
      // 不 unref：此定时器挂着一个待回复的 HTTP 长轮询响应
      const t = setTimeout(() => {
        const i = e.waiters.indexOf(fn);
        if (i >= 0) e.waiters.splice(i, 1);
        resolve({ pending: true });
      }, cap);
      e.waiters.push(fn);
    });
  }

  /** 网页端决定。decision: allow | deny | allow_all */
  decide(id, decision, by) {
    const e = this.pending.get(id);
    if (!e || e.decision) return false;
    let d = String(decision || '');
    if (d === 'allow_all') {
      if (e.jobId) this.autoAllowJobs.add(e.jobId);
      d = 'allow';
    }
    if (d !== 'allow' && d !== 'deny') return false;
    this._resolve(id, d, by || 'user');
    return true;
  }

  _resolve(id, decision, by) {
    const e = this.pending.get(id);
    if (!e || e.decision) return;
    e.decision = decision;
    e.decidedBy = by;
    e.reason =
      by === 'timeout'
        ? '手机未在时限内响应，默认拒绝 (approval timed out)'
        : by === 'turn_end'
          ? '回合已结束，自动拒绝 (turn ended)'
          : decision === 'allow'
            ? '已在手机上允许 (approved via phone)'
            : '已在手机上拒绝 (denied via phone)';
    clearTimeout(e.timer);
    for (const w of e.waiters.splice(0)) {
      w({ decision: e.decision, reason: e.reason });
    }
    if (this.onEvent) {
      this.onEvent('resolved', {
        id: e.id,
        jobId: e.jobId,
        webSessionId: e.webSessionId,
        toolName: e.toolName,
        decision: e.decision,
        by,
      });
    }
    // 留一小段窗口给迟到的 wait 查询，然后清理
    const gc = setTimeout(() => this.pending.delete(id), 30000);
    if (gc.unref) gc.unref();
  }

  /** 未决列表（SSE hello 重连恢复用） */
  listPending(webSessionId) {
    const out = [];
    for (const e of this.pending.values()) {
      if (e.decision) continue;
      if (webSessionId && e.webSessionId !== webSessionId) continue;
      out.push(this.describe(e));
    }
    return out;
  }

  describe(e) {
    return {
      id: e.id,
      jobId: e.jobId,
      webSessionId: e.webSessionId,
      toolName: e.toolName,
      inputPreview: e.inputPreview,
      expiresAt: e.expiresAt,
      permissionMode: e.permissionMode,
    };
  }

  /** turn 结束：残留未决自动拒绝，清掉本回合全允标记 */
  clearJob(jobId) {
    if (!jobId) return;
    for (const e of [...this.pending.values()]) {
      if (e.jobId === jobId && !e.decision) this._resolve(e.id, 'deny', 'turn_end');
    }
    this.autoAllowJobs.delete(jobId);
  }
}

module.exports = { ApprovalRegistry, approvalDisposition, AUTO_PASSTHROUGH, EDIT_TOOLS };
