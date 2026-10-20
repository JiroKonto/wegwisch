'use strict';
const $ = s => document.querySelector(s);
const enc = encodeURIComponent;
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'x-wegwisch': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: { 'x-wegwisch': '1' } }).then(r => r.json());
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- i18n ----------
let lang = 'en';
try { lang = localStorage.getItem('lang') || 'en'; } catch {}
if (!I18N[lang]) lang = 'en';
function t(key, vars = {}) {
  const get = d => key.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
  let s = get(I18N[lang]); if (s == null) s = get(I18N.en); if (s == null) return key;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(el => el.textContent = t(el.dataset.t));
  $('#hint').innerHTML = t('hint');
  $('#langBtn').textContent = lang.toUpperCase();
  $('#aUndo').title = t('undo'); $('#aSkip').title = t('skip'); $('#setBtn').title = t('settings');
}

function fmt(b) {
  if (b == null) return '…';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (b >= 1024 && i < 4) { b /= 1024; i++; }
  return b.toLocaleString(lang, { maximumFractionDigits: i >= 3 ? 1 : 0 }) + ' ' + u[i];
}
function num(n) { return (n || 0).toLocaleString(lang); }
function ago(ms) {
  const d = (Date.now() - ms) / 864e5;
  if (d < 1) return t('today');
  if (d < 30) return Math.round(d) === 1 ? t('day') : t('days', { n: Math.round(d) });
  if (d < 365) return Math.round(d / 30) <= 1 ? t('month') : t('months', { n: Math.round(d / 30) });
  if (d < 547) return t('year');
  return t('years', { n: (d / 365).toLocaleString(lang, { maximumFractionDigits: 1 }) });
}
function icon(it) {
  if (it.junk) return '🧹';
  if (it.isDir) return '📁';
  const e = (it.name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(e)) return '🎬';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'psd', 'heic'].includes(e)) return '🖼️';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'xz'].includes(e)) return '📦';
  if (['iso', 'img', 'vhd', 'vhdx', 'nsp', 'xci', 'dmg'].includes(e)) return '💿';
  if (['exe', 'msi', 'bat', 'cmd', 'pkg', 'appimage', 'deb'].includes(e)) return '⚙️';
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(e)) return '🎵';
  if (['log', 'tmp', 'dmp', 'bak', 'old'].includes(e)) return '🧾';
  return '📄';
}
let toastT;
function toast(s) { const el = $('#toast'); el.textContent = s; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); if (typeof updateModeBtn === 'function') updateModeBtn(); }
const onScreen = id => $('#' + id).classList.contains('on');

// ---------- state ----------
let S = null;                // server state (settings, ai, stats)
const delQ = new Map();      // path -> item
let mode = 'dir';            // 'dir' | 'junk'
let exploreQ = [];
let cur = null;              // {path, items, waiting}
let decided = new Set();
let history = [];
let order = [];
let started = false, dragging = false, pollT = null, advanced = false;
const STACK = 5;
const answers = new Map();
const peeks = new Map();
const canDelete = it => it.level !== 'locked' || it.contents;
const permanentDefault = it => !!(it.cache && S?.settings.cachePermanent);

function updateTray() {
  let s = 0; delQ.forEach(i => s += i.size || 0);
  $('#trayN').textContent = delQ.size; $('#trayS').textContent = fmt(s);
}

// ---------- scan indicator ----------
let scanT = null;
async function pollScan() {
  clearTimeout(scanT);
  let p; try { p = await api('/api/scan'); } catch { return; }
  const active = p.queued > 0 || p.busy > 0;
  $('#scanpill').hidden = !active;
  if (active) $('#scantxt').textContent = `${p.threads}× · ${num(p.files)} · ${num(p.rate)}/s`;
  scanT = setTimeout(pollScan, active ? 1500 : 5000);
}

