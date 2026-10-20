// HTTP API + static UI. Listens on 127.0.0.1 only.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const config = require('./config');
const platform = require('./platform');
const scanner = require('./scanner');
const junk = require('./junk');
const ai = require('./ai');
const bin = require('./bin');
const finds = require('./finds');
const programs = require('./programs');
const suggest = require('./suggest');
const { classify } = require('./protect');
const pkg = require('../package.json');

const { settings } = config;
const bundle = require('./bundle');
const APP_ROOT = bundle.ROOT;
// space actually used on disk (sparse files, cloud placeholders), same as the scanner
const onDisk = st => typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
const IMG = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

// ---------- keep list & stats ----------
const keep = new Set(config.load('keep.json', []));
const saveKeep = () => config.save('keep.json', [...keep]);
const stats = config.load('stats.json', { freed: 0, trashed: 0, items: 0, sessions: [] });
const saveStats = () => config.save('stats.json', stats);

// ---------- protection context ----------
let cloud = platform.cloudDirs();
function ctx() {
  return {
    platform: platform.PLATFORM, home: platform.HOME, systemDrive: platform.SYSTEM_DRIVE,
    oldSystems: platform.oldSystems(), cloudDirs: cloud, running: platform.runningExecutables(),
    appDirs: [APP_ROOT, config.DIR], driveRoots: drivesCache.map(d => d.path),
  };
}
let drivesCache = platform.drives();
scanner.setRoots(drivesCache.map(d => d.path));
const withScan = ds => ds.map(d => ({ ...d, scan: scanner.driveProgress(d.path) }));

function describe(p, isDir, st) {
  const k = scanner.key(p);
  const known = isDir ? scanner.get(p) : null;
  const prot = classify(p, ctx());
  const j = junk.match(p);
  return {
    name: path.basename(p) || p, path: p, isDir,
    size: isDir ? (known ? known.size : null) : onDisk(st),
    files: isDir ? (known ? known.files : null) : 1,
    mtime: st.mtimeMs, level: prot.level, reason: prot.reason,
    junk: j ? j.kind : null, contents: !!(j && j.contents && isDir), cache: !!(j && j.cache),
    kept: keep.has(k),
    grew: isDir ? finds.delta(p) : null,
    sugg: settings.suggest !== false ? suggest.match(p) : null,
  };
}

async function listDir(dir) {
  scanner.setFocus(dir);
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  let waiting = 0;
  const items = [];
  await Promise.all(ents.map(async e => {
    if (e.isSymbolicLink()) return;
    const fp = path.join(dir, e.name);
    if (keep.has(scanner.key(fp))) return;
    let st; try { st = await fsp.lstat(fp); } catch { return; }
    const isDir = st.isDirectory();
    const it = describe(fp, isDir, st);
    if (isDir && it.size == null) { waiting++; scanner.request(fp, true); }
    items.push(it);
  }));
  const parent = path.dirname(dir);
  return { path: dir, parent: parent !== dir ? parent : null, items, waiting };
}

async function statOrNull(p) { try { return await fsp.lstat(p); } catch { return null; } }

