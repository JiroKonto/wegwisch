// Everything OS-specific: drives, running programs, cloud folders, trash, "show in file manager".
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const PLATFORM = process.platform;
const HOME = os.homedir();
const SYSTEM_DRIVE = PLATFORM === 'win32' ? (process.env.SystemDrive || 'C:') : null;

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 60000, encoding: 'utf8' },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' }));
  });
}

function statfs(p) {
  try { const s = fs.statfsSync(p); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; }
}

// ---------- drives ----------
const LINUX_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'ntfs', 'ntfs3', 'fuseblk', 'vfat', 'exfat', 'jfs', 'reiserfs', 'bcachefs']);

function drives() {
  const out = [];
  if (PLATFORM === 'win32') {
    for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${L}:\\`;
      const s = statfs(root);
      if (!s || !s.total) continue;
      out.push({ path: root, label: `${L}:`, ...s, ...kindOf(root), system: `${L}:`.toLowerCase() === SYSTEM_DRIVE.toLowerCase(), oldSystem: oldSystems().includes(`${L}:`) });
    }
  } else if (PLATFORM === 'darwin') {
    const root = statfs('/');
    if (root) out.push({ path: '/', label: 'Macintosh HD', ...root, ...kindOf('/'), system: true });
    let vols = [];
    try { vols = fs.readdirSync('/Volumes'); } catch {}
    for (const v of vols) {
      const p = '/Volumes/' + v;
      try { if (fs.realpathSync(p) === '/') continue; } catch { continue; }
      const s = statfs(p);
      if (s && s.total) out.push({ path: p, label: v, ...s, ...kindOf(p) });
    }
  } else {
    let mounts = '';
    try { mounts = fs.readFileSync('/proc/mounts', 'utf8'); } catch {}
    const seen = new Set();
    for (const line of mounts.split('\n')) {
      const [dev, mnt, type] = line.split(' ');
      if (!mnt || !LINUX_FS.has(type)) continue;
      const m = mnt.replace(/\\040/g, ' ');
      if (m.startsWith('/snap') || m.startsWith('/boot') || seen.has(dev)) continue;
      seen.add(dev);
      const s = statfs(m);
      if (s && s.total) out.push({ path: m, label: m === '/' ? 'System' : path.basename(m), ...s, ...kindOf(m), system: m === '/' });
    }
  }
  return out;
}

// ---------- drive kind (nvme | ssd | hdd | usb | disk) for the icons ----------
let kinds = {}; // drive path -> {kind, model}
async function refreshKinds() {
  const out = {};
  if (PLATFORM === 'win32') {
    const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-Partition | Where-Object DriveLetter | ForEach-Object {
  $d = Get-Disk -Number $_.DiskNumber; $p = Get-PhysicalDisk | Where-Object DeviceId -eq "$($_.DiskNumber)"
  "$($_.DriveLetter)|$($d.BusType)|$($p.MediaType)|$($d.FriendlyName)" }`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    for (const l of r.stdout.split(/\r?\n/)) {
      const [L, bus, media, model] = l.trim().split('|');
      if (!L || L.length !== 1) continue;
      const kind = /usb/i.test(bus) ? 'usb' : /nvme/i.test(bus) ? 'nvme' : /ssd/i.test(media) ? 'ssd' : /hdd/i.test(media) ? 'hdd' : 'disk';
      out[`${L}:\\`] = { kind, model: (model || '').trim() };
    }
  } else if (PLATFORM === 'linux') {
    const r = await run('lsblk', ['-J', '-o', 'MOUNTPOINT,ROTA,TRAN,MODEL']);
    try {
      const walk = (devs, parent) => devs.forEach(d => {
        const info = { rota: d.rota ?? parent?.rota, tran: d.tran || parent?.tran, model: d.model || parent?.model };
        if (d.mountpoint) out[d.mountpoint] = { kind: info.tran === 'usb' ? 'usb' : info.tran === 'nvme' ? 'nvme' : (info.rota === true || info.rota === '1') ? 'hdd' : 'ssd', model: (info.model || '').trim() };
        if (d.children) walk(d.children, info);
      });
      walk(JSON.parse(r.stdout).blockdevices || []);
    } catch {}
  } else if (PLATFORM === 'darwin') {
    for (const d of drives()) {
      const r = await run('diskutil', ['info', d.path]);
      const ssd = /Solid State:\s+Yes/i.test(r.stdout), internal = /Device Location:\s+Internal/i.test(r.stdout) || /Internal:\s+Yes/i.test(r.stdout);
      out[d.path] = { kind: !internal ? 'usb' : ssd ? (/NVMe|PCI/i.test(r.stdout) ? 'nvme' : 'ssd') : 'hdd', model: (/Device \/ Media Name:\s+(.+)/.exec(r.stdout) || [])[1] || '' };
    }
  }
  kinds = out;
}
const kindOf = p => kinds[p] || { kind: 'disk', model: '' };