// ---------- start screen ----------
// step 1: pick a mode (+ smart decks), step 2: pick a drive
async function goStart(step = 1) {
  clearTimeout(pollT); cur = null; mode = 'dir'; $('#crumbs').textContent = ''; show('start');
  $('#step1').hidden = step !== 1; $('#step2').hidden = step !== 2;
  document.querySelectorAll('[data-art]').forEach(el => el.innerHTML = ART[el.dataset.art]);
  if (step === 1) return renderSmart();
  $('#driveSub').textContent = t(viewMode === 'classic' ? 'modeClassicSub' : 'modeSwipeSub');
  const ds = await api('/api/drives');
  $('#driveGrid').innerHTML = ds.map(d => {
    const used = d.total - d.free, pct = d.total ? used / d.total * 100 : 0;
    const tag = d.oldSystem ? `<span class="tag old">${t('oldSystem')}</span>` : d.system ? `<span class="tag">${t('system')}</span>` : '';
    return `<button class="drive ${pct > 95 ? 'full' : ''}" data-path="${esc(d.path)}">${tag}
      <div class="dart">${ART[d.kind] || ART.disk}</div>
      <div class="l">${esc(d.label)} <span class="kind">${t('kind.' + (d.kind || 'disk'))}</span></div>
      <div class="model" title="${esc(d.model || '')}">${esc(d.model || '')}</div>
      <div class="f">${t('free', { free: fmt(d.free), total: fmt(d.total) })}</div>
      <div class="bar"><i style="width:${pct}%"></i></div></button>`;
  }).join('');
  document.querySelectorAll('.drive').forEach(b => b.onclick = () => openFolder(b.dataset.path));
}
function chooseMode(m) { setViewMode(m); goStart(2); }
// smart decks on the start screen; more get added here
const SMART = [{ id: 'junk', icon: '🧹', title: 'junkTitle', sub: 'junkSub', open: () => openJunk() }];
function renderSmart() {
  $('#smartGrid').innerHTML = SMART.map(c => `<button class="junkcard" data-smart="${c.id}"><div class="big">${c.icon}</div><div><b>${t(c.title)}</b><span>${t(c.sub)}</span></div></button>`).join('');
  SMART.forEach(c => $(`[data-smart="${c.id}"]`).onclick = c.open);
}

// ---------- loading a folder / the junk radar ----------
function resetDeck() { clearTimeout(pollT); decided = new Set(); history = []; order = []; started = false; }
async function openDir(p) {
  resetDeck(); mode = 'dir';
  cur = { path: p, items: [], waiting: 1 };
  $('#crumbs').textContent = p; show('deckScreen');
  await refresh();
}
async function openJunk() {
  resetDeck(); mode = 'junk'; exploreQ = [];
  cur = { path: null, items: [], waiting: 1 };
  $('#crumbs').textContent = t('junkTitle'); show('deckScreen');
  await refresh();
  if (!S.settings.prescan) toast(t('junkScanHint'));
}
async function refresh() {
  if (!cur) return;
  const mine = cur;
  let r;
  try { r = await api(mode === 'junk' ? '/api/junk' : '/api/list?path=' + enc(cur.path)); } catch { r = { items: [], waiting: 0 }; }
  if (cur !== mine) return;
  if (r.error) { toast('⚠ ' + r.error + ': ' + cur.path); return nextDir(); }
  const old = new Map(cur.items.map(i => [i.path, i]));
  cur.items = r.items.map(i => old.has(i.path) ? Object.assign(old.get(i.path), i) : i);
  cur.waiting = r.waiting; cur.scan = r.scan;
  cur.total = cur.items.reduce((s, i) => s + (i.size || 0), 0);
  if (cur.waiting > 0) pollT = setTimeout(refresh, 1200);
  if (!dragging) render();
}
function remaining() {
  const rest = cur.items.filter(i => !decided.has(i.path) && !delQ.has(i.path));
  rest.sort((a, b) => (b.size ?? -1) - (a.size ?? -1));
  if (order[0]) { const k = rest.findIndex(i => i.path === order[0]); if (k > 0) rest.unshift(rest.splice(k, 1)[0]); }
  order = rest.map(i => i.path);
  return rest;
}