async function smartDeck(kind) {
  const items = [];
  if (kind === 'bigold') {
    for (const f of finds.bigOld()) {
      if (keep.has(scanner.key(f.path))) continue;
      const st = await statOrNull(f.path); if (!st) continue;
      items.push({ ...describe(f.path, false, st), lastUsed: Math.max(f.mtime, f.atime || 0) });
    }
  } else if (kind === 'growth') {
    for (const g of finds.growth()) {
      if (keep.has(scanner.key(g.path))) continue;
      const st = await statOrNull(g.path); if (!st) continue;
      items.push({ ...describe(g.path, true, st), size: g.size, grew: { delta: g.grew, since: g.since } });
    }
  } else if (kind === 'dupes') {
    const d = finds.dupes();
    for (const g of d.groups) {
      const files = g.files.filter(f => !keep.has(scanner.key(f.path)));
      if (files.length < 2) continue;
      files.sort((a, b) => a.mtime - b.mtime);
      items.push({ path: 'dupe:' + g.hash, name: path.basename(files[0].path), isDir: false, size: g.size * (files.length - 1), mtime: files[0].mtime, level: 'ok',
        dupe: { each: g.size, sampled: g.sampled, files: files.map(f => ({ path: f.path, mtime: f.mtime, ...classify(f.path, ctx()) })) } });
    }
    return { items, waiting: 0, progress: { running: d.running, checked: d.checked, total: d.total, known: d.known } };
  } else if (kind === 'programs') {
    for (const p of await programs.programs()) {
      if (keep.has('prog:' + p.id)) continue;
      items.push({ path: p.mac ? p.location : 'prog:' + p.id, name: p.name, isDir: !!p.mac, size: p.size, mtime: p.installed || 0, level: 'ok', program: p });
    }
  } else if (kind === 'suggest') {
    for (const c of suggest.list({ startDupes: true }).slice(0, 300)) {
      if (c.group) {
        const files = c.group.files.filter(f => !keep.has(scanner.key(f.path)));
        if (files.length < 2) continue;
        files.sort((a, b) => a.mtime - b.mtime);
        items.push({ path: c.path, name: path.basename(files[0].path), isDir: false, size: c.size, mtime: files[0].mtime, level: 'ok', sugg: { kind: 'dupe', level: c.level },
          dupe: { each: c.group.size, sampled: c.group.sampled, files: files.map(f => ({ path: f.path, mtime: f.mtime, ...classify(f.path, ctx()) })) } });
        continue;
      }
      if (keep.has(scanner.key(c.path))) continue;
      const st = await statOrNull(c.path); if (!st) continue;
      const it = describe(c.path, st.isDirectory(), st);
      if (it.isDir && it.size == null) { if (c.size != null) it.size = c.size; else scanner.request(c.path, false); }
      items.push({ ...it, sugg: { kind: c.kind, level: c.level }, contents: !!c.contents, cache: !!c.cache, junk: c.kind === 'bigold' ? null : it.junk });
    }
    return { items, waiting: 0 };
  } else if (kind === 'extras') {
    for (const x of await programs.extras()) items.push({ path: 'extra:' + x.id, name: x.id, isDir: false, size: x.size, mtime: 0, level: 'ok', extra: x });
  }
  // programs without an install folder have no size at all, so only folder-based decks wait for sizes
  return { items, waiting: kind === 'growth' || kind === 'bigold' ? items.filter(i => i.size == null).length : 0 };
}

async function peek(p) {
  let st; try { st = await fsp.lstat(p); } catch { return { children: [] }; }
  if (!st.isDirectory()) return { children: [], image: IMG.has(path.extname(p).toLowerCase()) };
  let ents = []; try { ents = await fsp.readdir(p, { withFileTypes: true }); } catch {}
  const children = await Promise.all(ents.slice(0, 500).map(async e => {
    const fp = path.join(p, e.name);
    if (e.isDirectory()) { const s = scanner.get(fp); return { name: e.name, isDir: true, size: s ? s.size : null }; }
    try { return { name: e.name, isDir: false, size: onDisk(await fsp.lstat(fp)) }; } catch { return { name: e.name, size: null }; }
  }));
  children.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  return { total: ents.length, children: children.slice(0, 8) };
}

// Treemap data: the folder's entries plus, for the biggest folders, their own biggest entries.
async function tree(dir) {
  const entry = async (fp, e) => {
    if (e.isSymbolicLink() || keep.has(scanner.key(fp))) return null;
    if (e.isDirectory()) { const s = scanner.get(fp); return { name: e.name, path: fp, isDir: true, size: s ? s.size : null }; }
    try { return { name: e.name, path: fp, isDir: false, size: onDisk(await fsp.lstat(fp)) }; } catch { return null; }
  };
  const ents = await fsp.readdir(dir, { withFileTypes: true });
  const kids = (await Promise.all(ents.slice(0, 3000).map(e => entry(path.join(dir, e.name), e)))).filter(Boolean);
  kids.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  const top = kids.slice(0, 80);
  await Promise.all(top.filter(k => k.isDir && k.size > 0).slice(0, 30).map(async k => {
    let sub = []; try { sub = await fsp.readdir(k.path, { withFileTypes: true }); } catch { return; }
    const list = (await Promise.all(sub.slice(0, 400).map(e => entry(path.join(k.path, e.name), e))))
      .filter(c => c && c.size > 0).sort((a, b) => b.size - a.size);
    k.children = list.slice(0, 30).map(({ name, isDir, size }) => ({ name, isDir, size }));
    const shown = k.children.reduce((s, c) => s + c.size, 0);
    if (k.size - shown > 0) k.children.push({ name: '…', other: true, size: k.size - shown });
  }));
  const rest = kids.slice(80).reduce((s, k) => s + (k.size || 0), 0);
  if (rest > 0) top.push({ name: '…', other: true, size: rest });
  return { path: dir, items: top };
}

