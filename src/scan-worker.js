// Scans ONE directory level synchronously (real OS thread, so N workers = N parallel disk walkers).
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|xz)$/i;

parentPort.on('message', ({ id, dir }) => {
  let bytes = 0, files = 0, err = false, uproject = false;
  const dirs = [];
  const archives = [];
  try {
    const d = fs.opendirSync(dir);
    let e;
    while ((e = d.readSync()) !== null) {
      if (e.isSymbolicLink()) continue; // never follow links/junctions
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push(e.name); continue; }
      if (!e.isFile()) continue;
      try {
        const st = fs.lstatSync(fp);
        // space actually used on disk: sparse files (VM images) and cloud placeholders report far more than they occupy
        const size = typeof st.blocks === 'number' ? st.blocks * 512 : st.size;
        bytes += size; files++;
        if (ARCHIVE.test(e.name)) archives.push([e.name, size]);
        if (!uproject && e.name.toLowerCase().endsWith('.uproject')) uproject = true;
      } catch {}
    }
    d.closeSync();
  } catch { err = true; }
  // archive "X.zip" next to a folder "X" = probably already unpacked
  const lower = new Set(dirs.map(n => n.toLowerCase()));
  const dupArchives = archives.filter(([n]) => lower.has(n.replace(ARCHIVE, '').replace(/\.tar$/i, '').toLowerCase()));
  parentPort.postMessage({ id, bytes, files, dirs, err, uproject, dupArchives });
});