// ---------- cards ----------
function render() {
  if (!cur || !onScreen('deckScreen')) return;
  const deck = $('#deck');
  const rest = remaining();
  if (cur.waiting > 0 && !started) {
    const n = cur.items.filter(i => i.isDir).length;
    deck.innerHTML = `<div class="card"><div class="loading"><div class="spin"></div>
      <div style="font-weight:700;font-size:18px">${t('calc')}</div>
      <div style="color:var(--dim)">${t('calcProgress', { done: n - cur.waiting, n })}<br>
      <span class="mono" style="font-size:12px">${t('scanned', { files: num(cur.scan?.files), bytes: fmt(cur.scan?.bytes || 0) })}</span></div>
      <button class="btn" id="startAnyway">${t('startAnyway')}</button></div></div>`;
    $('#startAnyway').onclick = () => { started = true; render(); };
    return;
  }
  if (!rest.length) return nextDir();
  const top = rest[0];
  $('#keepLbl').textContent = top.isDir && mode === 'dir' ? t('look') : t('keep');
  $('#aAsk').hidden = !S.provider;
  $('#aSkip').hidden = mode === 'junk';
  deck.innerHTML = '';
  // visible stack behind the top card: up to STACK cards, thinning out as the folder empties
  const backs = [];
  for (let d = Math.min(rest.length - 1, STACK); d >= 1; d--) {
    const b = cardEl(rest[d], true);
    b.dataset.d = d; b.style.setProperty('--d', d);
    deck.appendChild(b); backs.push(b);
  }
  const el = cardEl(top, false); deck.appendChild(el); bindDrag(el);
  $('#leftN').textContent = rest.length > 1 ? t('leftN', { n: num(rest.length) }) : '';
  if (advanced) {
    // slide every card one step forward: start one position further back, then animate in
    backs.forEach(b => b.style.setProperty('--d', +b.dataset.d + 1));
    el.classList.add('incoming');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      backs.forEach(b => b.style.setProperty('--d', b.dataset.d));
      el.classList.add('anim'); el.classList.remove('incoming');
    }));
  }
  advanced = false;
  loadPeek(top);
}
function cardEl(it, back) {
  const el = document.createElement('div');
  el.className = 'card' + (back ? ' back' : '');
  el.dataset.path = it.path;
  const share = it.size != null && cur.total && mode === 'dir' ? Math.round(it.size / cur.total * 100) : null;
  const ans = answers.get(it.path);
  const look = it.isDir && mode === 'dir';
  el.innerHTML = `
    <div class="stamp l">${t('stampDel')}</div><div class="stamp r">${look ? t('stampLook') : t('stampKeep')}</div>
    <div class="stamp u">${t('stampAsk')}</div><div class="stamp d">${t('stampForever')}</div>
    <button class="rv" title="${esc(t('reveal'))}">↗</button>
    <div class="ic">${icon(it)}</div>
    <div class="nm">${esc(it.name)}</div>
    <div class="pth mono">${esc(it.path)}</div>
    <div class="sz ${it.size == null ? 'unk' : ''}">${it.size == null ? t('sizeCalc') + '<span class="dots"></span>' : fmt(it.size)}</div>
    ${share != null ? `<div class="share">${t('ofFolder', { p: share })}</div><div class="bar"><i style="width:${share}%"></i></div>` : ''}
    <div class="chips">
      ${it.junk ? `<span class="chip junk">🧹 ${esc(t('junk.' + it.junk))}</span>` : ''}
      ${it.level === 'locked' && !it.contents ? `<span class="chip locked">🔒 ${esc(t('reason.' + it.reason))}</span>` : ''}
      ${it.level === 'caution' && !it.junk ? `<span class="chip caution">⚠ ${esc(t('reason.' + it.reason))}</span>` : ''}
      ${it.isDir && it.files != null ? `<span class="chip">📄 ${t('files', { n: num(it.files) })}</span>` : ''}
      <span class="chip">🕒 ${t('modified', { ago: ago(it.mtime) })}</span>
    </div>
    ${ans !== undefined ? askBox(ans) : ''}
    <div class="peek"></div>`;
  const rv = el.querySelector('.rv');
  rv.addEventListener('pointerdown', e => e.stopPropagation());
  rv.onclick = () => api('/api/reveal', { path: it.path });
  return el;
}
function askBox(a) {
  if (a === null) return `<div class="ask"><b>✦</b> ${t('thinking')}<span class="dots"></span></div>`;
  if (a.error) return `<div class="ask">${esc(a.error === 'noai' ? t('aiNone') : t('aiFailed', { d: a.detail || a.error }))}</div>`;
  const m = /^\W*(DELETE|KEEP|CAREFUL)\b\W*/i.exec(a.text || '');
  const v = m ? m[1].toUpperCase() : null;
  const body = esc(m ? a.text.slice(m[0].length) : a.text);
  return `<div class="ask ${v ? 'v-' + v : ''}"><b>✦ ${v ? t('verdict.' + v) : 'AI'}</b> · ${body}</div>`;
}
async function loadPeek(it) {
  const fill = pk => {
    const el = document.querySelector(`.card:not(.back)[data-path="${CSS.escape(it.path)}"] .peek`);
    if (!el) return;
    if (pk.image) el.innerHTML = `<img src="/api/raw?path=${enc(it.path)}" alt="">`;
    else if (pk.children?.length) el.innerHTML = `<div style="color:var(--dim);font-size:12px;margin-bottom:6px">${t('contents', { n: num(pk.total) })}</div>` +
      pk.children.map(c => `<div class="row"><span>${c.isDir ? '📁' : '📄'} ${esc(c.name)}</span><span>${fmt(c.size)}</span></div>`).join('');
    else el.remove();
  };
  if (peeks.has(it.path) && !(it.isDir && cur.waiting)) return fill(peeks.get(it.path));
  const pk = await api('/api/peek?path=' + enc(it.path));
  peeks.set(it.path, pk); fill(pk);
}

