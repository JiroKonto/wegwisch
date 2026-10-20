// Suggestions: the best delete candidates from every source, ranked by how safe they are and how much they free.
//   conf >= 0.85  "very safe"     – caches, temp files, old installers: regenerated or not needed
//   conf >= 0.70  "probably safe" – extra copies of duplicates, unpacked archives, old build folders
//   below         "check first"   – big files nobody touched in a long time (could be precious)
const fs = require('fs');
const path = require('path');
const junk = require('./junk');
const finds = require('./finds');
const scanner = require('./scanner');

const DAY = 864e5;
const BASE = {
  temp: .95, cache: .9, shadercache: .95, browser: .95, devcache: .9, crash: .95, update: .9,
  installer: .88, archive_dup: .8, node_modules: .78, unity_library: .76, unreal_cache: .8, oldwin: .7,
};
const level = conf => conf >= .85 ? 'high' : conf >= .7 ? 'mid' : 'low';
const ageOf = p => { try { return Date.now() - fs.statSync(p).mtimeMs; } catch { return 0; } };

function candidates(startDupes) {
  const out = [];
  for (const j of junk.all()) {
    let conf = BASE[j.kind] ?? .7;
    // build folders of projects you still work on are not great suggestions
    if (['node_modules', 'unity_library', 'unreal_cache'].includes(j.kind)) {
      const age = ageOf(path.dirname(j.path));
      if (age < 30 * DAY) continue;
      if (age > 180 * DAY) conf += .07;
    }
    out.push({ path: j.path, kind: j.kind, conf: Math.min(.97, conf), contents: j.contents, cache: j.cache, size: j.size ?? scanner.get(j.path)?.size ?? null });
  }
  for (const f of finds.bigOld()) {
    const years = (Date.now() - Math.max(f.mtime, f.atime || 0)) / (365 * DAY);
    out.push({ path: f.path, kind: 'bigold', conf: Math.min(.68, .5 + years * .05), size: f.size, isFile: true });
  }
  const d = finds.dupes({ start: startDupes });
  for (const g of d.groups) {
    if (g.files.length < 2) continue;
    out.push({ path: 'dupe:' + g.hash, kind: 'dupe', conf: g.sampled ? .72 : .8, size: g.size * (g.files.length - 1), group: g });
  }
  // dedupe by path, best confidence wins
  const best = new Map();
  for (const c of out) { const k = c.path.startsWith('dupe:') ? c.path : scanner.key(c.path); if (!best.has(k) || best.get(k).conf < c.conf) best.set(k, c); }
  return [...best.values()].map(c => ({ ...c, level: level(c.conf) }));
}

// rank: safe things first, but a huge "probably safe" beats a tiny "very safe"
const score = c => c.conf * Math.log2(2 + (c.size || 0) / (1024 * 1024));

let cache = null, byPath = new Map(), cacheAt = 0;
function list({ startDupes = false } = {}) {
  if (startDupes) finds.dupes();
  if (!cache || Date.now() - cacheAt > 15000) {
    cache = candidates(false).sort((a, b) => score(b) - score(a));
    byPath = new Map();
    for (const c of cache) {
      if (c.group) {
        // every copy except the oldest is a suggestion
        [...c.group.files].sort((a, b) => a.mtime - b.mtime).slice(1).forEach(f => byPath.set(scanner.key(f.path), { kind: 'dupe', level: c.level }));
      } else byPath.set(scanner.key(c.path), { kind: c.kind, level: c.level });
    }
    cacheAt = Date.now();
  }
  return cache;
}
// for badges while browsing: is this path a suggestion?
function match(p) { list(); return byPath.get(scanner.key(p)) || null; }
function invalidate() { cache = null; }

module.exports = { list, match, invalidate, level };
