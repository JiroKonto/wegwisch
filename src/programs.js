// Installed programs (uninstall them properly instead of deleting folders) and Windows clean-up extras.
// Only commands we read ourselves (registry) or define here are ever run – never anything sent by the page.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PLATFORM, run, drives } = require('./platform');
const scanner = require('./scanner');

// ---------- installed programs ----------
let progCache = null, progAt = 0;
async function programs() {
  if (progCache && Date.now() - progAt < 60000) return progCache;
  let list = [];
  if (PLATFORM === 'win32') {
    const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
$k='HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$r = Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName -and $_.UninstallString -and $_.ReleaseType -notmatch 'Update|Hotfix' } |
  ForEach-Object { [pscustomobject]@{ id=$_.PSPath; name=$_.DisplayName; version=$_.DisplayVersion; publisher=$_.Publisher; date=$_.InstallDate; loc=$_.InstallLocation; est=$_.EstimatedSize; icon=$_.DisplayIcon } }
ConvertTo-Json -InputObject @($r) -Compress -Depth 2`;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    let raw = []; try { raw = JSON.parse(r.stdout || '[]'); } catch {}
    const seen = new Set();
    for (const p of raw) {
      const name = String(p.name || '').trim(); if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
      let loc = String(p.loc || '').trim().replace(/^"|"$/g, '').replace(/\\$/, '');
      if (!loc && p.icon) { const exe = String(p.icon).split(',')[0].replace(/^"|"$/g, ''); if (/\.exe$/i.test(exe)) loc = path.dirname(exe); }
      if (loc && (!fs.existsSync(loc) || /^[a-z]:\\?$/i.test(loc) || /\\windows(\\|$)/i.test(loc))) loc = '';
      let size = loc ? scanner.get(loc)?.size ?? null : null;
      if (loc && size == null) scanner.request(loc, false);
      if (size == null && p.est) size = Number(p.est) * 1024;
      const d = /^(\d{4})(\d{2})(\d{2})$/.exec(String(p.date || ''));
      list.push({ id: p.id, name, version: p.version || '', publisher: p.publisher || '', installed: d ? Date.UTC(+d[1], d[2] - 1, +d[3]) : null, location: loc, size });
    }
  } else if (PLATFORM === 'darwin') {
    for (const dir of ['/Applications', path.join(require('os').homedir(), 'Applications')]) {
      let names = []; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.app')); } catch {}
      for (const n of names) {
        const p = path.join(dir, n);
        const size = scanner.get(p)?.size ?? null; if (size == null) scanner.request(p, false);
        list.push({ id: p, name: n.replace(/\.app$/, ''), location: p, size, mac: true });
      }
    }
  }
  progCache = list.sort((a, b) => (b.size ?? -1) - (a.size ?? -1)); progAt = Date.now();
  return progCache;
}

// Runs the program's own uninstaller (Windows) and waits for it. The uninstall string comes from the registry, not the client.
async function uninstall(id) {
  if (PLATFORM !== 'win32') return { ok: false, error: 'not supported' };
  const ps = `$p = Get-ItemProperty -LiteralPath $args[0] -ErrorAction Stop; if ($p.QuietUninstallString) { $p.UninstallString } else { $p.UninstallString }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& {${ps}} '${String(id).replace(/'/g, "''")}'`]);
  const cmd = r.stdout.trim();
  if (!r.ok || !cmd) return { ok: false, error: 'uninstaller not found' };
  return new Promise(resolve => {
    // MsiExec /I{guid} would *repair*; /X uninstalls
    const fixed = cmd.replace(/msiexec(\.exe)?\s+\/I\s*\{/i, 'MsiExec.exe /X{');
    const child = spawn(fixed, { shell: true, windowsHide: false, detached: false });
    const tm = setTimeout(() => resolve({ ok: true, note: 'still running' }), 30 * 60 * 1000);
    child.on('exit', code => { clearTimeout(tm); progCache = null; resolve(code === 0 || code === 3010 ? { ok: true } : { ok: false, error: `uninstaller exited with ${code}` }); });
    child.on('error', e => { clearTimeout(tm); resolve({ ok: false, error: e.message }); });
  });
}

// ---------- Windows extras ----------
// hiberfil.sys & co. can't be opened or stat'ed, but a directory listing still reports their size
async function systemFileSize(dir, name) {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-ChildItem -LiteralPath '${dir}' -Force -Filter '${name}' -ErrorAction SilentlyContinue).Length`]);
  const n = Number(r.stdout.trim());
  return n > 0 ? n : null;
}
async function extras() {
  if (PLATFORM !== 'win32') return [];
  const sd = (process.env.SystemDrive || 'C:') + '\\';
  const out = [];
  const hib = await systemFileSize(sd, 'hiberfil.sys');
  if (hib) out.push({ id: 'hibernate', size: hib, admin: true });
  const old = sd + 'Windows.old';
  if (fs.existsSync(old)) { const s = scanner.get(old); if (!s) scanner.request(old, false); out.push({ id: 'windowsold', size: s?.size ?? null, admin: false, opens: true }); }
  out.push({ id: 'winsxs', size: null, admin: true, slow: true });
  out.push({ id: 'delivery', size: null, admin: true });
  out.push({ id: 'restore', size: null, admin: false, opens: true });
  out.push({ id: 'storagesense', size: null, admin: false, opens: true });
  return out;
}

// Fixed commands only. Elevated ones go through UAC (the user sees Windows' own prompt).
const ACTIONS = {
  hibernate: { exe: 'powercfg.exe', args: '/h off', elevate: true },
  winsxs: { exe: 'Dism.exe', args: '/Online /Cleanup-Image /StartComponentCleanup', elevate: true },
  delivery: { exe: 'powershell.exe', args: '-NoProfile -Command Delete-DeliveryOptimizationCache -Force', elevate: true },
  windowsold: { open: 'ms-settings:storagepolicies' },
  restore: { open: 'SystemPropertiesProtection.exe' },
  storagesense: { open: 'ms-settings:storagesense' },
};
async function runExtra(id) {
  const a = ACTIONS[id];
  if (!a || PLATFORM !== 'win32') return { ok: false, error: 'unknown action' };
  if (a.open) { spawn('cmd', ['/c', 'start', '', a.open], { windowsHide: true, detached: true, stdio: 'ignore' }).unref(); return { ok: true, opened: true }; }
  const ps = `try { $p = Start-Process -FilePath '${a.exe}' -ArgumentList '${a.args}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } catch { exit 1223 }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 60 * 60 * 1000 });
  if (r.code === 1223) return { ok: false, error: 'admin rights declined' };
  return r.ok ? { ok: true } : { ok: false, error: `exit ${r.code}` };
}

const freeOn = p => { const d = drives().find(x => p.toLowerCase().startsWith(x.path.toLowerCase())); return d ? d.free : 0; };

module.exports = { programs, uninstall, extras, runExtra, freeOn };
