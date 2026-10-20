// Decides how dangerous it is to delete a path.
//   locked  – never deletable (system, profile roots, cloud folders, running programs, ...)
//   caution – deletable, but the card shows a warning (program folders, old Windows installs, ...)
//   ok      – nothing special
// Pure function of (path, ctx) so it can be tested for every platform on any machine.

const path = require('path');

const L = reason => ({ level: 'locked', reason });
const C = reason => ({ level: 'caution', reason });
const OK = { level: 'ok', reason: null };

function helpers(platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const norm = p => {
    let r = P.resolve(p);
    if (platform === 'win32') r = r.toLowerCase();
    return r.length > 1 && r.endsWith(P.sep) && !/^[a-z]:\\$/i.test(r) ? r.slice(0, -1) : r;
  };
  // a is b or inside b
  const under = (a, b) => {
    const A = norm(a), B = norm(b);
    return A === B || A.startsWith(B.endsWith(P.sep) ? B : B + P.sep);
  };
  return { P, norm, under };
}

const SECRET_DIRS = ['.ssh', '.gnupg', '.aws', '.kube', '.azure', '.password-store'];

function classify(p, ctx) {
  const { P, norm, under } = helpers(ctx.platform);
  const abs = norm(p);

  for (const root of ctx.driveRoots || []) if (norm(root) === abs) return L('root');
  for (const d of ctx.appDirs || []) if (under(abs, d) || under(d, abs)) return L('app');
  for (const exe of ctx.running || []) if (under(exe, abs)) return L('inuse');
  for (const c of ctx.cloudDirs || []) if (under(abs, c) || under(c, abs)) return L('cloud');
  if (ctx.home) for (const s of SECRET_DIRS) if (under(abs, P.join(ctx.home, s))) return L('secrets');

  const r = ctx.platform === 'win32' ? windows(abs, ctx, norm, under) : ctx.platform === 'darwin' ? mac(abs, ctx, under) : linux(abs, ctx, under);
  if (r.level !== 'ok') return r;

  if (/[\\/]steamapps[\\/]common[\\/][^\\/]+$/i.test(abs)) return C('steam');
  return OK;
}

// ---------------- Windows ----------------
const WIN_ANY_DRIVE = ['$recycle.bin', 'system volume information', 'recovery', 'config.msi', '$winreagent', '$windows.~ws', 'boot', 'efi',
  'pagefile.sys', 'hiberfil.sys', 'swapfile.sys', 'dumpstack.log', 'dumpstack.log.tmp', 'bootmgr', 'bootnxt'];
const WIN_SYS_ROOTS = ['windows', 'program files', 'program files (x86)', 'programdata', 'users'];
const WIN_PROFILE_LOCKED = ['appdata', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'onedrive', 'favorites', 'contacts', 'links', 'saved games', 'searches'];
// Inside C:\Windows only these may be emptied (their contents, never the folder itself).
const WIN_ALLOWED_INSIDE = ['windows\\temp', 'windows\\softwaredistribution\\download'];

