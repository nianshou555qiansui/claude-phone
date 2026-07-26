#!/usr/bin/env node
'use strict';

// CLI 哨兵探针：用与 server/lib/claude-runner.js 完全一致的旗标跑一次
// `claude -p "ping"`，断言 stream-json 关键封套仍然齐全。
// 用途：升级 Claude Code CLI 前后各跑一次（bin/upgrade-cli.sh 会自动调用），
// 或怀疑中转行为变化时手动跑。
//
// 环境变量：
//   CLI_PROBE_MODEL       指定模型（默认不传 --model，用你的默认模型；
//                         想省钱可设为中转支持的廉价模型 id）
//   CLI_PROBE_BIN         claude 可执行名/路径（默认 claude）
//   CLI_PROBE_TIMEOUT_MS  超时（默认 90000）
//
// 参数：
//   --record <file>       把原始 stream-json 逐行存到文件（升级后重录测试标本用）
//
// 退出码：0 = 契约完好；1 = 有硬性检查失败（输出会写明缺了什么）。

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const BIN = process.env.CLI_PROBE_BIN || 'claude';
const MODEL = process.env.CLI_PROBE_MODEL || '';
const TIMEOUT_MS = Number(process.env.CLI_PROBE_TIMEOUT_MS || 90000);

let recordFile = '';
const ri = process.argv.indexOf('--record');
if (ri > -1 && process.argv[ri + 1]) recordFile = process.argv[ri + 1];
const recorded = [];

