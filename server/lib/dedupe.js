'use strict';

// 消息指纹与近重复折叠。被 server.js 的同步写入与展示层共用；
// 独立成模块以便单测（server.js require 即 listen，无法在测试中导入）。

function messageFingerprint(m) {
  if (!m) return '';
  const meta = m.meta || {};
  if (meta.cliUuid) return `cli:${meta.cliUuid}`;
  const content = String(m.content || '');
  // 用完整内容 hash 降低碰撞（避免仅 head 相同误判）
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return `${m.role}|${Number(m.createdAt) || 0}|${content.length}|${h}`;
}

/** 内容指纹：用于「网页已发 再试试，CLI 又记一条」去重 */
function contentFingerprint(m) {
  if (!m || !m.role) return '';
  const content = normalizeBubbleText(m.content);
  if (!content) return '';
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (h * 31 + content.charCodeAt(i)) | 0;
  }
  return `${m.role}|c:${content.length}|${h}`;
}

function normalizeBubbleText(content) {
  return String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * 网页 turn 已落完整 assistant 后，CLI transcript 常再写出：
 * - 同文案 user/assistant
 * - 被拆成多条的 assistant 碎片（短前缀 + 近似全文）
 * - 仅空白/标点差异的近重复
 * 用于 sync 写入前与展示折叠。
 */
function isNearDuplicateContent(existingText, candidateText) {
  const a = normalizeBubbleText(existingText);
  const b = normalizeBubbleText(candidateText);
  if (!a || !b) return false;
  if (a === b) return true;

  // 去 markdown 强调后再比一次（**温馨提示** vs 温馨提示）
  const stripMd = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/`+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const am = stripMd(a);
  const bm = stripMd(b);
  if (am && bm && am === bm) return true;

  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  const shortM = stripMd(short);
  const longM = stripMd(long);

  // 极短词（「好」「嗯」）：仅全等，避免误折叠
  if (short.length < 8) {
    return short === long || shortM === longM;
  }

  // 一方是另一方的前缀（CLI 常把首句拆成独立 assistant 行）
  // 例：完整 33 字 vs 「网络受限，我换几个来源再试。」（14 字）
  if (
    long.startsWith(short) ||
    longM.startsWith(shortM) ||
    long.startsWith(shortM) ||
    longM.startsWith(short)
  ) {
    const looksLikeLeadIn =
      short.length >= 8 && /[。．.!！?？：:…]\s*$/.test(short);
    if (
      looksLikeLeadIn ||
      short.length >= 40 ||
      short.length / long.length >= 0.12
    ) {
      return true;
    }
  }

  // 一方是另一方的子串（网页合并正文 vs CLI 后半段）
  if (long.includes(short) || longM.includes(shortM)) {
    const looksLikeClause =
      short.length >= 8 && /[。．.!！?？：:…]\s*$/.test(short);
    if (
      looksLikeClause ||
      short.length >= 40 ||
      short.length / long.length >= 0.12
    ) {
      return true;
    }
  }

  // 长文前缀相同且长度接近（markdown 小差异）
  if (short.length >= 80) {
    const n = Math.min(200, shortM.length);
    if (n >= 40 && am.slice(0, n) === bm.slice(0, n)) {
      const ratio =
        Math.min(am.length, bm.length) / Math.max(am.length, bm.length);
      if (ratio >= 0.75) return true;
    }
  }

  // Jaccard on first ~40 tokens for long assistant-ish blobs
  if (Math.min(am.length, bm.length) >= 200) {
    const toks = (s) =>
      s
        .slice(0, 1200)
        .split(/[\s,，。．、；;:：!！?？\n]+/)
        .filter((x) => x.length >= 2)
        .slice(0, 60);
    const ta = new Set(toks(am));
    const tb = new Set(toks(bm));
    if (ta.size && tb.size) {
      let inter = 0;
      for (const x of ta) if (tb.has(x)) inter += 1;
      const union = ta.size + tb.size - inter;
      if (union > 0 && inter / union >= 0.72) return true;
    }
  }
  return false;
}

function isNearDuplicateOfExisting(existingMsgs, candidate) {
  if (!candidate || !candidate.role) return false;
  const cand = normalizeBubbleText(candidate.content);
  if (!cand) return true;
  for (const m of existingMsgs) {
    if (!m || m.role !== candidate.role) continue;
    if (isNearDuplicateContent(m.content, candidate.content)) return true;
  }
  return false;
}

module.exports = {
  messageFingerprint,
  contentFingerprint,
  normalizeBubbleText,
  isNearDuplicateContent,
  isNearDuplicateOfExisting,
};
