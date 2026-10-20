// Junk radar: well-known caches plus things discovered while scanning
// (node_modules, Unity Library, Unreal caches, Steam shader caches, archives next to their unpacked folder, old installers).
const fs = require('fs');
const path = require('path');
const os = require('os');
const scanner = require('./scanner');

const HOME = os.homedir();
const E = process.env;
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

// kind -> how to delete. contents=true empties the folder but keeps it (apps expect it to exist).
const KINDS = {
  temp:          { contents: true,  cache: true },
  cache:         { contents: true,  cache: true },
  shadercache:   { contents: true,  cache: true },
  browser:       { contents: true,  cache: true },
  devcache:      { contents: true,  cache: true },
  crash:         { contents: true,  cache: true },
  update:        { contents: true,  cache: true },
  oldwin:        { contents: false, cache: false },
  node_modules:  { contents: false, cache: true },
  unity_library: { contents: false, cache: true },
  unreal_cache:  { contents: false, cache: true },
  archive_dup:   { contents: false, cache: false },
  installer:     { contents: false, cache: false },
};

function known() {
  const L = [];
  const add = (kind, ...p) => { if (p.every(Boolean)) L.push({ kind, path: path.join(...p) }); };
  if (WIN) {
    const la = E.LOCALAPPDATA, ra = E.APPDATA, win = E.WINDIR || 'C:\\Windows', pd = E.ProgramData || 'C:\\ProgramData', sd = (E.SystemDrive || 'C:') + '\\';
    add('temp', la, 'Temp'); add('temp', win, 'Temp');
    add('shadercache', la, 'NVIDIA', 'DXCache'); add('shadercache', la, 'NVIDIA', 'GLCache'); add('shadercache', la, 'D3DSCache');
    add('shadercache', la, 'AMD', 'DxCache'); add('shadercache', la, 'AMD', 'DxcCache'); add('shadercache', la, 'AMD', 'GLCache');
    add('crash', la, 'CrashDumps'); add('crash', pd, 'Microsoft', 'Windows', 'WER', 'ReportArchive');
    add('update', win, 'SoftwareDistribution', 'Download'); add('update', pd, 'NVIDIA Corporation', 'Downloader');
    add('oldwin', sd, 'Windows.old'); add('oldwin', sd, '$WINDOWS.~BT');
    for (const b of [['Google', 'Chrome'], ['Microsoft', 'Edge'], ['BraveSoftware', 'Brave-Browser'], ['Vivaldi']]) {
      const ud = path.join(la || '', ...b, 'User Data');
      for (const prof of listDirs(ud).filter(n => n === 'Default' || /^Profile \d+$/.test(n)))
        for (const c of ['Cache', 'Code Cache', 'GPUCache']) add('browser', ud, prof, c);
    }
    for (const c of ['Cache', 'Code Cache', 'GPUCache']) add('browser', ra, 'discord', c);
    for (const c of ['Cache', 'CachedData', 'CachedExtensionVSIXs']) add('devcache', ra, 'Code', c);
    add('devcache', la, 'npm-cache'); add('devcache', la, 'pip', 'Cache'); add('devcache', la, 'Yarn', 'Cache');
    add('devcache', la, 'uv', 'cache'); add('devcache', la, 'Unity', 'cache'); add('devcache', HOME, '.gradle', 'caches');
    add('shadercache', E['ProgramFiles(x86)'], 'Steam', 'steamapps', 'shadercache');
  } else if (MAC) {
    add('cache', HOME, 'Library', 'Caches'); add('crash', HOME, 'Library', 'Logs');
    add('devcache', HOME, 'Library', 'Developer', 'Xcode', 'DerivedData');
    add('devcache', HOME, 'Library', 'Developer', 'CoreSimulator', 'Caches');
    add('devcache', HOME, '.npm', '_cacache'); add('devcache', HOME, '.gradle', 'caches');
    add('shadercache', HOME, 'Library', 'Application Support', 'Steam', 'steamapps', 'shadercache');
  } else {
    add('cache', HOME, '.cache'); add('devcache', HOME, '.npm', '_cacache'); add('devcache', HOME, '.gradle', 'caches');
    add('shadercache', HOME, '.local', 'share', 'Steam', 'steamapps', 'shadercache');
    add('shadercache', HOME, '.steam', 'steam', 'steamapps', 'shadercache');
  }
  return L.filter(j => exists(j.path));
}

function listDirs(d) { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

// ---------- discovered while scanning ----------
const found = new Map(); // key -> {kind, path, size?}
scanner.events.on('dir', (dir, r) => {
  const names = r.dirs;
  const has = n => names.some(x => x.toLowerCase() === n.toLowerCase());
  const pick = n => names.find(x => x.toLowerCase() === n.toLowerCase());
  const base = path.basename(dir).toLowerCase();
  // node_modules: only the outermost one, not nested ones inside another node_modules
  if (has('node_modules') && !dir.toLowerCase().includes('node_modules')) addFound('node_modules', path.join(dir, pick('node_modules')));
  if (has('Assets') && has('ProjectSettings') && has('Library')) addFound('unity_library', path.join(dir, pick('Library')));
  if (r.uproject) for (const n of ['Intermediate', 'DerivedDataCache']) if (has(n)) addFound('unreal_cache', path.join(dir, pick(n)));
  if (base === 'steamapps' && has('shadercache')) addFound('shadercache', path.join(dir, pick('shadercache')));
  for (const [name, size] of r.dupArchives) addFound('archive_dup', path.join(dir, name), size);
});
function addFound(kind, p, size) { found.set(scanner.key(p), { kind, path: p, size }); }

// ---------- installers in Downloads older than 14 days ----------
const INSTALLER = /\.(exe|msi|msix|dmg|pkg|iso|appimage|deb|rpm)$/i;
function installers() {
  const dl = path.join(HOME, 'Downloads');
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dl, { withFileTypes: true }); } catch {}
  for (const e of ents) {
    if (!e.isFile() || !INSTALLER.test(e.name)) continue;
    try {
      const st = fs.statSync(path.join(dl, e.name));
      if (Date.now() - st.mtimeMs > 14 * 864e5 && st.size > 20 * 1024 * 1024) out.push({ kind: 'installer', path: path.join(dl, e.name), size: st.size });
    } catch {}
  }
  return out;
}

function all() {
  const map = new Map();
  for (const j of [...known(), ...found.values(), ...installers()]) map.set(scanner.key(j.path), j);
  return [...map.values()].map(j => ({ ...j, ...KINDS[j.kind] }));
}

// For badges on normal cards. Cheap: known() is only rebuilt every 30s.
let knownCache = null, knownAt = 0;
function match(p) {
  if (Date.now() - knownAt > 30000) { knownCache = new Map(known().map(j => [scanner.key(j.path), j])); knownAt = Date.now(); }
  const k = scanner.key(p);
  const j = knownCache.get(k) || found.get(k);
  return j ? { kind: j.kind, ...KINDS[j.kind] } : null;
}

module.exports = { all, match, KINDS };
