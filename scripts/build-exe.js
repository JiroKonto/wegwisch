// Builds a single executable (Node SEA) for the current platform: dist/wegwisch[.exe]
// Usage: node scripts/build-exe.js [--name wegwisch-win-x64.exe]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const win = process.platform === 'win32', mac = process.platform === 'darwin';
const nameArg = process.argv.indexOf('--name');
const outName = nameArg > 0 ? process.argv[nameArg + 1] : 'wegwisch' + (win ? '.exe' : '');
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST);

// 1. bundle the app and the worker into plain CommonJS files
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning', legalComments: 'none' };
esbuild.buildSync({ ...common, entryPoints: [path.join(ROOT, 'bin', 'wegwisch.js')], outfile: path.join(DIST, 'wegwisch.cjs') });
esbuild.buildSync({ ...common, entryPoints: [path.join(ROOT, 'src', 'scan-worker.js')], outfile: path.join(DIST, 'scan-worker.js') });

// 2. SEA config: main script + UI files + worker as assets
const assets = { 'scan-worker.js': path.join(DIST, 'scan-worker.js') };
for (const f of fs.readdirSync(path.join(ROOT, 'public'))) assets['public/' + f] = path.join(ROOT, 'public', f);
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify({
  main: path.join(DIST, 'wegwisch.cjs'), output: path.join(DIST, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true, useCodeCache: false, assets,
}, null, 1));
run(process.execPath, ['--experimental-sea-config', path.join(DIST, 'sea-config.json')]);

// 3. copy the node binary and inject the blob
const exe = path.join(DIST, outName);
fs.copyFileSync(process.execPath, exe);
if (mac) run('codesign', ['--remove-signature', exe]);
const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
run(process.execPath, [postject, exe, 'NODE_SEA_BLOB', path.join(DIST, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(mac ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
if (mac) run('codesign', ['--sign', '-', exe]);

for (const f of ['wegwisch.cjs', 'scan-worker.js', 'sea-config.json', 'sea-prep.blob']) fs.rmSync(path.join(DIST, f));
console.log(`built ${path.relative(ROOT, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(0)} MB)`);
