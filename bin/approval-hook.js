#!/usr/bin/env node
'use strict';

// PreToolUse hook：把工具调用报给 claude-phone 服务，等手机上的「允许/拒绝」。
// 由服务 spawn CLI 时注入环境：
//   CP_HOOK_PORT   服务端口（127.0.0.1）
//   CP_HOOK_TOKEN  内部令牌（每次服务启动随机生成）
//   CP_HOOK_JOB    本回合 jobId
//   CP_HOOK_SESSION 网页会话 id
// 设计原则：任何异常（服务不可达/解析失败/缺环境）都静默 exit 0 且不输出
// —— 即 passthrough，交回 CLI 原生权限引擎，绝不因审批链路故障卡死工具。

const PORT = process.env.CP_HOOK_PORT || '';
const TOKEN = process.env.CP_HOOK_TOKEN || '';
const JOB = process.env.CP_HOOK_JOB || '';
const WEB_SESSION = process.env.CP_HOOK_SESSION || '';

if (!PORT || !TOKEN) process.exit(0);

const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = {
  'content-type': 'application/json',
  'x-cp-hook-token': TOKEN,
};

function emit(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        permissionDecisionReason: String(reason || '').slice(0, 500),
      },
    })
  );
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return; // passthrough
  }

  let res;
  try {
    res = await fetch(`${BASE}/api/approvals/request`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        jobId: JOB,
        webSessionId: WEB_SESSION,
        toolName: input.tool_name || '',
        toolInput: input.tool_input || null,
        toolUseId: input.tool_use_id || '',
        permissionMode: input.permission_mode || 'default',
        cwd: input.cwd || '',
      }),
    });
  } catch {
    return; // 服务不可达 → passthrough
  }
  if (!res.ok) return;

  let r;
  try {
    r = await res.json();
  } catch {
    return;
  }

  if (r.decision === 'passthrough') return;
  if (r.decision === 'allow' || r.decision === 'deny') {
    emit(r.decision, r.reason);
    return;
  }
  if (r.decision !== 'pending' || !r.id) return;

  // 长轮询等手机决定；服务端超时会主动给出 deny，这里再留 10s 兜底余量
  const deadline = (Number(r.expiresAt) || Date.now() + 120000) + 10000;
  while (Date.now() < deadline) {
    let w;
    try {
      const wr = await fetch(
        `${BASE}/api/approvals/${encodeURIComponent(r.id)}/wait`,
        { headers: HEADERS }
      );
      if (!wr.ok) break;
      w = await wr.json();
    } catch {
      break; // 服务中途没了 → passthrough
    }
    if (w && (w.decision === 'allow' || w.decision === 'deny')) {
      emit(w.decision, w.reason);
      return;
    }
    // w.pending === true → 继续等
  }
  emit('deny', '手机未在时限内响应，默认拒绝 (approval timed out)');
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