function fmt(b) { if (b == null) return '?'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; }

async function askAbout(p, lang) {
  let st; try { st = await fsp.lstat(p); } catch { return { error: 'notfound' }; }
  const isDir = st.isDirectory();
  const d = describe(p, isDir, st);
  const lines = [`Path: ${p}`, `Type: ${isDir ? 'folder' : 'file'}`, `Size: ${fmt(d.size)}${isDir && d.files != null ? `, ${d.files} files` : ''}`,
    `Last modified: ${new Date(st.mtimeMs).toISOString().slice(0, 10)}`];
  if (d.level !== 'ok') lines.push(`Safety rule in this app: ${d.level} (${d.reason})`);
  if (d.junk) lines.push(`Matched junk rule: ${d.junk}`);
  if (isDir) { const pk = await peek(p); lines.push(`Contents (${pk.total} entries, largest first):`, ...pk.children.map(c => `  - ${c.name}${c.isDir ? '/' : ''} (${fmt(c.size)})`)); }
  return ai.ask(lines.join('\n'), lang);
}

// ---------- delete ----------
async function runSpecial(items, results) {
  let freed = 0;
  for (const it of items) {
    const before = programs.freeOn(it.drive || (process.env.SystemDrive || 'C:') + '\\');
    let r;
    if (it.kind === 'uninstall') {
      const known = (await programs.programs()).find(p => 'prog:' + p.id === it.path);
      r = known ? await programs.uninstall(known.id) : { ok: false, error: 'unknown program' };
      if (known?.location) { scanner.invalidate(known.location); it.drive = known.location; }
    } else r = await programs.runExtra(String(it.path).replace(/^extra:/, ''));
    const got = Math.max(0, programs.freeOn(it.drive || (process.env.SystemDrive || 'C:') + '\\') - before);
    freed += got;
    results.push({ path: it.path, ok: r.ok, size: got, permanent: true, error: r.ok ? null : r.error, opened: r.opened });
  }
  return freed;
}

