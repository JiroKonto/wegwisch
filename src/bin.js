// The Recycle Bin / Trash: how much is in it, and emptying it (trashed files only free space once it's emptied).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PLATFORM, HOME, run } = require('./platform');
const scanner = require('./scanner');

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

async function info() {
  if (PLATFORM === 'win32') {
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_BIN + '[void][WwBin]::SHQueryRecycleBin($null, [ref]$q); "$($q.size)|$($q.items)"']);
    const [size, items] = r.stdout.trim().split('|').map(Number);
    return { size: size || 0, items: items || 0 };
  }
  const dir = unixTrash();
  if (!fs.existsSync(dir)) return { size: 0, items: 0 };
  scanner.invalidate(dir);
  const s = await scanner.request(dir, true);
  let items = 0; try { items = fs.readdirSync(dir).length; } catch {}
  return { size: s.size, items };
}

async function empty() {
  const before = await info();
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
  const after = await info();
  return { freed: Math.max(0, before.size - after.size), left: after };
}

module.exports = { info, empty };
