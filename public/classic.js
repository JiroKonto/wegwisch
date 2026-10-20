'use strict';
// Classic mode: an explorer-style table with real sizes. Shares the delete pile, AI and keep-list with swipe mode.

let viewMode = 'swipe';
try { viewMode = localStorage.getItem('viewMode') || 'swipe'; } catch {}
const cls = { path: null, parent: null, items: [], waiting: 0, sort: 'size', dir: -1, filter: '', limit: 300, timer: null, tree: null, treeAt: 0, showMap: true };
try { cls.showMap = localStorage.getItem('cMap') !== '0'; } catch {}
const sepOf = p => /^[a-z]:[\\/]/i.test(p || '') ? '\\' : '/';

function setViewMode(m) {
  viewMode = m;
  try { localStorage.setItem('viewMode', m); } catch {}
  document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}
function openFolder(p) { exploreQ = []; viewMode === 'classic' ? openClassic(p) : openDir(p); }

async function openClassic(p) {
  clearTimeout(cls.timer); clearTimeout(pollT); cur = null; mode = 'dir';
  Object.assign(cls, { path: p, parent: null, items: [], waiting: 1, filter: '', limit: 300, tree: null, treeAt: 0 });
  $('#cMap').innerHTML = '';
  $('#cFilter').value = '';
  $('#crumbs').textContent = ''; show('classic'); updateModeBtn();
  renderClassic();
  await refreshClassic();
}
async function refreshClassic() {
  clearTimeout(cls.timer);
  const p = cls.path;
  let r;
  try { r = await api('/api/list?path=' + enc(p)); } catch { return; }
  if (cls.path !== p || !onScreen('classic')) return;
  if (r.error) { toast('⚠ ' + r.error + ': ' + p); return cls.parent ? openClassic(cls.parent) : goStart(); }
  cls.items = r.items; cls.parent = r.parent; cls.waiting = r.waiting;
  renderClassic();
  if (cls.showMap && (!r.waiting || Date.now() - cls.treeAt > 2500)) {
    cls.treeAt = Date.now();
    try { const tr = await api('/api/tree?path=' + enc(p)); if (cls.path === p && !tr.error) { cls.tree = tr; renderMap(); renderClassic(); } } catch {}
  }
  if (r.waiting > 0 && cls.path === p) cls.timer = setTimeout(refreshClassic, 1200);
}

// "C:\Users\alex" -> [["C:", "C:\"], ["Users", "C:\Users"], ["alex", "C:\Users\alex"]]
function crumbParts(p) {
  const win = /^[a-z]:[\\/]/i.test(p), sep = win ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean), out = [];
  if (!win) out.push(['/', '/']);
  let acc = '';
  parts.forEach((s, i) => {
    acc = win ? (i === 0 ? s + sep : (i === 1 ? acc : acc + sep) + s) : acc + '/' + s;
    out.push([s, acc]);
  });
  return out;
}

function sortedClassic() {
  const f = cls.filter.toLowerCase();
  const list = cls.items.filter(i => !f || i.name.toLowerCase().includes(f));
  const k = cls.sort, d = cls.dir;
  list.sort((a, b) => {
    if (k === 'name') return d * a.name.localeCompare(b.name, lang, { numeric: true });
    return d * ((a[k] ?? -1) - (b[k] ?? -1)) || a.name.localeCompare(b.name);
  });
  return list;
}

function classicBadge(it) {
  if (it.junk) return `<span class="cbadge junk" title="${esc(t('junk.' + it.junk))}">🧹</span>`;
  if (it.level === 'locked') return `<span class="cbadge locked" title="${esc(t('reason.' + it.reason))}">🔒</span>`;
  if (it.level === 'caution') return `<span class="cbadge caution" title="${esc(t('reason.' + it.reason))}">⚠</span>`;
  return '';
}