// Windows: a second drive with its own \Windows\System32 is a leftover install.
let oldCache = null;
function oldSystems() {
  if (PLATFORM !== 'win32') return [];
  if (oldCache) return oldCache;
  oldCache = [];
  for (const L of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const d = `${L}:`;
    if (d.toLowerCase() === SYSTEM_DRIVE.toLowerCase()) continue;
    try { if (fs.existsSync(`${d}\\Windows\\System32\\config`)) oldCache.push(d); } catch {}
  }
  return oldCache;
}

// ---------- cloud-synced folders (deleting there deletes in the cloud) ----------
function cloudDirs() {
  const dirs = [];
  if (PLATFORM === 'win32') {
    for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (process.env[k]) dirs.push(process.env[k]);
    try {
      for (const n of fs.readdirSync(HOME)) if (/^(OneDrive|Dropbox|Google Drive|iCloudDrive|Creative Cloud Files|MEGA|pCloud)/i.test(n)) dirs.push(path.join(HOME, n));
    } catch {}
  } else {
    try {
      for (const n of fs.readdirSync(HOME)) if (/^(Dropbox|Google Drive|OneDrive|MEGA|pCloudDrive|Nextcloud|ownCloud)/i.test(n)) dirs.push(path.join(HOME, n));
    } catch {}
  }
  return [...new Set(dirs)];
}

// ---------- running programs (their folders get locked) ----------
let running = [];
async function refreshRunning() {
  const set = new Set();
  if (PLATFORM === 'win32') {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath }']);
    for (const l of r.stdout.split(/\r?\n/)) if (l.trim()) set.add(l.trim());
  } else if (PLATFORM === 'darwin') {
    const r = await run('ps', ['-axo', 'comm=']);
    for (const l of r.stdout.split('\n')) if (l.startsWith('/')) set.add(l.trim());
  } else {
    let pids = [];
    try { pids = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)); } catch {}
    for (const pid of pids) { try { set.add(fs.readlinkSync(`/proc/${pid}/exe`)); } catch {} }
  }
  // Ignore the OS core and ourselves; those are locked by other rules anyway.
  running = [...set].filter(p => !/^[a-z]:\\windows\\/i.test(p) && !p.startsWith('/System/') && !p.startsWith('/usr/') && p !== process.execPath);
}
function runningExecutables() { return running; }

// ---------- trash ----------
async function trash(paths) {
  if (!paths.length) return [];
  if (PLATFORM === 'win32') return trashWindows(paths);
  if (PLATFORM === 'darwin') return trashMac(paths);
  return trashLinux(paths);
}

