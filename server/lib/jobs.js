'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('./config');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function newId() {
  return crypto.randomUUID();
}

/**
 * 后台任务落盘：
 * - jobs.jsonl 索引（追加 + 紧凑重写）
 * - jobs/<id>.json 详情（含 partial 文本，重连可恢复）
 *
 * 说明：CLI 进程仍由 Node 托管；关网页不杀进程。
 * 若 Node/机器重启，运行中 job 会在启动时标为 interrupted。
 */
class JobStore {
  constructor() {
    this.dir = path.join(config.dataDir, 'jobs');
    this.indexFile = path.join(this.dir, 'index.json');
    ensureDir(this.dir);
    this.jobs = this._loadIndex();
    this._live = new Map(); // jobId -> { turn, sessionId }
  }

  _loadIndex() {
    try {
      if (!fs.existsSync(this.indexFile)) return {};
      const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  _saveIndex() {
    const tmp = this.indexFile + `.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.jobs, null, 2));
    fs.renameSync(tmp, this.indexFile);
  }

  _detailPath(id) {
    return path.join(this.dir, `${id}.json`);
  }

  _writeDetail(job) {
    const p = this._detailPath(job.id);
    const tmp = p + `.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
    fs.renameSync(tmp, p);
  }

  _touchIndex(job) {
    this.jobs[job.id] = {
      id: job.id,
      sessionId: job.sessionId,
      status: job.status,
      background: !!job.background,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt || null,
      preview: (job.userText || '').slice(0, 80),
      assistantPreview: (job.partialText || job.finalText || '').slice(0, 80),
    };
    this._saveIndex();
  }

  create({ sessionId, userText, assistantId, background, workDir, permissionMode }) {
    const now = Date.now();
    const job = {
      id: newId(),
      sessionId,
      userText: String(userText || ''),
      assistantId,
      background: !!background,
      workDir: workDir || config.workDir,
      permissionMode: permissionMode || config.defaultPermissionMode,
      status: 'running', // queued|running|done|failed|cancelled|interrupted
      partialText: '',
      finalText: '',
      claudeSessionId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      pid: null,
    };
    this._writeDetail(job);
    this._touchIndex(job);
    return job;
  }

  get(id) {
    try {
      const p = this._detailPath(id);
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  update(id, patch) {
    const job = this.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: Date.now() });
    if (
      patch.status &&
      ['done', 'failed', 'cancelled', 'interrupted'].includes(patch.status) &&
      !job.finishedAt
    ) {
      job.finishedAt = Date.now();
    }
    this._writeDetail(job);
    this._touchIndex(job);
    return job;
  }

  appendPartial(id, text) {
    if (!text) return null;
    const job = this.get(id);
    if (!job || job.status !== 'running') return job;
    job.partialText = (job.partialText || '') + text;
    job.updatedAt = Date.now();
    // 节流：每 512 字符或首次写入
    const len = job.partialText.length;
    if (len < 64 || len % 512 < text.length) {
      this._writeDetail(job);
      this._touchIndex(job);
    } else {
      // 轻量：只更新内存索引预览偶尔落盘
      this.jobs[id] = {
        ...(this.jobs[id] || {}),
        id,
        sessionId: job.sessionId,
        status: job.status,
        background: job.background,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        finishedAt: null,
        preview: (job.userText || '').slice(0, 80),
        assistantPreview: job.partialText.slice(0, 80),
      };
    }
    return job;
  }

  flush(id) {
    const job = this.get(id);
    if (!job) return null;
    this._writeDetail(job);
    this._touchIndex(job);
    return job;
  }

  list({ sessionId, limit = 50, includeFinished = true } = {}) {
    let items = Object.values(this.jobs);
    if (sessionId) items = items.filter((j) => j.sessionId === sessionId);
    if (!includeFinished) {
      items = items.filter((j) => j.status === 'running' || j.status === 'queued');
    }
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return items.slice(0, limit);
  }

  listRunning() {
    return this.list({ includeFinished: false, limit: 100 });
  }

  bindLive(jobId, meta) {
    this._live.set(jobId, meta);
  }

  unbindLive(jobId) {
    this._live.delete(jobId);
  }

  getLive(jobId) {
    return this._live.get(jobId) || null;
  }

  findRunningBySession(sessionId) {
    for (const [jobId, meta] of this._live) {
      if (meta.sessionId === sessionId) {
        const job = this.get(jobId);
        if (job && job.status === 'running') return job;
      }
    }
    // disk fallback
    return (
      this.list({ sessionId, includeFinished: false })
        .map((j) => this.get(j.id))
        .find((j) => j && j.status === 'running') || null
    );
  }

  /** 服务启动时：没有 live 进程的 running → interrupted，并尽量保留 partial */
  reconcileOrphans(onInterrupted) {
    const running = this.list({ includeFinished: false, limit: 200 });
    const out = [];
    for (const summary of running) {
      if (this._live.has(summary.id)) continue;
      const job = this.update(summary.id, {
        status: 'interrupted',
        error: '服务重启，任务中断（已保存部分输出）',
      });
      if (job) {
        out.push(job);
        if (typeof onInterrupted === 'function') {
          try {
            onInterrupted(job);
          } catch (e) {
            console.error('[jobs] onInterrupted', e);
          }
        }
      }
    }
    return out;
  }
}

module.exports = { JobStore, newId };
