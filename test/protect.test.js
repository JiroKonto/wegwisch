const test = require('node:test');
const assert = require('node:assert');
const { classify } = require('../src/protect');

const win = {
  platform: 'win32', home: 'C:\\Users\\alex', systemDrive: 'C:', oldSystems: ['D:'],
  cloudDirs: ['C:\\Users\\alex\\OneDrive'], running: ['E:\\Games\\Steam\\steam.exe'],
  appDirs: ['C:\\Users\\alex\\source\\wegwisch', 'C:\\Users\\alex\\AppData\\Roaming\\wegwisch'], driveRoots: ['C:\\', 'D:\\', 'E:\\'],
};
const lvl = (p, c) => classify(p, c).level;
const why = (p, c) => classify(p, c).reason;

test('windows: system and roots are locked', () => {
  for (const p of ['C:\\', 'E:\\', 'C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files', 'C:\\ProgramData', 'C:\\Users',
    'C:\\pagefile.sys', 'D:\\hiberfil.sys', 'E:\\System Volume Information', 'E:\\$Recycle.Bin', 'C:\\Program Files\\WindowsApps\\x',
    'C:\\ProgramData\\Microsoft\\Windows'])
    assert.strictEqual(lvl(p, win), 'locked', p);
});

test('windows: profile roots are locked, their contents are not', () => {
  for (const p of ['C:\\Users\\alex', 'C:\\Users\\bob', 'C:\\Users\\Public', 'C:\\Users\\alex\\Documents', 'C:\\Users\\alex\\Downloads',
    'C:\\Users\\alex\\AppData', 'C:\\Users\\alex\\AppData\\Local', 'C:\\Users\\alex\\AppData\\Local\\Microsoft'])
    assert.strictEqual(lvl(p, win), 'locked', p);
  assert.strictEqual(lvl('C:\\Users\\alex\\Downloads\\game.zip', win), 'ok');
  assert.strictEqual(lvl('C:\\Users\\alex\\Documents\\old', win), 'ok');
  assert.strictEqual(lvl('C:\\Users\\alex\\AppData\\Local\\NVIDIA\\DXCache', win), 'caution');
});

test('windows: case and trailing slashes do not matter', () => {
  assert.strictEqual(lvl('c:\\WINDOWS\\', win), 'locked');
  assert.strictEqual(lvl('C:/Windows/notepad.exe', win), 'locked');
  assert.strictEqual(lvl('c:\\users\\ALEX', win), 'locked');
});

test('windows: cloud folders, secrets, the app itself and running programs are locked', () => {
  assert.strictEqual(why('C:\\Users\\alex\\OneDrive\\Fotos', win), 'cloud');
  assert.strictEqual(why('C:\\Users\\alex\\.ssh', win), 'secrets');
  assert.strictEqual(why('C:\\Users\\alex\\source\\wegwisch\\src', win), 'app');
  assert.strictEqual(why('C:\\Users\\alex\\source', win), 'app');      // ancestor of the app
  assert.strictEqual(why('E:\\Games\\Steam', win), 'inuse');
  assert.strictEqual(why('E:\\Games', win), 'inuse');
  assert.strictEqual(lvl('E:\\Games2', win), 'ok');                     // prefix but not parent
});

test('windows: program folders and old installs are caution, not locked', () => {
  assert.strictEqual(why('C:\\Program Files\\SomeApp', win), 'program');
  assert.strictEqual(why('C:\\ProgramData\\Epic', win), 'programdata');
  assert.strictEqual(why('D:\\Windows', win), 'oldsys');
  assert.strictEqual(why('D:\\Program Files (x86)\\Steam', win), 'oldsys');
  assert.strictEqual(why('D:\\Users\\Pain Train\\AppData', win), 'oldsys');
  assert.strictEqual(why('C:\\Windows.old', win), 'oldsys');
  assert.strictEqual(why('F:\\SteamLibrary\\steamapps\\common\\Portal 2', win), 'steam');
});

test('windows: only Temp and update downloads inside C:\\Windows may be emptied', () => {
  assert.strictEqual(lvl('C:\\Windows\\Temp', win), 'locked');
  assert.strictEqual(lvl('C:\\Windows\\Temp\\foo.tmp', win), 'caution');
  assert.strictEqual(lvl('C:\\Windows\\SoftwareDistribution\\Download\\abc', win), 'caution');
  assert.strictEqual(lvl('C:\\Windows\\SoftwareDistribution', win), 'locked');
});

const mac = { platform: 'darwin', home: '/Users/alex', appDirs: ['/Users/alex/Library/Application Support/wegwisch'], driveRoots: ['/', '/Volumes/Backup'] };

test('macOS', () => {
  for (const p of ['/', '/System/Library', '/usr/bin', '/Applications', '/Users', '/Users/alex', '/Users/alex/Library', '/Users/alex/Documents',
    '/Volumes/Backup', '/private/var', '/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/x'])
    assert.strictEqual(lvl(p, mac), 'locked', p);
  assert.strictEqual(lvl('/Users/alex/Library/Caches/com.spotify.client', mac), 'ok');
  assert.strictEqual(why('/Users/alex/Library/Application Support/Steam', mac), 'appdata');
  assert.strictEqual(why('/Applications/Zoom.app', mac), 'program');
  assert.strictEqual(lvl('/Users/alex/Downloads/big.dmg', mac), 'ok');
});

const lin = { platform: 'linux', home: '/home/alex', appDirs: ['/home/alex/.config/wegwisch'], driveRoots: ['/', '/mnt/data'] };

test('linux', () => {
  for (const p of ['/', '/etc', '/usr/lib/x', '/home', '/home/alex', '/home/bob', '/home/alex/.config', '/home/alex/.ssh/id_rsa', '/mnt/data', '/boot/efi'])
    assert.strictEqual(lvl(p, lin), 'locked', p);
  assert.strictEqual(lvl('/home/alex/.cache/pip', lin), 'ok');
  assert.strictEqual(why('/home/alex/.local/share/Steam', lin), 'appdata');
  assert.strictEqual(lvl('/home/alex/Videos/raw', lin), 'ok');
  assert.strictEqual(lvl('/mnt/data/old-backups', lin), 'ok');
});