async function remove(items) {
  const results = [];
  const special = items.filter(i => i.kind === 'uninstall' || i.kind === 'extra');
  items = items.filter(i => !special.includes(i));
  const specialFreed = await runSpecial(special, results);
  const toTrash = [], toRm = [];
  const plan = new Map(); // child path -> parent item (for "empty folder" jobs)
  for (const it of items) {
    if (typeof it.path !== 'string') continue;
    // "empty this folder" is only allowed for junk-radar folders; anything else must pass the lock check itself
    if (it.contents && !junk.match(it.path)?.contents) { results.push({ path: it.path, ok: false, error: 'locked' }); continue; }
    if (!it.contents && classify(it.path, ctx()).level === 'locked') { results.push({ path: it.path, ok: false, error: 'locked' }); continue; }
    let targets = [it.path];
    if (it.contents) {
      try { targets = (await fsp.readdir(it.path)).map(n => path.join(it.path, n)); } catch (e) { results.push({ path: it.path, ok: false, error: e.code }); continue; }
      targets = targets.filter(t => classify(t, ctx()).level !== 'locked');
    }
    const size = it.contents ? (await scanner.request(it.path, true)).size : (scanner.get(it.path)?.size ?? await sizeOf(it.path));
    const job = { path: it.path, permanent: !!it.permanent, contents: !!it.contents, size, total: targets.length, done: 0, errors: [] };
    for (const t of targets) { plan.set(t, job); (it.permanent ? toRm : toTrash).push(t); }
    if (!targets.length) results.push({ path: it.path, ok: true, size: 0, permanent: job.permanent });
    else results.push(job);
  }
  const outs = [...await platform.trash(toTrash), ...await platform.removePermanently(toRm)];
  for (const o of outs) {
    const job = plan.get(o.path);
    if (!job) continue;
    if (o.ok) job.done++; else job.errors.push(o.error);
  }
  let freed = specialFreed, trashed = 0, n = results.filter(r => r.ok).length;
  const final = results.map(r => {
    if (!('total' in r)) return r;
    scanner.invalidate(r.path);
    if (r.done > 0) finds.drop(r.path);
    const ok = r.done > 0;
    // partial success for "empty folder" jobs: estimate by share of entries removed
    const got = r.done === r.total ? r.size : Math.round((r.size || 0) * r.done / Math.max(1, r.total));
    if (ok) { n++; r.permanent ? (freed += got) : (trashed += got); }
    return { path: r.path, ok, size: got, permanent: r.permanent, partial: ok && r.done < r.total ? `${r.done}/${r.total}` : null, error: ok ? null : (r.errors[0] || 'failed') };
  });
  if (n) {
    stats.freed += freed; stats.trashed += trashed; stats.items += n;
    stats.sessions.push({ at: new Date().toISOString(), freed, trashed, items: n });
    stats.sessions = stats.sessions.slice(-200);
    saveStats();
  }
  drivesCache = platform.drives();
  suggest.invalidate();
  return { results: final, freed, trashed, stats };
}

async function sizeOf(p) {
  try { const st = await fsp.lstat(p); return st.isDirectory() ? (await scanner.request(p, true)).size : onDisk(st); } catch { return 0; }
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch { r({}); } }); });

function publicState() {
  const { apiKey, ...rest } = settings;
  return { version: pkg.version, platform: platform.PLATFORM, cpus: config.CPUS, settings: { ...rest, hasApiKey: !!apiKey }, stats, dataDir: config.DIR };
}

