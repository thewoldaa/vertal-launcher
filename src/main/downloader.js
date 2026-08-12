'use strict';
/**
 * Generic concurrent file downloader used by every installer (vanilla,
 * Fabric/Quilt, Forge/NeoForge, Java runtime). Tracks aggregate byte
 * progress across the whole queue so the UI can show one smooth percentage
 * + speed + ETA instead of per-file jumps.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function fileMatches(filePath, expectedSha1, expectedSize) {
  try {
    const stat = fs.statSync(filePath);
    if (typeof expectedSize === 'number' && stat.size !== expectedSize) return false;
    if (expectedSha1) {
      const actual = await sha1File(filePath);
      return actual.toLowerCase() === expectedSha1.toLowerCase();
    }
    return stat.size > 0;
  } catch (e) {
    return false;
  }
}

function get(url, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Vertal-Launcher/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        resolve(get(nextUrl, redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
  });
}

/**
 * Downloads a single file to destPath, skipping it if it already matches
 * the expected sha1/size. Calls onBytes(deltaBytes) as data arrives.
 */
async function downloadFile(url, destPath, { sha1, size, onBytes } = {}) {
  if (await fileMatches(destPath, sha1, size)) {
    if (onBytes && size) onBytes(size); // count as instantly "downloaded" for progress purposes
    return { skipped: true };
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmpPath = destPath + '.part';
  const res = await get(url);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    res.on('data', (chunk) => {
      if (onBytes) onBytes(chunk.length);
    });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });
  fs.renameSync(tmpPath, destPath);
  if (sha1) {
    const actual = await sha1File(destPath);
    if (actual.toLowerCase() !== sha1.toLowerCase()) {
      throw new Error(`Checksum mismatch for ${path.basename(destPath)} (expected ${sha1}, got ${actual})`);
    }
  }
  return { skipped: false };
}

/**
 * Downloads a JSON document without caching to disk.
 */
async function getJSON(url) {
  const res = await get(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

/**
 * Runs a queue of { url, dest, sha1, size, label } tasks with a bounded
 * worker pool, reporting smooth aggregate progress.
 *
 * @param {Array} tasks
 * @param {object} opts
 * @param {number} [opts.concurrency=8]
 * @param {(state: {doneBytes:number, totalBytes:number, pct:number, speedBps:number, currentFile:string, filesDone:number, filesTotal:number}) => void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 */
async function downloadQueue(tasks, opts = {}) {
  const concurrency = opts.concurrency || 8;
  const totalBytes = tasks.reduce((sum, t) => sum + (t.size || 0), 0);
  let doneBytes = 0;
  let filesDone = 0;
  const startedAt = Date.now();
  let lastTick = startedAt;
  let lastBytes = 0;
  let speedBps = 0;

  const currentFiles = new Set();

  function report() {
    const now = Date.now();
    if (now - lastTick >= 200) {
      const deltaBytes = doneBytes - lastBytes;
      const deltaSec = (now - lastTick) / 1000;
      speedBps = deltaSec > 0 ? deltaBytes / deltaSec : speedBps;
      lastTick = now;
      lastBytes = doneBytes;
    }
    if (opts.onProgress) {
      opts.onProgress({
        doneBytes,
        totalBytes,
        pct: totalBytes > 0 ? Math.min(100, (doneBytes / totalBytes) * 100) : (filesDone / Math.max(1, tasks.length)) * 100,
        speedBps,
        currentFile: [...currentFiles][0] || '',
        filesDone,
        filesTotal: tasks.length,
      });
    }
  }

  let idx = 0;
  const errors = [];

  async function worker() {
    while (idx < tasks.length) {
      if (opts.signal && opts.signal.aborted) return;
      const task = tasks[idx++];
      currentFiles.add(task.label || path.basename(task.dest));
      try {
        await downloadFile(task.url, task.dest, {
          sha1: task.sha1,
          size: task.size,
          onBytes: (n) => {
            doneBytes += n;
            report();
          },
        });
      } catch (e) {
        errors.push({ task, error: e });
      } finally {
        currentFiles.delete(task.label || path.basename(task.dest));
        filesDone += 1;
        report();
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, worker);
  await Promise.all(workers);
  report();

  if (errors.length) {
    const first = errors[0];
    const err = new Error(`Failed to download ${errors.length} file(s). First error: ${first.error.message}`);
    err.details = errors.map((e) => ({ url: e.task.url, dest: e.task.dest, message: e.error.message }));
    throw err;
  }

  return { totalBytes, elapsedMs: Date.now() - startedAt };
}

module.exports = { downloadFile, downloadQueue, getJSON, sha1File, fileMatches, get };
