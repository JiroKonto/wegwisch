// Runs from source, or as a single executable (Node SEA) where UI files and the worker are embedded assets.
const fs = require('fs');
const path = require('path');

let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }

const ROOT = sea ? path.dirname(process.execPath) : path.join(__dirname, '..');
const PUBLIC = path.join(__dirname, '..', 'public');

// a file from public/, or null
function publicFile(rel) {
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return null;
  if (sea) { try { return Buffer.from(sea.getAsset('public/' + rel)); } catch { return null; } }
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return fs.readFileSync(file);
}

// [source, options] for new Worker()
function workerSource() {
  if (sea) return [sea.getAsset('scan-worker.js', 'utf8'), { eval: true }];
  return [path.join(__dirname, 'scan-worker.js'), {}];
}

module.exports = { isSea: !!sea, ROOT, publicFile, workerSource };