// ---------- swiping ----------
function bindDrag(el) {
  let sx = 0, sy = 0, dx = 0, dy = 0, down = false;
  const st = { l: el.querySelector('.stamp.l'), r: el.querySelector('.stamp.r'), u: el.querySelector('.stamp.u'), d: el.querySelector('.stamp.d') };
  el.addEventListener('pointerdown', e => { down = true; dragging = true; sx = e.clientX; sy = e.clientY; el.setPointerCapture(e.pointerId); el.classList.remove('anim'); });
  el.addEventListener('pointermove', e => {
    if (!down) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    el.style.transform = `translate(${dx}px,${dy}px) rotate(${dx * .05}deg)`;
    const dir = dirOf(dx, dy, 40);
    for (const k in st) st[k].style.opacity = k === dir ? Math.min(1, (Math.max(Math.abs(dx), Math.abs(dy)) - 40) / 80) : 0;
  });
  const up = () => {
    if (!down) return;
    down = false; dragging = false;
    const dir = dirOf(dx, dy, 110);
    for (const k in st) st[k].style.opacity = 0;
    if (dir) decide(dir); else { el.classList.add('anim'); el.style.transform = ''; }
    dx = dy = 0;
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function dirOf(dx, dy, th) {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < th) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'l' : 'r') : (dy < 0 ? 'u' : 'd');
}
const topItem = () => cur && cur.items.find(i => i.path === order[0]);
const topEl = () => document.querySelector('.card:not(.back)');
function flyOut(dir) {
  const el = topEl(); if (!el) return Promise.resolve();
  const v = { l: [-700, 40, -25], r: [700, 40, 25], d: [0, 800, 0] }[dir];
  el.classList.add('anim'); el.style.transform = `translate(${v[0]}px,${v[1]}px) rotate(${v[2]}deg)`; el.style.opacity = 0;
  return new Promise(r => setTimeout(r, 260));
}
function bounce() { const el = topEl(); if (!el) return; el.classList.add('anim'); el.style.transform = ''; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

let busy = false;
async function decide(dir) {
  const it = topItem();
  if (!it || !onScreen('deckScreen') || busy) return;
  if (dir === 'u') { bounce(); return ask(it); }
  if (dir === 'l' && !canDelete(it)) { bounce(); return toast(t('lockedToast', { r: t('reason.' + it.reason) })); }
  busy = true;
  await flyOut(dir);
  busy = false;
  decided.add(it.path); order.shift();
  if (dir === 'l') { delQ.set(it.path, { ...it, permanent: permanentDefault(it) }); updateTray(); }
  if (dir === 'r' && it.isDir && mode === 'dir') exploreQ.push(it.path);
  if (dir === 'd') { api('/api/keep', { path: it.path }); toast(t('foreverToast', { n: it.name })); }
  history.push({ dir, it });
  advanced = true;
  render();
}
async function ask(it) {
  if (answers.get(it.path) === null) return;
  answers.set(it.path, null); render();
  const r = await api('/api/ask', { path: it.path, lang });
  answers.set(it.path, r);
  if (topItem()?.path === it.path && !dragging) render();
}
function undo() {
  const h = history.pop();
  if (!h) return toast(t('nothingUndo'));
  decided.delete(h.it.path);
  if (h.dir === 'l') { delQ.delete(h.it.path); updateTray(); }
  if (h.dir === 'r' && h.it.isDir) { const k = exploreQ.lastIndexOf(h.it.path); if (k >= 0) exploreQ.splice(k, 1); }
  if (h.dir === 'd') api('/api/keep', { path: h.it.path, undo: true });
  order.unshift(h.it.path); render();
}
function skipFolder() { if (!cur || mode !== 'dir') return; toast(t('skipped')); nextDir(); }
function nextDir() {
  clearTimeout(pollT);
  const n = mode === 'dir' && exploreQ.shift();
  if (n) return openDir(n);
  cur = null; $('#crumbs').textContent = '';
  $('#doneTxt').textContent = delQ.size ? t('doneSome', { n: delQ.size, s: $('#trayS').textContent }) : t('doneNone');
  show('done');
}

document.addEventListener('keydown', e => {
  if ($('#settings').classList.contains('on')) { if (e.key === 'Escape') closeSettings(); return; }
  if (!onScreen('deckScreen') || e.target.closest?.('input,select')) return;
  const m = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd' }[e.key];
  if (m) { e.preventDefault(); if (m !== 'u' || S.provider) decide(m); }
  else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') undo();
  else if (e.key === 's' || e.key === 'S') skipFolder();
});

// ---------- review ----------
let reviewFrom = 'start';
function openReview() {
  const on = document.querySelector('.screen.on').id;
  if (on !== 'review') reviewFrom = on;
  renderReview(); show('review');
}
function backFromReview() {
  if (reviewFrom === 'deckScreen' && cur) { show('deckScreen'); render(); }
  else if (reviewFrom === 'classic' && cls.path) { show('classic'); refreshClassic(); }
  else if (reviewFrom === 'done' || reviewFrom === 'result' || !cur) goStart();
  else show(reviewFrom);
}
function renderReview() {
  let s = 0; delQ.forEach(i => s += i.size || 0);
  $('#revSub').textContent = delQ.size ? t('pileSub', { n: delQ.size, s: fmt(s) }) : t('pileEmpty');
  const items = [...delQ.values()].sort((a, b) => (b.size || 0) - (a.size || 0));
  $('#rlist').innerHTML = items.map(i => `<div class="ritem ${i.level === 'caution' ? 'caution' : ''}">
      <span>${icon(i)}</span><span class="p mono" title="${i.level === 'caution' ? esc(t('reason.' + i.reason)) : ''}">${esc(i.path)}</span>
      <button class="mode ${i.permanent ? 'perm' : ''}" data-toggle="${esc(i.path)}" title="${esc(t('clickToggle'))}">${i.contents ? t('emptyOnly') + ' · ' : ''}${i.permanent ? '⚡ ' + t('permanent') : '🗑 ' + t('toTrash')}</button>
      <span class="s">${fmt(i.size)}</span><button class="x" data-rm="${esc(i.path)}">✕</button></div>`).join('');
  $('#rlist').querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const i = delQ.get(b.dataset.toggle); i.permanent = !i.permanent; renderReview(); });
  $('#rlist').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { delQ.delete(b.dataset.rm); decided.delete(b.dataset.rm); updateTray(); renderReview(); });
  $('#doDelete').disabled = !delQ.size;
}
async function doDelete() {
  if (!delQ.size) return;
  const b = $('#doDelete'); b.disabled = true; b.textContent = t('working');
  const items = [...delQ.values()].map(i => ({ path: i.path, permanent: i.permanent, contents: !!i.contents }));
  let r;
  try { r = await api('/api/delete', { items }); } catch (e) { r = { results: [], error: String(e) }; }
  b.textContent = t('doDelete');
  r.results.forEach(x => { if (x.ok) delQ.delete(x.path); });
  updateTray();
  S.stats = r.stats || S.stats;
  const fails = r.results.filter(x => !x.ok);
  if (fails.length) {
    renderReview();
    $('#rlist').insertAdjacentHTML('afterbegin', fails.map(f => `<div class="ritem fail"><span>✕</span><span class="p mono">${esc(f.path)}</span><span class="s">${esc(f.error || '')}</span></div>`).join(''));
  }
  showResult(r, r.results.filter(x => x.ok).length, !fails.length);
}

