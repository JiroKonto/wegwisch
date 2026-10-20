// Settings, keep-list and stats live in the OS's per-user app data folder, never in the repo.
const fs = require('fs');
const os = require('os');
const path = require('path');

function dataDir() {
  if (process.env.WEGWISCH_DATA) return process.env.WEGWISCH_DATA;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'wegwisch');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'wegwisch');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'wegwisch');
}

const DIR = dataDir();
fs.mkdirSync(DIR, { recursive: true });

function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8')); } catch { return fallback; }
}
function save(name, value) {
  const file = path.join(DIR, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 1));
  fs.renameSync(file + '.tmp', file);
}

const CPUS = os.cpus().length;
const DEFAULTS = {
  threads: Math.max(2, Math.min(8, CPUS)),
  prescan: false,          // scan all drives in the background on start
  ai: 'auto',              // auto | claude-cli | anthropic | ollama | off
  model: 'claude-opus-5',  // used by claude-cli and anthropic
  ollamaModel: '',
  apiKey: '',
  cachePermanent: true,    // caches skip the trash (trashing them frees nothing)
  suggest: true,           // 💡 badges and "all very safe" buttons while browsing
};
const SETTING_KEYS = Object.keys(DEFAULTS);

const settings = Object.assign({}, DEFAULTS, load('settings.json', {}));
const saveSettings = () => save('settings.json', settings);

module.exports = { DIR, CPUS, DEFAULTS, SETTING_KEYS, settings, saveSettings, load, save };