function renderClassic() {
  if (!onScreen('classic')) return;
  $('#cPath').innerHTML = crumbParts(cls.path).map(([n, p]) => `<button data-go="${esc(p)}">${esc(n)}</button>`).join('<i>›</i>');
  $('#cPath').querySelectorAll('[data-go]').forEach(b => b.onclick = () => openClassic(b.dataset.go));
  $('#cUp').disabled = !cls.parent;
  $('#cFilter').placeholder = t('cFilter');
  document.querySelectorAll('.chead [data-sort]').forEach(b => {
    b.classList.toggle('on', b.dataset.sort === cls.sort);
    b.textContent = t(b.dataset.t) + (b.dataset.sort === cls.sort ? (cls.dir < 0 ? ' ↓' : ' ↑') : '');
  });

  const total = cls.items.reduce((s, i) => s + (i.size || 0), 0);
  const max = Math.max(1, ...cls.items.map(i => i.size || 0));
  const files = cls.items.reduce((s, i) => s + (i.files || 0), 0);
  const dirs = cls.items.filter(i => i.isDir).length;
  let picked = 0;
  cls.items.forEach(i => { if (delQ.has(i.path)) picked += i.size || 0; });
  $('#cInfo').innerHTML = `<span><b>${fmt(total)}</b> · ${t('cEntries', { n: num(cls.items.length) })} · ${t('files', { n: num(files) })}</span>` +
    (cls.waiting ? `<span>⏳ ${t('calcProgress', { done: dirs - cls.waiting, n: dirs })}</span>` : '') +
    (picked ? `<span style="color:var(--del)">🗑 ${t('cPicked', { s: fmt(picked) })}</span>` : '');

  const list = sortedClassic();
  if (!list.length) {
    $('#cRows').innerHTML = `<div class="cempty">${cls.waiting && !cls.items.length ? t('calc') + '…' : t('cEmpty')}</div>`;
    return;
  }
  const rows = list.slice(0, cls.limit).map(it => {
    const locked = !canDelete(it), on = delQ.has(it.path);
    const pct = it.size != null && total ? it.size / total * 100 : null;
    const ans = answers.get(it.path);
    return `<div class="crow ${on ? 'picked' : ''}" data-p="${esc(it.path)}">
      <input type="checkbox" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} title="${esc(locked ? t('reason.' + it.reason) : t('del'))}">
      <span>${icon(it)}</span>
      <div class="cname"><span class="n ${it.isDir ? 'dir' : ''}" title="${esc(it.name)}">${esc(it.name)}</span>${classicBadge(it)}</div>
      <div class="csize"><div class="bar"><i style="width:${it.size != null ? Math.max(1, it.size / max * 100) : 0}%${tmColor.has(it.path) ? ';background:' + tmColor.get(it.path) : ''}"></i></div><span class="${it.size == null ? 'unk' : ''}">${it.size == null ? '…' : fmt(it.size)}</span></div>
      <span class="cpct">${pct == null ? '' : pct < 1 ? '&lt;1' : Math.round(pct)}</span>
      <span class="cfiles">${it.isDir ? (it.files == null ? '…' : num(it.files)) : ''}</span>
      <span class="cdate">${new Date(it.mtime).toLocaleDateString(lang)}</span>
      <div class="cact">
        ${S.provider ? `<button data-a="ask" title="${esc(t('ask'))}">✦</button>` : ''}
        <button data-a="keep" title="${esc(t('forever'))}">🔒</button>
        <button data-a="reveal" title="${esc(t('reveal'))}">↗</button>
      </div>
      ${ans !== undefined ? `<div class="canswer">${askBox(ans)}</div>` : ''}
    </div>`;
  }).join('');
  $('#cRows').innerHTML = rows + (list.length > cls.limit ? `<div class="cmore"><button class="btn" id="cMore">${t('cMore', { n: num(list.length - cls.limit) })}</button></div>` : '');
  if ($('#cMore')) $('#cMore').onclick = () => { cls.limit += 500; renderClassic(); };
}