// ---------- result + share image ----------
function showResult(r, n, switchScreen) {
  const total = (r.freed || 0) + (r.trashed || 0);
  $('#freedBig').textContent = fmt(total);
  $('#freedSub').textContent = t('resultSub', { n });
  $('#freedTrash').textContent = r.trashed ? t('resultTrash', { s: fmt(r.trashed) }) : '';
  $('#lifetime').textContent = t('lifetime', { s: fmt((S.stats.freed || 0) + (S.stats.trashed || 0)) });
  drawShare(total, n);
  if (switchScreen || n) show('result');
}
function drawShare(bytes, n) {
  const c = $('#shareCanvas'), g = c.getContext('2d'), W = c.width, H = c.height;
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#151827'); bg.addColorStop(1, '#0c0d12');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [[1050, 80, 260, '#ff4d6d22'], [150, 600, 300, '#2fd47a1f'], [700, 650, 240, '#a78bfa22']]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, col); rg.addColorStop(1, 'transparent'); g.fillStyle = rg; g.fillRect(0, 0, W, H);
  }
  g.textBaseline = 'alphabetic';
  g.font = '800 44px Inter, system-ui, sans-serif'; g.fillStyle = '#eef0f6'; g.fillText('Weg', 80, 110);
  const w = g.measureText('Weg').width;
  const lg = g.createLinearGradient(80 + w, 0, 80 + w + 130, 0); lg.addColorStop(0, '#ff4d6d'); lg.addColorStop(.5, '#a78bfa'); lg.addColorStop(1, '#2fd47a');
  g.fillStyle = lg; g.fillText('wisch', 80 + w, 110);
  const big = g.createLinearGradient(80, 0, 900, 0); big.addColorStop(0, '#2fd47a'); big.addColorStop(1, '#a78bfa');
  g.fillStyle = big; g.font = '800 190px Inter, system-ui, sans-serif'; g.fillText(fmt(bytes), 70, 360);
  g.fillStyle = '#eef0f6'; g.font = '700 46px Inter, system-ui, sans-serif'; g.fillText(t('shareLine'), 80, 440);
  g.fillStyle = '#8b90a3'; g.font = '500 30px Inter, system-ui, sans-serif'; g.fillText(t('resultSub', { n }), 80, 500);
  g.font = '500 26px "JetBrains Mono", monospace'; g.fillText('github.com/JiroKonto/wegwisch', 80, 570);
  g.font = '120px serif'; g.fillText('🧹', 1000, 560);
}
function saveImg() { const a = document.createElement('a'); a.download = 'wegwisch.png'; a.href = $('#shareCanvas').toDataURL('image/png'); a.click(); }
function copyImg() {
  $('#shareCanvas').toBlob(async b => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast(t('copied')); } catch { saveImg(); }
  });
}

