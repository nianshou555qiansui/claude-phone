'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ApprovalRegistry } = require('../server/lib/approvals');

// 集成测试：真实 spawn bin/approval-hook.js，喂 PreToolUse stdin，
// 用真实 ApprovalRegistry + 真实 HTTP 起一个迷你服务端复现三条路由，
// 断言 hook 输出正确的 permissionDecision。不依赖 CLI / 中转，可进 CI。

const HOOK = path.join(__dirname, '..', 'bin', 'approval-hook.js');
const TOKEN = 'integration-token-abc';

function startServer(reg) {
  const server = http.createServer(async (req, res) => {
    if (req.headers['x-cp-hook-token'] !== TOKEN) {
      res.writeHead(401);
      return res.end();
    }
    let body = '';
    for await (const c of req) body += c;
    const json = body ? JSON.parse(body) : {};
    if (req.url === '/api/approvals/request' && req.method === 'POST') {
      const out = reg.request({
        jobId: json.jobId,
        webSessionId: json.webSessionId,
        toolName: json.toolName,
        inputPreview: JSON.stringify(json.toolInput || ''),
        permissionMode: json.permissionMode,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    const m = req.url.match(/^\/api\/approvals\/([A-Za-z0-9]+)\/wait$/);
    if (m && req.method === 'GET') {
      const out = await reg.wait(m[1], 1500);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function runHook(port, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HOOK], {
      env: {
        ...process.env,
        CP_HOOK_PORT: String(port),
        CP_HOOK_TOKEN: TOKEN,
        CP_HOOK_JOB: 'j1',
        CP_HOOK_SESSION: 's1',
      },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
    p.stdin.write(JSON.stringify(input));
    p.stdin.end();
  });
}

test('passthrough：只读工具无需审批，hook 静默', { timeout: 10000 }, async () => {
  const reg = new ApprovalRegistry({ timeoutMs: 5000 });
  const server = await startServer(reg);
  try {
    const out = await runHook(server.address().port, {
      tool_name: 'Read',
      tool_input: { file_path: '/etc/hosts' },
      permission_mode: 'default',
    });
    assert.strictEqual(out.trim(), '');
  } finally {
    server.close();
  }
});

test('allow：服务端决定放行，hook 输出 allow', { timeout: 10000 }, async () => {
  const reg = new ApprovalRegistry({
    timeoutMs: 5000,
    onEvent: (t, p) => {
      if (t === 'request') setTimeout(() => reg.decide(p.id, 'allow'), 60);
    },
  });
  const server = await startServer(reg);
  try {
    const out = await runHook(server.address().port, {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      permission_mode: 'default',
    });
    const j = JSON.parse(out);
    assert.strictEqual(j.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.strictEqual(j.hookSpecificOutput.permissionDecision, 'allow');
  } finally {
    server.close();
  }
});

test('deny：服务端决定拒绝，hook 输出 deny', { timeout: 10000 }, async () => {
  const reg = new ApprovalRegistry({
    timeoutMs: 5000,
    onEvent: (t, p) => {
      if (t === 'request') setTimeout(() => reg.decide(p.id, 'deny'), 60);
    },
  });
  const server = await startServer(reg);
  try {
    const out = await runHook(server.address().port, {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
      permission_mode: 'default',
    });
    const j = JSON.parse(out);
    assert.strictEqual(j.hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    server.close();
  }
});

test('服务不可达：hook 静默 passthrough，绝不卡住工具', { timeout: 10000 }, async () => {
  // 指向无服务端口——hook 必须容错为放行（不输出决定），且快速返回
  const t0 = Date.now();
  const out = await runHook(59991, {
    tool_name: 'Bash',
    tool_input: { command: 'ls' },
    permission_mode: 'default',
  });
  assert.strictEqual(out.trim(), '');
  assert.ok(Date.now() - t0 < 8000, 'hook 不应在服务不可达时长时间阻塞');
});
