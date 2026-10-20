// End-to-end: start the real server on a free port and talk to its API.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

let proc, base;
const H = { 'x-wegwisch': '1' };
const get = async p => (await fetch(base + p, { headers: H })).json();
const post = async (p, body) => (await fetch(base + p, { method: 'POST', headers: H, body: JSON.stringify(body) })).json();

test.before(async () => {
  const port = await freePort();
  base = `http://localhost:${port}`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'wegwisch-data-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'wegwisch.js'), '--no-open', '--port', String(port), '--threads', '2'],
    { env: { ...process.env, WEGWISCH_DATA: data }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/'); return; } catch { await new Promise(r => setTimeout(r, 200)); } }
  throw new Error('server did not start');
});
test.after(() => proc && proc.kill());

test('serves the UI', async () => {
  const r = await fetch(base + '/');
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /Wegwisch/);
  assert.strictEqual((await fetch(base + '/app.js')).status, 200);
  assert.strictEqual((await fetch(base + '/../package.json')).status, 404);
});

test('API needs the custom header and the right Host', async () => {
  assert.strictEqual((await fetch(base + '/api/state')).status, 403);
  const s = await get('/api/state');
  assert.strictEqual(s.platform, process.platform);
});

test('lists drives', async () => {
  const d = await get('/api/drives');
  assert.ok(Array.isArray(d) && d.length >= 1, 'at least one drive');
  assert.ok(d[0].total > 0);
});

test('scans a folder and computes sizes', async () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'wegwisch-ci-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'a.bin'), Buffer.alloc(64 * 1024, 1));
  fs.writeFileSync(path.join(dir, 'b.txt'), 'hello');
  let l;
  for (let i = 0; i < 50; i++) { l = await get('/api/list?path=' + encodeURIComponent(dir)); if (!l.waiting) break; await new Promise(r => setTimeout(r, 200)); }
  assert.strictEqual(l.items.length, 2);
  const sub = l.items.find(i => i.name === 'sub');
  assert.ok(sub.isDir && sub.files === 1);
  // permanently delete one item, the folder itself stays
  const r = await post('/api/delete', { items: [{ path: path.join(dir, 'b.txt'), permanent: true }] });
  assert.ok(r.results[0].ok, JSON.stringify(r.results));
  assert.ok(!fs.existsSync(path.join(dir, 'b.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses to delete protected paths', async () => {
  const r = await post('/api/delete', { items: [{ path: os.homedir(), permanent: true }, { path: path.parse(os.homedir()).root, permanent: true }] });
  assert.ok(r.results.every(x => !x.ok && x.error === 'locked'), JSON.stringify(r.results));
  assert.ok(fs.existsSync(os.homedir()));
});