// ---------- settings ----------
function openSettings() {
  const s = S.settings;
  $('#sThreads').max = Math.max(16, S.cpus * 2);
  $('#sThreads').value = s.threads; $('#thrVal').textContent = s.threads;
  $('#sPrescan').checked = s.prescan; $('#sCache').checked = s.cachePermanent;
  $('#sModel').value = s.model; $('#sLang').value = lang;
  $('#sKey').value = ''; $('#sKey').placeholder = s.hasApiKey ? t('apiKeySet') : 'sk-ant-…';
  $('#keyHint').textContent = t('apiKeyHint', { d: S.dataDir });
  const a = S.ai, st = ok => ok ? `<span class="st y">● ${t('available')}</span>` : `<span class="st n">○ ${t('unavailable')}</span>`;
  $('#sAi').innerHTML = [['auto', t('aiAuto')], ['claude-cli', t('aiCli')], ['anthropic', t('aiApi')], ['ollama', t('aiOllama')], ['off', t('aiOff')]]
    .map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#sAi').value = s.ai;
  $('#aiStatus').innerHTML = `${t('aiCli')} ${st(a['claude-cli'])} · ${t('aiApi')} ${st(a.anthropic)} · Ollama ${st(a.ollama)}`;
  $('#sOllama').innerHTML = a.ollamaModels.map(m => `<option>${esc(m)}</option>`).join('') || '<option value="">–</option>';
  $('#sOllama').value = s.ollamaModel || a.ollamaModels[0] || '';
  syncAiFields();
  $('#settings').classList.add('on');
}
function syncAiFields() {
  const v = $('#sAi').value;
  $('#fModel').hidden = !['auto', 'claude-cli', 'anthropic'].includes(v);
  $('#fKey').hidden = !['auto', 'anthropic'].includes(v);
  $('#fOllama').hidden = !['auto', 'ollama'].includes(v) || !S.ai.ollama;
}
function closeSettings() { $('#settings').classList.remove('on'); }
async function saveSettings() {
  const body = { threads: +$('#sThreads').value, prescan: $('#sPrescan').checked, cachePermanent: $('#sCache').checked,
    ai: $('#sAi').value, model: $('#sModel').value, ollamaModel: $('#sOllama').value };
  if ($('#sKey').value.trim()) body.apiKey = $('#sKey').value.trim();
  S = await api('/api/settings', body);
  setLang($('#sLang').value);
  closeSettings(); toast(t('saved')); pollScan();
  if (cur && onScreen('deckScreen')) render();
}
function setLang(l) {
  lang = l; try { localStorage.setItem('lang', l); } catch {}
  applyI18n();
  if (onScreen('start')) goStart($('#step2').hidden ? 1 : 2);
  else if (onScreen('deckScreen') && cur) render();
  else if (onScreen('review')) renderReview();
  else if (onScreen('classic')) renderClassic();
  if (typeof updateModeBtn === 'function') updateModeBtn();
}

