// The Recycle Bin / Trash: how much is in it, and emptying it (trashed files only free space once it's emptied).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PLATFORM, HOME, run } = require('./platform');

const WIN_BIN = `
$code = @'
using System; using System.Runtime.InteropServices;
public static class WwBin {
  [StructLayout(LayoutKind.Sequential)] public struct Q { public int cbSize; public long size; public long items; }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SHQueryRecycleBin(string root, ref Q q);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SHEmptyRecycleBin(IntPtr h, string root, uint flags);
}
'@
Add-Type -TypeDefinition $code
$q = New-Object WwBin+Q; $q.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($q)
`;

const unixTrash = () => PLATFORM === 'darwin' ? path.join(HOME, '.Trash')
  : path.join(process.env.XDG_DATA_HOME || path.join(HOME, '.local', 'share'), 'Trash', 'files');

// on-disk size of a folder tree (own walk, so the scanner's cached drive totals stay intact)
const onDisk = st => typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
async function treeSize(p) {
  let st; try { st = await fs.promises.lstat(p); } catch { return 0; }
  if (!st.isDirectory()) return onDisk(st);
  let names = []; try { names = await fs.promises.readdir(p); } catch { return 0; }
  let sum = 0;
  for (let i = 0; i < names.length; i += 64) sum += (await Promise.all(names.slice(i, i + 64).map(n => treeSize(path.join(p, n))))).reduce((a, b) => a + b, 0);
  return sum;
}

// Windows: each user's deleted files live in X:\$Recycle.Bin\<their SID>; $R… entries are the items
let sid = null;
async function userSid() {
  if (sid !== null) return sid;
  // full path: a different "whoami" (Git Bash, Cygwin) may come first on PATH
  const r = await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  sid = (/"(S-1-[\d-]+)"/.exec(r.stdout) || [])[1] || '';
  return sid;
}

let cache = null, cacheAt = 0, inflight = null;
async function measure() {
  if (PLATFORM === 'win32') {
    const id = await userSid();
    let size = 0, items = 0;
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const dir = path.join(`${L}:\\`, '$Recycle.Bin', id);
      let names; try { names = await fs.promises.readdir(dir); } catch { continue; }
      const rs = names.filter(n => n.startsWith('$R'));
      items += rs.length;
      size += (await Promise.all(rs.map(n => treeSize(path.join(dir, n))))).reduce((a, b) => a + b, 0);
    }
    if (id) return { size, items };
    // no SID (unusual): fall back to the shell API
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_BIN + '[void][WwBin]::SHQueryRecycleBin($null, [ref]$q); "$($q.size)|$($q.items)"']);
    const [qs, qi] = r.stdout.trim().split('|').map(Number);
    return { size: qs || 0, items: qi || 0 };
  }
  const dir = unixTrash();
  let names = []; try { names = await fs.promises.readdir(dir); } catch { return { size: 0, items: 0 }; }
  return { size: await treeSize(dir), items: names.length };
}
// cached for a few seconds; parallel callers share one measurement
async function info(fresh = false) {
  if (!fresh && cache && Date.now() - cacheAt < 15000) return cache;
  if (!inflight) inflight = measure().then(r => { cache = r; cacheAt = Date.now(); inflight = null; return r; }, e => { inflight = null; throw e; });
  return inflight;
}

async function empty() {
  const before = await info(true);
  if (PLATFORM === 'win32') {
    // 7 = no confirmation, no progress UI, no sound (we confirm in our own UI)
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_BIN + '[void][WwBin]::SHEmptyRecycleBin([IntPtr]::Zero, $null, 7)'], { timeout: 30 * 60 * 1000 });
  } else if (PLATFORM === 'darwin') {
    await run('osascript', ['-e', 'tell application "Finder" to empty trash'], { timeout: 30 * 60 * 1000 });
  } else {
    const gio = await run('gio', ['trash', '--empty']);
    if (!gio.ok) {
      const base = path.dirname(unixTrash());
      for (const sub of ['files', 'info']) {
        const d = path.join(base, sub);
        let names = []; try { names = fs.readdirSync(d); } catch {}
        for (const n of names) { try { fs.rmSync(path.join(d, n), { recursive: true, force: true }); } catch {} }
      }
    }
  }
  const after = await info(true);
  return { freed: Math.max(0, before.size - after.size), left: after };
}

module.exports = { info, empty };
