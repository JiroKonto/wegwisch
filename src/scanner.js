// Folder sizes via a pool of worker threads. Each worker reads one directory level at a time;
// results roll up the tree. Folders the user is looking at jump the queue.
const { Worker } = require('worker_threads');
const path = require('path');
const { EventEmitter } = require('events');

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const key = p => { const r = path.resolve(p); return caseInsensitive ? r.toLowerCase() : r; };
const isUnder = (a, b) => a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);

const events = new EventEmitter(); // 'dir' -> (dirPath, result) for the junk detector
const sizes = new Map();           // key -> {size, files}
const nodes = new Map();           // key -> in-flight node
const high = [], low = [];
let focus = null;
const workers = [];
let wanted = 4;
let nextId = 1;
const inflight = new Map();        // task id -> node
const stats = { files: 0, bytes: 0, dirs: 0, started: Date.now() };
// per-drive progress: the server tells us the drive roots; each scanned byte is counted for the longest matching root
let roots = [];
const perRoot = new Map(); // root key -> bytes scanned
function setRoots(list) { roots = list.map(key).sort((a, b) => b.length - a.length); }
function rootOf(k) { return roots.find(r => isUnder(k, r)); }

function spawnWorker() {
  const w = new Worker(...require('./bundle').workerSource());
  w.busy = false;
  w.on('message', msg => { w.busy = false; onResult(msg); pump(); });
  w.on('error', () => {});
  workers.push(w);
}

function setThreads(n) {
  wanted = Math.max(1, Math.min(64, n | 0));
  while (workers.length < wanted) spawnWorker();
  pump();
}

// surplus workers retire once idle
function retire() {
  for (let i = workers.length - 1; i >= 0 && workers.length > wanted; i--) {
    if (!workers[i].busy) { workers[i].terminate(); workers.splice(i, 1); }
  }
}

function take() {
  while (high.length) {
    const n = high.pop();
    if (!focus || isUnder(n.key, focus)) return n;
    low.push(n); // user moved on, demote
  }
  return low.pop();
}

function pump() {
  retire();
  for (const w of workers) {
    if (w.busy) continue;
    const n = take();
    if (!n) return;
    const id = nextId++;
    inflight.set(id, n);
    w.busy = true;
    w.postMessage({ id, dir: n.path });
  }
}

function makeNode(p, prio) {
  const n = { path: p, key: key(p), size: 0, files: 0, pending: 1, parents: [], waiters: [], prio };
  nodes.set(n.key, n);
  (prio ? high : low).push(n);
  return n;
}

function onResult({ id, bytes, files, dirs, err, uproject, dupArchives, big }) {
  const n = inflight.get(id);
  inflight.delete(id);
  if (!n) return;
  stats.files += files; stats.bytes += bytes; stats.dirs++;
  const rk = rootOf(n.key); if (rk) perRoot.set(rk, (perRoot.get(rk) || 0) + bytes);
  n.size += bytes; n.files += files;
  events.emit('dir', n.path, { dirs, uproject, dupArchives, err, big: big || [] });
  for (const name of dirs) {
    const cp = path.join(n.path, name);
    const ck = key(cp);
    const done = sizes.get(ck);
    if (done) { n.size += done.size; n.files += done.files; continue; }
    let child = nodes.get(ck);
    if (!child) child = makeNode(cp, n.prio && focus && isUnder(ck, focus));
    child.parents.push(n);
    n.pending++;
  }
  n.pending--;
  finish(n);
}

function finish(n) {
  if (n.pending > 0) return;
  const r = { size: n.size, files: n.files };
  sizes.set(n.key, r);
  nodes.delete(n.key);
  events.emit('size', n.path, r);
  n.waiters.forEach(fn => fn(r));
  for (const p of n.parents) { p.size += n.size; p.files += n.files; p.pending--; finish(p); }
}

// Get (or start computing) a folder's total size. prio=true for what the user is looking at.
function request(p, prio = false) {
  const k = key(p);
  const done = sizes.get(k);
  if (done) return Promise.resolve(done);
  let n = nodes.get(k);
  if (!n) { n = makeNode(p, prio); pump(); }
  else if (prio && !n.prio) { n.prio = true; const i = low.indexOf(n); if (i >= 0) { low.splice(i, 1); high.push(n); pump(); } }
  return new Promise(res => n.waiters.push(res));
}

function get(p) { return sizes.get(key(p)) || null; }
function setFocus(p) { focus = p ? key(p) : null; }

// After deleting: forget the path, everything inside it, and its ancestors' totals.
function invalidate(p) {
  const k = key(p);
  const dropped = sizes.get(k)?.size || 0;
  for (const s of [...sizes.keys()]) if (isUnder(s, k) || isUnder(k, s)) sizes.delete(s);
  const rk = rootOf(k); if (rk && dropped) perRoot.set(rk, Math.max(0, (perRoot.get(rk) || 0) - dropped));
}

function driveProgress(root) {
  const k = key(root);
  return { bytes: perRoot.get(k) || 0, done: sizes.has(k), active: nodes.has(k) };
}

function progress() {
  const busy = workers.filter(w => w.busy).length;
  return { queued: high.length + low.length, busy, threads: wanted, files: stats.files, bytes: stats.bytes, dirs: stats.dirs,
    rate: Math.round(stats.files / Math.max(1, (Date.now() - stats.started) / 1000)) };
}

module.exports = { request, get, setFocus, setThreads, invalidate, progress, events, key, setRoots, driveProgress };