// ---------- wiring ----------
$('#logo').onclick = goStart;
$('#trayBtn').onclick = openReview;
$('#langBtn').onclick = () => setLang(lang === 'en' ? 'de' : 'en');
$('#setBtn').onclick = openSettings;
$('#setClose').onclick = closeSettings;
$('#setSave').onclick = saveSettings;
$('#settings').onclick = e => { if (e.target.id === 'settings') closeSettings(); };
$('#sThreads').oninput = e => $('#thrVal').textContent = e.target.value;
$('#sAi').onchange = syncAiFields;
$('#aUndo').onclick = undo; $('#aSkip').onclick = skipFolder;
$('#aDel').onclick = () => decide('l'); $('#aKeep').onclick = () => decide('r');
$('#aAsk').onclick = () => decide('u'); $('#aForever').onclick = () => decide('d');
$('#doneOther').onclick = () => goStart(2);
$('#backMode').onclick = () => goStart(1);
document.querySelectorAll('.mode').forEach(b => b.onclick = () => chooseMode(b.dataset.mode)); $('#doneReview').onclick = openReview;
$('#revBack').onclick = backFromReview; $('#doDelete').onclick = doDelete;
$('#saveImg').onclick = saveImg; $('#copyImg').onclick = copyImg;
$('#resContinue').onclick = () => (reviewFrom === 'classic' && cls.path ? openClassic(cls.path) : cur ? (show('deckScreen'), render()) : goStart());

(async () => {
  applyI18n();
  S = await api('/api/state');
  goStart();
  pollScan();
})();