// 录制自动脱敏：剔除本机 hook 行，抹平 uuid/session_id/机器清单，
// 保留模型、usage、时序等契约信息——产物可直接提交为测试标本。
const FIXED_SID = '00000000-0000-4000-8000-0000000000aa';
let uuidSeq = 0;
function nextUuid() {
  uuidSeq += 1;
  return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`;
}
function sanitizeForRecord(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return line;
  }
  if (!o || typeof o !== 'object') return line;
  if (o.type === 'system' && /^hook/.test(String(o.subtype || ''))) return null;
  if (o.session_id) o.session_id = FIXED_SID;
  if (o.uuid) o.uuid = nextUuid();
  if (o.message && o.message.id) o.message.id = nextUuid();
  if (o.type === 'system' && o.subtype === 'init') {
    o.cwd = '/tmp';
    if (Array.isArray(o.tools)) o.tools = ['Bash', 'Read', 'Edit'];
    for (const k of ['mcp_servers', 'slash_commands', 'agents', 'skills', 'plugins']) {
      if (Array.isArray(o[k])) o[k] = [];
    }
    if (o.memory_paths && typeof o.memory_paths === 'object') o.memory_paths = {};
  }
  return JSON.stringify(o);
}

const ver = spawnSync(BIN, ['--version'], { encoding: 'utf8' });
console.log(`[probe] CLI: ${(ver.stdout || ver.stderr || 'unknown').trim()}`);

// 与生产 spawn 相同的旗标组合（claude-runner.js）
const args = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--permission-mode',
  'default',
];
if (MODEL) args.push('--model', MODEL);
args.push('ping');

console.log(`[probe] 运行: ${BIN} ${args.join(' ')}`);

const seen = {
  init: false,
  sessionId: '',
  assistant: false,
  assistantText: '',
  streamEvent: false,
  result: false,
  resultIsError: false,
  resultErrorText: '',
  usage: false,
  unparsable: [],
  types: new Map(),
};

const proc = spawn(BIN, args, {
  cwd: os.tmpdir(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdoutBuf = '';
let stderrBuf = '';
const killTimer = setTimeout(() => {
  console.error(`[probe] 超时 ${TIMEOUT_MS}ms，杀掉进程`);
  proc.kill('SIGKILL');
}, TIMEOUT_MS);

function handleLine(line) {
  if (recordFile) recorded.push(line);
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    if (seen.unparsable.length < 3) seen.unparsable.push(line.slice(0, 200));
    return;
  }
  const t = String(ev.type || '?');
  seen.types.set(t, (seen.types.get(t) || 0) + 1);

  if (t === 'system' && ev.subtype === 'init') {
    seen.init = true;
    seen.sessionId = String(ev.session_id || '');
  }
  if (t === 'assistant' && ev.message) {
    const content = ev.message.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b && b.type === 'text' && b.text) {
          seen.assistant = true;
          seen.assistantText += b.text;
        }
      }
    }
  }
  if (t === 'stream_event') seen.streamEvent = true;
  if (t === 'result') {
    seen.result = true;
    seen.resultIsError = !!ev.is_error;
    if (ev.is_error) {
      seen.resultErrorText = String(ev.result || ev.error || '').slice(0, 300);
    }
    const u = ev.usage || (ev.message && ev.message.usage);
    if (u && (u.input_tokens != null || u.output_tokens != null)) {
      seen.usage = true;
    }
  }
}

proc.stdout.on('data', (chunk) => {
  stdoutBuf += chunk;
  let idx;
  while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
    const line = stdoutBuf.slice(0, idx).trim();
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (line) handleLine(line);
  }
});
proc.stderr.on('data', (chunk) => {
  stderrBuf += chunk;
});

proc.on('close', (code) => {
  clearTimeout(killTimer);
  if (stdoutBuf.trim()) handleLine(stdoutBuf.trim());
  if (recordFile) {
    try {
      const lines = recorded
        .map(sanitizeForRecord)
        .filter((l) => l != null);
      fs.writeFileSync(recordFile, lines.join('\n') + '\n');
      console.log(
        `[probe] 已录制 ${lines.length} 行（脱敏后，原始 ${recorded.length}）→ ${recordFile}`
      );
    } catch (e) {
      console.error(`[probe] 录制失败: ${e.message}`);
    }
  }

  const checks = [
    ['CLI 退出码 0', code === 0, `实际 ${code}`],
    ['system/init 事件', seen.init, '未出现'],
    ['init 携带 session_id', !!seen.sessionId, '缺失或为空'],
    ['assistant 文本事件', seen.assistant, '未出现'],
    ['result 事件', seen.result, '未出现'],
    ['result 非错误', seen.result && !seen.resultIsError, seen.resultErrorText || 'is_error=true'],
    ['result 携带 usage', seen.usage, '缺失 input/output_tokens'],
  ];
  const soft = [
    ['stream_event 增量（打字机依赖）', seen.streamEvent, '未出现——网页仍能整段显示，但流式打字机会失效'],
  ];

  let failed = 0;
  for (const [name, ok, why] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : ' — ' + why}`);
    if (!ok) failed++;
  }
  for (const [name, ok, why] of soft) {
    console.log(`  ${ok ? '✓' : '⚠'} ${name}${ok ? '' : ' — ' + why}`);
  }

  const typeSummary = [...seen.types.entries()].map(([k, v]) => `${k}×${v}`).join(', ');
  console.log(`[probe] 事件类型统计: ${typeSummary || '（无任何 JSON 行）'}`);
  if (seen.unparsable.length) {
    console.log(`[probe] 无法解析的行（前${seen.unparsable.length}条）:`);
    for (const l of seen.unparsable) console.log(`    ${l}`);
  }
  if (failed && stderrBuf.trim()) {
    console.log(`[probe] stderr 尾部: ${stderrBuf.trim().slice(-400)}`);
  }

  if (failed) {
    console.log(`[probe] ✗ ${failed} 项硬性检查失败——契约可能已漂移，勿在此版本上运行服务`);
    process.exit(1);
  }
  console.log(`[probe] ✓ 契约完好（回复: ${seen.assistantText.slice(0, 60).replace(/\n/g, ' ')}）`);
});

proc.on('error', (err) => {
  clearTimeout(killTimer);
  console.error(`[probe] 无法启动 ${BIN}: ${err.message}`);
  process.exit(1);
});
