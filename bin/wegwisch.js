#!/usr/bin/env node
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--help') || args.includes('-h')) {
  console.log(`wegwisch – swipe through your disk and clean it up

Usage: wegwisch [options]
  --port <n>      port to listen on (default 4747)
  --threads <n>   parallel scan threads (default: saved setting)
  --no-open       don't open the browser
  -h, --help      show this help`);
  process.exit(0);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 15)) { console.error('Wegwisch needs Node.js 18.15 or newer.'); process.exit(1); }

require('../src/server').start({
  port: parseInt(opt('--port')) || 4747,
  threads: parseInt(opt('--threads')) || undefined,
  open: !args.includes('--no-open'),
});