// one delegated handler for the whole table
$('#cRows').addEventListener('click', async e => {
  const row = e.target.closest('.crow'); if (!row) return;
  const it = cls.items.find(i => i.path === row.dataset.p); if (!it) return;
  if (e.target.matches('input[type=checkbox]')) {
    if (e.target.checked) delQ.set(it.path, { ...it, permanent: permanentDefault(it) }); else delQ.delete(it.path);
    updateTray(); renderClassic(); markMap(); return;
  }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'reveal') return api('/api/reveal', { path: it.path });
  if (a === 'keep') {
    await api('/api/keep', { path: it.path });
    toast(t('foreverToast', { n: it.name }));
    cls.items = cls.items.filter(i => i !== it); delQ.delete(it.path); updateTray();
    return renderClassic();
  }
  if (a === 'ask') {
    if (answers.get(it.path) === null) return;
    answers.set(it.path, null); renderClassic();
    answers.set(it.path, await api('/api/ask', { path: it.path, lang }));
    return renderClassic();
  }
  if (e.target.closest('.n.dir')) openClassic(it.path);
});
$('#cRows').addEventListener('dblclick', e => {
  const row = e.target.closest('.crow');
  const it = row && cls.items.find(i => i.path === row.dataset.p);
  if (it?.isDir && !e.target.closest('input,button')) openClassic(it.path);
});
document.querySelectorAll('.chead [data-sort]').forEach(b => b.onclick = () => {
  if (cls.sort === b.dataset.sort) cls.dir *= -1;
  else { cls.sort = b.dataset.sort; cls.dir = b.dataset.sort === 'name' ? 1 : -1; }
  renderClassic();
});
$('#cUp').onclick = () => cls.parent && openClassic(cls.parent);
$('#cFilter').oninput = e => { cls.filter = e.target.value; cls.limit = 300; renderClassic(); };
document.addEventListener('keydown', e => {
  if (!onScreen('classic') || e.target.closest?.('input,select')) return;
  if (e.key === 'Backspace' && cls.parent) { e.preventDefault(); openClassic(cls.parent); }
});

// switch view for the folder you're in
function updateModeBtn() {
  const inDeck = onScreen('deckScreen') && mode === 'dir' && cur, inCls = onScreen('classic');
  $('#modeBtn').hidden = !(inDeck || inCls);
  $('#modeBtn').textContent = inCls ? '🃏 ' + t('modeSwipe') : '📊 ' + t('modeClassic');
}
$('#modeBtn').onclick = () => {
  if (onScreen('classic')) { setViewMode('swipe'); clearTimeout(cls.timer); exploreQ = []; openDir(cls.path); }
  else if (cur && mode === 'dir') { setViewMode('classic'); openClassic(cur.path); }
};
setViewMode(viewMode);

// ---------- block view ----------
function renderMap() {
  const el = $('#cMap');
  el.hidden = !cls.showMap;
  $('#cMapBtn').classList.toggle('on', cls.showMap);
  $('#cMapBtn').title = t('mapToggle');
  if (!cls.showMap || !onScreen('classic')) return;
  drawTreemap(el, cls.tree, { onOpen: p => openClassic(p), onPick: flashRow, isPicked: p => delQ.has(p), sep: sepOf(cls.path) });
}
function markMap() { document.querySelectorAll('#cMap .tm-box[data-p]').forEach(b => b.classList.toggle('picked', delQ.has(b.dataset.p))); }
function flashRow(p) {
  const row = [...document.querySelectorAll('#cRows .crow')].find(r => r.dataset.p === p); if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
}
$('#cMapBtn').onclick = () => {
  cls.showMap = !cls.showMap;
  try { localStorage.setItem('cMap', cls.showMap ? '1' : '0'); } catch {}
  if (cls.showMap && !cls.tree) refreshClassic(); else renderMap();
};
// hover links block <-> row
const hl = (sel, p, on) => document.querySelectorAll(sel).forEach(e => e.classList.toggle('hl', on && e.dataset.p === p));
$('#cRows').addEventListener('mouseover', e => { const r = e.target.closest('.crow'); hl('#cMap .tm-box', r?.dataset.p, !!r); });
$('#cRows').addEventListener('mouseleave', () => hl('#cMap .tm-box', null, false));
$('#cMap').addEventListener('mouseover', e => { const b = e.target.closest('.tm-box'); hl('#cRows .crow', b?.dataset.p, !!b); });
$('#cMap').addEventListener('mouseleave', () => hl('#cRows .crow', null, false));
let mapRz;
new ResizeObserver(() => { clearTimeout(mapRz); mapRz = setTimeout(renderMap, 120); }).observe($('#cMap'));
