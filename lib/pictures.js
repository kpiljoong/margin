'use strict';
// The pictures notes show, for tasks about pictures: an agent sees them in
// its staged copy, and is told their size in pixels (the ```ink notation's
// coordinates). Plain logic, tested without a server (test/pictures.test.mjs).
const path = require('path');

const PICTURE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

// The workspace paths of the local pictures `text` (the note at `note`)
// shows: ![alt](rel/path.png), and ![[name.png]] found by its name among
// `files` (the workspace's paths). Never outside the folder, never remote.
function picturesIn(text, note, files = []) {
  const out = new Set();
  const add = (p) => { if (p && PICTURE_EXT.has(path.posix.extname(p).toLowerCase())) out.add(p); };
  for (const m of String(text).matchAll(/!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) {
    let url = m[1];
    if (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('//')) continue;
    try { url = decodeURI(url.split('#')[0].split('?')[0]); } catch { continue; }
    const rel = url.startsWith('/') ? url.slice(1) : path.posix.join(path.posix.dirname(note), url);
    const norm = path.posix.normalize(rel);
    if (norm.startsWith('../') || norm === '..' || path.posix.isAbsolute(norm)) continue;
    add(norm);
  }
  for (const m of String(text).matchAll(/!\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const name = m[1].trim();
    const near = path.posix.join(path.posix.dirname(note), name);
    add(files.includes(near) ? near : files.find((f) => f === name || f.endsWith(`/${name}`)));
  }
  return [...out];
}

// A picture's width and height in pixels from its first bytes (PNG, GIF,
// JPEG, WebP, an SVG's width/height or viewBox), or null.
function pictureSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.toString('ascii', 0, 3) === 'GIF') return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
    if (kind === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
  const svg = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!svg) return null;
  const num = (name) => { const v = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(svg); return v ? Number(v[1]) : null; };
  const w = num('width');
  const h = num('height');
  if (w && h) return [Math.round(w), Math.round(h)];
  const box = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  return box ? [Math.round(Number(box[1])), Math.round(Number(box[2]))] : null;
}

module.exports = { PICTURE_EXT, picturesIn, pictureSize };
