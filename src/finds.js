// Things found while scanning:
//   bigOld()     – big files nobody touched in a long time
//   dupes()      – identical big files (same size, then same content hash)
//   growth()     – folders that grew since the last time they were measured (snapshots in the data dir)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const scanner = require('./scanner');
const config = require('./config');

const big = new Map(); // key -> {path, size, logical, mtime, atime, ino}

scanner.events.on('dir', (dir, r) => {
  for (const [name, size, logical, mtime, atime, ino] of r.big) {
    const p = path.join(dir, name);
    big.set(scanner.key(p), { path: p, size, logical, mtime, atime, ino });
  }
});

function drop(p) {
  const k = scanner.key(p);
  for (const key of [...big.keys()]) if (key === k || key.startsWith(k + path.sep)) big.delete(key);
  for (const g of dupeGroups.values()) g.files = g.files.filter(f => !(scanner.key(f.path) === k || scanner.key(f.path).startsWith(k + path.sep)));
}

// ---------- big & old ----------
const YEAR = 365 * 864e5;
function bigOld({ minSize = 500 * 1024 ** 2, minAge = YEAR } = {}) {
  const now = Date.now();
  return [...big.values()]
    .filter(f => f.size >= minSize && now - Math.max(f.mtime, f.atime || 0) > minAge && fs.existsSync(f.path))
    .sort((a, b) => b.size - a.size)
    .slice(0, 300);
}

// ---------- duplicates ----------
const dupeGroups = new Map(); // "size:hash" -> {size, hash, sampled, files:[...]}
const job = { running: false, checked: 0, total: 0 };
const hashCache = new Map(); // key+mtime+size -> hash

const CHUNK = 1024 * 1024;
const FULL_LIMIT = 2 * 1024 ** 3; // up to 2 GB hash everything, above that 32 spread-out samples

async function hashFile(f, partial) {
  const ck = `${scanner.key(f.path)}|${f.mtime}|${f.logical}|${partial ? 'p' : 'f'}`;
  if (hashCache.has(ck)) return hashCache.get(ck);
  const h = crypto.createHash('sha1');
  const fh = await fsp.open(f.path, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    if (partial || f.logical > FULL_LIMIT) {
      const n = partial ? 3 : 32;
      for (let i = 0; i < n; i++) {
        const pos = Math.floor((f.logical - CHUNK) * (i / (n - 1)));
        const { bytesRead } = await fh.read(buf, 0, CHUNK, Math.max(0, pos));
        h.update(buf.subarray(0, bytesRead));
      }
    } else {
      let pos = 0;
      while (pos < f.logical) { const { bytesRead } = await fh.read(buf, 0, CHUNK, pos); if (!bytesRead) break; h.update(buf.subarray(0, bytesRead)); pos += bytesRead; }
    }
  } finally { await fh.close(); }
  const d = h.digest('hex');
  hashCache.set(ck, d);
  return d;
}

async function findDupes() {
  if (job.running) return;
  job.running = true;
  try {
    // same logical size, different file (hard links share an inode and are not duplicates)
    const bySize = new Map();
    for (const f of big.values()) { if (!bySize.has(f.logical)) bySize.set(f.logical, []); bySize.get(f.logical).push(f); }
    const cands = [...bySize.values()].map(g => [...new Map(g.map(f => [f.ino + '|' + f.logical, f])).values()]).filter(g => g.length > 1);
    job.total = cands.reduce((s, g) => s + g.length, 0); job.checked = 0;
    for (const g of cands.sort((a, b) => b[0].logical * b.length - a[0].logical * a.length)) {
      // cheap pass first (3 samples), then the real hash only for files that still match
      const byPartial = new Map();
      for (const f of g) { try { const h = await hashFile(f, true); if (!byPartial.has(h)) byPartial.set(h, []); byPartial.get(h).push(f); } catch {} job.checked++; }
      for (const pg of byPartial.values()) {
        if (pg.length < 2) continue;
        const byFull = new Map();
        for (const f of pg) { try { const h = await hashFile(f, false); if (!byFull.has(h)) byFull.set(h, []); byFull.get(h).push(f); } catch {} }
        for (const [h, files] of byFull) if (files.length > 1) dupeGroups.set(files[0].logical + ':' + h, { size: files[0].size, hash: h, sampled: files[0].logical > FULL_LIMIT, files });
      }
    }
  } finally { job.running = false; }
}

// start=false: only report what's already known (used for badges while browsing)
function dupes({ start = true } = {}) {
  if (start && !job.running) findDupes();
  const groups = [...dupeGroups.values()].map(g => ({ ...g, files: g.files.filter(f => fs.existsSync(f.path)) })).filter(g => g.files.length > 1);
  return { groups: groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1)), running: job.running, checked: job.checked, total: job.total, known: big.size };
}

// ---------- growth since last time ----------
const SNAP = 'snapshot.json';
const prev = config.load(SNAP, {}); // key -> {p, s, at}
const curr = {};
const sessionStart = Date.now();
const depthOf = k => k.split(path.sep).filter(Boolean).length;
scanner.events.on('size', (p, r) => {
  const k = scanner.key(p);
  if (r.size >= 200 * 1024 ** 2 && depthOf(k) <= 6) curr[k] = { p, s: r.size, at: Date.now() };
});
function saveSnapshot() { try { config.save(SNAP, { ...prev, ...curr }); } catch {} }
setInterval(saveSnapshot, 60000).unref();
process.on('exit', saveSnapshot);
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => process.exit(0)));

// change of a folder since its last measurement in an earlier session (null if unknown)
function delta(p) {
  const k = scanner.key(p), a = prev[k], b = curr[k];
  if (!a || !b || a.at > sessionStart) return null;
  return { delta: b.s - a.s, since: a.at };
}
function growth({ min = 1024 ** 3 } = {}) {
  const list = Object.keys(curr).map(k => ({ k, d: delta(curr[k].p) })).filter(x => x.d && x.d.delta >= min);
  // drop a parent if one of its children explains most of its growth
  const keep = list.filter(x => !list.some(y => y.k !== x.k && y.k.startsWith(x.k + path.sep) && y.d.delta >= x.d.delta * 0.8));
  return keep.map(x => ({ path: curr[x.k].p, size: curr[x.k].s, grew: x.d.delta, since: x.d.since })).sort((a, b) => b.grew - a.grew).slice(0, 100);
}
const hasHistory = () => Object.keys(prev).length > 0;

module.exports = { bigOld, dupes, growth, delta, drop, hasHistory };
