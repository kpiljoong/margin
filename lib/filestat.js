'use strict';
// A file's stat, also on network shares that answer a file's path as a
// folder's. Seen with a macOS share of an exFAT disk, mounted on Windows: the
// path asked says folder, yet its folder's listing says file and the file
// reads fine. Then the file's own handle is asked, and if that says folder
// too, the file is taken as listed, its size from reading it.
const fs = require('fs');
const path = require('path');

const LISTING_MS = 2000;
const LISTINGS_MAX = 200;

function makeFileStat(io = fs) {
  const listings = new Map(); // dir → { at, files }
  const listedAsFile = (abs) => {
    const dir = path.dirname(abs);
    let hit = listings.get(dir);
    if (!hit || Date.now() - hit.at > LISTING_MS) {
      hit = { at: Date.now(), files: new Set() };
      try { for (const e of io.readdirSync(dir, { withFileTypes: true })) if (e.isFile()) hit.files.add(e.name); } catch { /* none */ }
      listings.delete(dir);
      listings.set(dir, hit);
      if (listings.size > LISTINGS_MAX) listings.delete(listings.keys().next().value);
    }
    return hit.files.has(path.basename(abs));
  };
  return function fileStat(abs) {
    const st = io.statSync(abs);
    if (!st.isDirectory() || !listedAsFile(abs)) return st;
    let own;
    try {
      const fd = io.openSync(abs, 'r');
      try { own = io.fstatSync(fd); } finally { io.closeSync(fd); }
    } catch { return st; }
    if (own.isFile()) return own;
    const { S_IFMT, S_IFREG } = fs.constants;
    return Object.assign(Object.create(Object.getPrototypeOf(own)), own, { size: io.readFileSync(abs).length, mode: (own.mode & ~S_IFMT) | S_IFREG });
  };
}

module.exports = { fileStat: makeFileStat(), makeFileStat };
