'use strict';
// WinDirStat-style block view: squarified treemap, two levels deep, cushion-shaded cells.
const TM_COLORS = ['#ff4d6d', '#a78bfa', '#2fd47a', '#4ea8ff', '#ffb547', '#f472b6', '#22d3ee', '#a3e635', '#fb923c', '#c084fc'];
const tmColor = new Map(); // path -> color, so the list can use the same colors

// Squarified layout (Bruls et al.): rows of rectangles with aspect ratios as close to 1 as possible.
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const k = (w * h) / total;
  const rest = items.map(i => ({ ...i, a: i.v * k }));
  const worst = (row, side) => {
    const s = row.reduce((t, r) => t + r.a, 0), mx = Math.max(...row.map(r => r.a)), mn = Math.min(...row.map(r => r.a));
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const place = row => {
    const s = row.reduce((t, r) => t + r.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; row.forEach(r => { const rh = r.a / cw; out.push({ ...r, x, y: cy, w: cw, h: rh }); cy += rh; }); x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; row.forEach(r => { const rw = r.a / rh; out.push({ ...r, x: cx, y, w: rw, h: rh }); cx += rw; }); y += rh; h -= rh; }
  };
  let row = [];
  while (rest.length) {
    const side = Math.min(w, h), next = rest[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) row.push(rest.shift());
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

const pos = (el, r, g) => Object.assign(el.style, { left: r.x + g + 'px', top: r.y + g + 'px', width: Math.max(0, r.w - 2 * g) + 'px', height: Math.max(0, r.h - 2 * g) + 'px' });

function drawTreemap(el, data, { onOpen, onPick, isPicked, sep }) {
  const W = el.clientWidth, H = el.clientHeight;
  el.innerHTML = '';
  tmColor.clear();
  if (!data || !W || !H) return;
  const items = data.items.filter(i => i.size > 0);
  const frag = document.createDocumentFragment();
  let ci = 0;
  for (const r of squarify(items.map(it => ({ v: it.size, it })), 0, 0, W, H)) {
    const it = r.it, col = it.other ? '#454b60' : TM_COLORS[ci++ % TM_COLORS.length];
    if (it.path) tmColor.set(it.path, col);
    const box = document.createElement('div');
    box.className = 'tm-box' + (it.isDir ? ' dir' : ' file') + (it.other ? ' other' : '') + (it.path && isPicked(it.path) ? ' picked' : '');
    box.style.setProperty('--c', col);
    if (it.path) box.dataset.p = it.path;
    box.title = `${it.name} · ${fmt(it.size)}`;
    pos(box, r, 1);
    const head = r.h > 36 && r.w > 64;
    if (head) box.innerHTML = `<div class="tm-h"><b>${esc(it.name)}</b><span>${fmt(it.size)}</span></div>`;
    if (it.children?.length && r.w > 36 && r.h > 44) {
      const top = head ? 22 : 3;
      squarify(it.children.map(c => ({ v: c.size, c })), 3, top, r.w - 6, r.h - top - 3).forEach((s, j) => {
        const cell = document.createElement('div');
        cell.className = 'tm-cell' + (s.c.other ? ' other' : '');
        cell.style.setProperty('--l', j % 6);
        cell.title = `${it.name}${sep}${s.c.name} · ${fmt(s.c.size)}`;
        if (s.c.isDir && !s.c.other) cell.dataset.sub = it.path + sep + s.c.name;
        if (s.w > 74 && s.h > 32) cell.innerHTML = `<span>${esc(s.c.name)}</span><small>${fmt(s.c.size)}</small>`;
        pos(cell, s, .5);
        box.appendChild(cell);
      });
    } else if (!head && r.w > 50 && r.h > 20) box.innerHTML = `<div class="tm-h"><b>${esc(it.name)}</b></div>`;
    frag.appendChild(box);
  }
  el.appendChild(frag);
  el.onclick = e => {
    const sub = e.target.closest('.tm-cell')?.dataset.sub;
    if (sub) return onOpen(sub);
    const box = e.target.closest('.tm-box'); if (!box?.dataset.p) return;
    const it = items.find(i => i.path === box.dataset.p);
    it.isDir ? onOpen(it.path) : onPick(it.path);
  };
}