function start({ port = 4747, open = true, threads } = {}) {
  if (threads) settings.threads = threads;
  scanner.setThreads(settings.threads);
  platform.refreshRunning();
  platform.refreshKinds().then(() => { drivesCache = platform.drives(); });
  setInterval(() => platform.refreshRunning(), 60000).unref();
  if (settings.prescan) for (const d of drivesCache) scanner.request(d.path, false);

  const handler = async (req, res) => {
    const host = req.headers.host || '';
    if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) return send(res, 403, { error: 'host' }); // DNS rebinding
    const url = new URL(req.url, `http://${host}`);
    const q = url.searchParams.get('path');
    try {
      if (!url.pathname.startsWith('/api/')) {
        const f = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const body = bundle.publicFile(f);
        if (!body) return send(res, 404, 'not found', 'text/plain');
        return send(res, 200, body, MIME[path.extname(f)] || 'application/octet-stream');
      }
      if (url.pathname === '/api/raw') { // image preview; <img> can't send custom headers
        if (!q || !IMG.has(path.extname(q).toLowerCase())) return send(res, 404, {});
        res.writeHead(200, { 'Cache-Control': 'max-age=600' });
        return fs.createReadStream(q).on('error', () => res.end()).pipe(res);
      }
      // Custom header can't be sent cross-origin without a CORS preflight we never answer -> other websites can't call us.
      if (req.headers['x-wegwisch'] !== '1') return send(res, 403, { error: 'header' });

      switch (url.pathname) {
        case '/api/state': return send(res, 200, { ...publicState(), ai: await ai.status(), provider: await ai.provider() });
        case '/api/settings': {
          const b = await readBody(req);
          for (const k of config.SETTING_KEYS) if (k in b && k !== 'apiKey') settings[k] = b[k];
          if (typeof b.apiKey === 'string') settings.apiKey = b.apiKey.trim();
          settings.threads = Math.max(1, Math.min(64, parseInt(settings.threads) || 4));
          config.saveSettings();
          scanner.setThreads(settings.threads);
          if (b.prescan) for (const d of drivesCache) scanner.request(d.path, false);
          return send(res, 200, { ...publicState(), ai: await ai.status(true), provider: await ai.provider() });
        }
        case '/api/drives': drivesCache = platform.drives(); scanner.setRoots(drivesCache.map(d => d.path)); return send(res, 200, withScan(drivesCache));
        case '/api/scan-drive': { const b = await readBody(req); if (drivesCache.some(d => d.path === b.path)) scanner.request(b.path, false); return send(res, 200, { ok: true }); }
        case '/api/bin': return send(res, 200, await bin.info());
        case '/api/bin/empty': {
          const r = await bin.empty();
          if (r.freed) { stats.freed += r.freed; stats.emptied = (stats.emptied || 0) + r.freed; stats.trashed = Math.max(0, (stats.trashed || 0) - r.freed); saveStats(); }
          drivesCache = platform.drives();
          return send(res, 200, { ...r, stats });
        }
        case '/api/list': return send(res, 200, { ...await listDir(q), scan: scanner.progress() });
        case '/api/scan': return send(res, 200, scanner.progress());
        case '/api/peek': return send(res, 200, await peek(q));
        case '/api/tree': return send(res, 200, await tree(q));
        case '/api/smart': {
          const kind = url.searchParams.get('kind');
          if (!['bigold', 'growth', 'dupes', 'programs', 'extras', 'suggest'].includes(kind)) return send(res, 400, { error: 'kind' });
          return send(res, 200, { ...await smartDeck(kind), scan: scanner.progress(), history: finds.hasHistory() });
        }
        case '/api/junk': {
          scanner.setFocus(null);
          const items = [];
          for (const j of junk.all()) {
            if (keep.has(scanner.key(j.path))) continue;
            let st; try { st = await fsp.lstat(j.path); } catch { continue; }
            const it = describe(j.path, st.isDirectory(), st);
            if (j.size != null && !st.isDirectory()) it.size = j.size;
            if (it.isDir && it.size == null) scanner.request(j.path, true);
            items.push({ ...it, junk: j.kind, contents: j.contents, cache: j.cache });
          }
          return send(res, 200, { items, waiting: items.filter(i => i.size == null).length, scan: scanner.progress() });
        }
        case '/api/ask': { const b = await readBody(req); return send(res, 200, await askAbout(b.path, b.lang)); }
        case '/api/keep': {
          const b = await readBody(req);
          const k = /^(prog|dupe|extra):/.test(b.path) ? b.path : scanner.key(b.path);
          if (b.undo) keep.delete(k); else keep.add(k);
          saveKeep();
          return send(res, 200, { ok: true });
        }
        case '/api/delete': {
          const b = await readBody(req);
          const r = await remove(b.items || []);
          if (b.seconds > 0 && b.seconds < 86400) { stats.seconds = (stats.seconds || 0) + Math.round(b.seconds); saveStats(); }
          return send(res, 200, r);
        }
        case '/api/reveal': { const b = await readBody(req); platform.reveal(b.path); return send(res, 200, { ok: true }); }
      }
      send(res, 404, {});
    } catch (e) { send(res, 500, { error: e.code || e.message }); }
  };

  // Listen on IPv4 *and* IPv6 loopback: browsers resolve "localhost" to ::1 first,
  // and if nothing answers there every request pays a ~200 ms fallback to 127.0.0.1.
  const server = http.createServer(handler);
  const server6 = http.createServer(handler);
  server6.on('error', () => {}); // no IPv6 on this machine – fine
  server6.listen(port, '::1');
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') { console.log(`Wegwisch already seems to run on port ${port} – opening it.`); if (open) platform.openBrowser(`http://localhost:${port}`); process.exit(0); }
    throw e;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Wegwisch ${pkg.version} running at http://localhost:${port}  (Ctrl+C to quit)`);
    console.log(`Settings & keep-list: ${config.DIR}`);
    if (open) platform.openBrowser(`http://localhost:${port}`);
  });
  return server;
}

module.exports = { start };