async function trashWindows(paths) {
  const tmp = path.join(os.tmpdir(), `wegwisch-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify(paths), 'utf8');
  const ps = `
Add-Type -AssemblyName Microsoft.VisualBasic
$list = Get-Content -LiteralPath $args[0] -Raw -Encoding UTF8 | ConvertFrom-Json
$res = foreach($p in @($list)){
  try {
    if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') }
    elseif (Test-Path -LiteralPath $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }
    else { throw 'not found' }
    [pscustomobject]@{path=$p; ok=$true}
  } catch { [pscustomobject]@{path=$p; ok=$false; error=$_.Exception.Message} }
}
[Console]::OutputEncoding=[Text.Encoding]::UTF8
ConvertTo-Json -InputObject @($res) -Compress`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& {${ps}} '${tmp.replace(/'/g, "''")}'`], { timeout: 6 * 3600 * 1000 });
  fs.rm(tmp, () => {});
  try { return JSON.parse(r.stdout); } catch { return paths.map(p => ({ path: p, ok: false, error: 'PowerShell: ' + (r.stderr || 'no output').slice(0, 200) })); }
}

async function trashMac(paths) {
  const script = ['on run argv', 'set out to ""', 'repeat with p in argv', 'try',
    'tell application "Finder" to delete (POSIX file (p as text) as alias)', 'set out to out & "OK" & linefeed',
    'on error e', 'set out to out & "ERR " & e & linefeed', 'end try', 'end repeat', 'return out', 'end run'];
  const args = script.flatMap(l => ['-e', l]).concat(paths);
  const r = await run('osascript', args, { timeout: 6 * 3600 * 1000 });
  const lines = r.stdout.split('\n').filter(Boolean);
  return paths.map((p, i) => {
    const l = lines[i] || 'ERR ' + (r.stderr || 'osascript failed');
    return l === 'OK' ? { path: p, ok: true } : { path: p, ok: false, error: l.slice(4) };
  });
}

async function trashLinux(paths) {
  const hasGio = (await run('sh', ['-c', 'command -v gio'])).ok;
  const out = [];
  for (const p of paths) {
    let gioErr = null;
    if (hasGio) {
      const r = await run('gio', ['trash', '--', p], { timeout: 6 * 3600 * 1000 });
      if (r.ok) { out.push({ path: p, ok: true }); continue; }
      gioErr = r.stderr.trim() || 'gio trash failed';
    }
    // fallback: freedesktop.org trash spec, home trash only (same filesystem)
    try {
      const base = path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'Trash');
      await fsp.mkdir(path.join(base, 'files'), { recursive: true });
      await fsp.mkdir(path.join(base, 'info'), { recursive: true });
      let name = path.basename(p), n = 1;
      while (fs.existsSync(path.join(base, 'files', name))) name = `${path.basename(p)}.${n++}`;
      await fsp.writeFile(path.join(base, 'info', name + '.trashinfo'),
        `[Trash Info]\nPath=${encodeURI(p)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`);
      await fsp.rename(p, path.join(base, 'files', name));
      out.push({ path: p, ok: true });
    } catch (e) {
      out.push({ path: p, ok: false, error: gioErr || (e.code === 'EXDEV' ? 'other drive – install gio to trash it' : e.message) });
    }
  }
  return out;
}

async function removePermanently(paths) {
  const out = [];
  for (const p of paths) {
    try { await fsp.rm(p, { recursive: true, force: false, maxRetries: 2 }); out.push({ path: p, ok: true }); }
    catch (e) { out.push({ path: p, ok: false, error: e.code === 'EBUSY' || e.code === 'EPERM' ? 'in use or no permission' : e.message }); }
  }
  return out;
}

function reveal(p) {
  if (PLATFORM === 'win32') spawn('explorer.exe', ['/select,', p], { detached: true, stdio: 'ignore' }).unref();
  else if (PLATFORM === 'darwin') spawn('open', ['-R', p], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [path.dirname(p)], { detached: true, stdio: 'ignore' }).unref();
}

function openBrowser(url) {
  if (PLATFORM === 'win32') spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  else spawn(PLATFORM === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { PLATFORM, HOME, SYSTEM_DRIVE, run, drives, refreshKinds, oldSystems, cloudDirs, refreshRunning, runningExecutables, trash, removePermanently, reveal, openBrowser };
