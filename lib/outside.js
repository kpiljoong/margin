'use strict';
// Changes from outside, kept on disk, so a restart loses nothing:
//
// - the changes waiting for review (DATA_DIR/outside/<key>.json): each note's
//   text from before the first change, until it is looked at;
// - what Margin last saw of each note (DATA_DIR/seen/: an index of path →
//   hash, size and time, and the texts themselves, gzipped, one per hash), so
//   a note changed, made or deleted while it was closed is found when it
//   opens, as a change from outside like any other.
//
// Both live in .agent-notes/ (ignored by git), beside the history.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

function writeAtomic(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
}

// The changes waiting for review: a Map (rel → { before, since, at }) that
// writes itself through. A file it can't write stays in memory.
class OutsideStore extends Map {
  constructor(dir) {
    super();
    this.dir = dir;
    const found = [];
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* none yet */ }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (typeof e.rel !== 'string' || !(e.before === null || typeof e.before === 'string')) continue;
        found.push([e.rel, { before: e.before, since: Number(e.since) || Date.now(), at: Number(e.at) || Date.now() }]);
      } catch { /* a broken one is let go */ }
    }
    // Oldest first, as they came: the first to go when there are too many.
    for (const [rel, e] of found.sort((a, b) => a[1].since - b[1].since)) super.set(rel, e);
  }
  file(rel) { return path.join(this.dir, `${sha(rel)}.json`); }
  set(rel, e) {
    super.set(rel, e);
    try { writeAtomic(this.file(rel), JSON.stringify({ rel, ...e })); } catch { /* kept in memory */ }
    return this;
  }
  delete(rel) {
    const had = super.delete(rel);
    try { fs.unlinkSync(this.file(rel)); } catch { /* not written */ }
    return had;
  }
  clear() { for (const rel of [...this.keys()]) this.delete(rel); }
}

// What Margin last saw of each note. `fresh` until there is an index on disk:
// the first time, nothing can be said about what changed before.
class Seen {
  constructor(dir) {
    this.dir = dir;
    this.blobs = path.join(dir, 'blobs');
    this.files = new Map(); // rel → { hash, size, mtimeMs }
    this.refs = new Map(); // hash → how many notes have that text
    this.fresh = true;
    this.timer = null;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      if (j && j.v === 1 && j.files && typeof j.files === 'object') {
        for (const [rel, e] of Object.entries(j.files)) {
          if (e && typeof e.hash === 'string' && /^[0-9a-f]{40}$/.test(e.hash)) this.add(rel, { hash: e.hash, size: Number(e.size) || 0, mtimeMs: Number(e.mtimeMs) || 0 });
        }
        this.fresh = false;
      }
    } catch { /* none yet, or unreadable: start again */ }
  }
  add(rel, e) {
    this.files.set(rel, e);
    this.refs.set(e.hash, (this.refs.get(e.hash) || 0) + 1);
  }
  drop(rel) {
    const e = this.files.get(rel);
    if (!e) return;
    this.files.delete(rel);
    const n = (this.refs.get(e.hash) || 1) - 1;
    if (n > 0) { this.refs.set(e.hash, n); return; }
    this.refs.delete(e.hash);
    try { fs.unlinkSync(this.blobFile(e.hash)); } catch { /* gone already */ }
  }
  blobFile(hash) { return path.join(this.blobs, hash.slice(0, 2), `${hash}.gz`); }
  // The note as last seen, or null.
  text(rel) {
    const e = this.files.get(rel);
    if (!e) return null;
    try { return zlib.gunzipSync(fs.readFileSync(this.blobFile(e.hash))).toString('utf8'); } catch { return null; }
  }
  entry(rel) { return this.files.get(rel) || null; }
  // Seen now: `text`, with the file's size and time.
  record(rel, text, st) {
    const hash = sha(text);
    const was = this.files.get(rel);
    const e = { hash, size: st.size, mtimeMs: st.mtimeMs };
    if (was && was.hash === hash) {
      if (was.size !== st.size || was.mtimeMs !== st.mtimeMs) { this.files.set(rel, e); this.later(); }
      return;
    }
    if (!this.refs.has(hash)) {
      try { writeAtomic(this.blobFile(hash), zlib.gzipSync(text)); } catch { return; }
    }
    if (was) this.drop(rel);
    this.add(rel, e);
    this.later();
  }
  forget(rel) {
    if (!this.files.has(rel)) return;
    this.drop(rel);
    this.later();
  }
  later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 1000);
    this.timer.unref?.();
  }
  // While fresh, only the first full look (force) writes the index: one
  // written half way would take the notes not in it yet for new ones.
  save(force = false) {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.fresh && !force) return;
    try {
      writeAtomic(path.join(this.dir, 'index.json'), JSON.stringify({ v: 1, files: Object.fromEntries(this.files) }));
      this.fresh = false;
    } catch { /* next time */ }
  }
  // Texts no note has any more (left by a crash between writes).
  sweep() {
    let dirs = [];
    try { dirs = fs.readdirSync(this.blobs); } catch { return; }
    for (const d of dirs) {
      let names = [];
      try { names = fs.readdirSync(path.join(this.blobs, d)); } catch { continue; }
      for (const n of names) if (!this.refs.has(n.replace(/\.gz$/, ''))) { try { fs.unlinkSync(path.join(this.blobs, d, n)); } catch { /* leave it */ } }
    }
  }
}

// What changed while Margin was closed: the notes now (`files`: rel → { size,
// mtimeMs }) against what it last saw. read(rel) → the text now, or null.
// → [{ rel, before, now, at }]: before null for a note made, now null for
// one deleted; a note whose old text is lost is left out (nothing to review
// it against) but seen anew.
function changedWhileAway(seen, files, read) {
  const out = [];
  if (seen.fresh) return out;
  for (const [rel, st] of files) {
    const e = seen.entry(rel);
    if (e && e.size === st.size && e.mtimeMs === st.mtimeMs) continue;
    const now = read(rel);
    if (now == null) continue;
    if (!e) { out.push({ rel, before: null, now, at: st.mtimeMs }); continue; }
    if (sha(now) === e.hash) continue;
    const before = seen.text(rel);
    if (before != null) out.push({ rel, before, now, at: st.mtimeMs });
  }
  for (const rel of [...seen.files.keys()]) {
    if (files.has(rel)) continue;
    const before = seen.text(rel);
    if (before != null) out.push({ rel, before, now: null, at: Date.now() });
  }
  return out;
}

module.exports = { OutsideStore, Seen, changedWhileAway };