function windows(abs, ctx, norm, under) {
  const parts = abs.split('\\').filter(Boolean);
  const drive = parts[0];
  const top = parts[1];
  const depth = parts.length;
  if (depth <= 1) return L('root');
  if (WIN_ANY_DRIVE.includes(top)) return L('system');

  const sysDrive = (ctx.systemDrive || 'C:').toLowerCase();
  const isSys = drive === sysDrive;
  const isOld = (ctx.oldSystems || []).map(d => d.toLowerCase()).includes(drive);

  if (!isSys && isOld && WIN_SYS_ROOTS.includes(top)) return C('oldsys');

  if (isSys && top === 'windows') {
    const rel = parts.slice(1).join('\\');
    for (const a of WIN_ALLOWED_INSIDE) if (rel.startsWith(a + '\\')) return C('admin');
    return L('system');
  }
  if (isSys && (top === 'windows.old' || top === '$windows.~bt')) return C('oldsys');

  if (top === 'program files' || top === 'program files (x86)') {
    if (depth === 2) return L('system');
    if (['windowsapps', 'common files', 'windows defender', 'windows nt', 'windowspowershell', 'microsoft update health tools'].includes(parts[2])) return L('system');
    return C('program');
  }
  if (top === 'programdata') {
    if (depth === 2 || parts[2] === 'microsoft') return L('system');
    return C('programdata');
  }
  if (top === 'users') {
    if (depth <= 3) return L('profile');
    if (parts[2] === 'public' || parts[2] === 'default' || parts[2] === 'all users') return L('profile');
    if (depth === 4 && WIN_PROFILE_LOCKED.includes(parts[3])) return L('profile');
    if (parts[3] === 'appdata') {
      if (depth === 5) return L('profile');
      if (depth === 6 && parts[5] === 'microsoft') return L('system');
      if (depth >= 6 && parts[5] === 'microsoft' && parts[6] === 'windows') return L('system');
      return C('appdata');
    }
  }
  return OK;
}

// ---------------- macOS ----------------
const MAC_SYSTEM = ['/system', '/bin', '/sbin', '/usr', '/etc', '/var', '/private', '/dev', '/cores', '/opt/homebrew/cellar'];
const MAC_ROOT_LOCKED = ['/library', '/applications', '/users', '/volumes', '/opt', '/tmp'];
const MAC_HOME_LOCKED = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Public', 'Applications', 'Library'];

function mac(abs, ctx, under) {
  if (abs === '/') return L('root');
  const lower = abs.toLowerCase(); // APFS is case-insensitive by default
  for (const s of MAC_SYSTEM) if (lower === s || lower.startsWith(s + '/')) return L('system');
  if (MAC_ROOT_LOCKED.includes(lower)) return L('system');
  const parts = abs.split('/').filter(Boolean);
  if (parts[0].toLowerCase() === 'volumes' && parts.length === 2) return L('root');
  if (parts[0].toLowerCase() === 'users' && parts.length === 2) return L('profile');
  if (lower.startsWith('/library/')) return C('system');
  if (lower.startsWith('/applications/')) return C('program');
  const home = ctx.home;
  if (home) {
    if (under(abs, home + '/Library/Mobile Documents') || under(abs, home + '/Library/CloudStorage')) return L('cloud');
    for (const d of MAC_HOME_LOCKED) if (abs.toLowerCase() === (home + '/' + d).toLowerCase()) return L('profile');
    if (under(abs, home + '/Library/Caches')) return OK;
    if (under(abs, home + '/Library')) return C('appdata');
  }
  return OK;
}

// ---------------- Linux ----------------
const LINUX_SYSTEM = ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib32', '/lib64', '/libx32', '/proc', '/run', '/sbin', '/sys', '/usr', '/var', '/srv', '/snap', '/lost+found'];
const LINUX_ROOT_LOCKED = ['/home', '/root', '/opt', '/mnt', '/media', '/tmp'];
const LINUX_HOME_LOCKED = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'Public', 'Templates', '.config', '.local', '.local/share', '.cache'];

function linux(abs, ctx, under) {
  if (abs === '/') return L('root');
  for (const s of LINUX_SYSTEM) if (abs === s || abs.startsWith(s + '/')) return L('system');
  if (LINUX_ROOT_LOCKED.includes(abs)) return L('system');
  const parts = abs.split('/').filter(Boolean);
  if (parts[0] === 'home' && parts.length === 2) return L('profile');
  if (parts[0] === 'media' && parts.length === 2) return L('system');
  if (parts[0] === 'opt') return C('program');
  const home = ctx.home;
  if (home) {
    for (const d of LINUX_HOME_LOCKED) if (abs === home + '/' + d) return L('profile');
    if (under(abs, home + '/.cache')) return OK;
    if (under(abs, home + '/.config') || under(abs, home + '/.local')) return C('appdata');
  }
  return OK;
}

module.exports = { classify, helpers };
