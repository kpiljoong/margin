'use strict';
// Watching the workspace: onEvent(type, rel) for each change under root
// (rel null: something changed, it is not said what).
//
// On Linux, Node's recursive fs.watch watches each file by itself. A file
// replaced by a rename — as Margin saves, atomically — keeps a watch on the
// file that was there before, so whatever another program writes to the
// note after that is never seen (test/watch.test.mjs). There a folder is
// watched instead, each one: a folder's watch sees every file in it, as it is
// now. Elsewhere the recursive watch is the system's own (FSEvents,
// ReadDirectoryChangesW) and sees them.
const fs = require('fs');
const path = require('path');

const MAX_DIRS = 20000;

// skip(name): a file or folder name not to look into.
// → { close(), on(event, fn) } — 'error' when it can't go on.
function watchTree(root, { skip = () => false, onEvent, perFolder = process.platform === 'linux', io = fs } = {}) {
  if (!perFolder) return io.watch(root, { recursive: true }, (type, filename) => onEvent(type, filename ? String(filename).split(path.sep).join('/') : null));

  const watchers = new Map(); // rel ('' the root) → FSWatcher
  const listeners = [];
  let closed = false;
  const fail = (e) => { for (const fn of listeners) fn(e); };
  const add = (rel) => {
    if (closed || watchers.has(rel)) return;
    if (watchers.size >= MAX_DIRS) { fail(new Error('Too many folders to watch.')); return; }
    const abs = rel ? path.join(root, rel) : root;
    let w;
    try {
      w = io.watch(abs, (type, filename) => {
        if (!filename) { onEvent(type, rel || null); return; }
        const name = String(filename);
        const child = rel ? `${rel}/${name}` : name;
        // A folder made or moved in: watched too, and what is in it.
        if (type === 'rename' && !skip(name)) {
          let st = null;
          try { st = io.statSync(path.join(abs, name)); } catch { /* gone */ }
          if (st?.isDirectory()) addTree(child);
          else if (!st) drop(child);
        }
        onEvent(type, child);
      });
    } catch (e) {
      if (!rel) throw e;
      return; // gone already, or not readable
    }
    w.on('error', () => { drop(rel); if (!rel) fail(new Error('The workspace folder is gone.')); });
    watchers.set(rel, w);
  };
  const addTree = (rel) => {
    add(rel);
    let entries = [];
    try { entries = io.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !e.isSymbolicLink() && !skip(e.name)) addTree(rel ? `${rel}/${e.name}` : e.name);
  };
  // A folder gone: its watch and those under it.
  const drop = (rel) => {
    for (const [k, w] of watchers) {
      if (k === rel || k.startsWith(`${rel}/`)) { try { w.close(); } catch { /* closed */ } watchers.delete(k); }
    }
  };
  addTree('');
  return {
    close() { closed = true; for (const w of watchers.values()) { try { w.close(); } catch { /* closed */ } } watchers.clear(); },
    on(event, fn) { if (event === 'error') listeners.push(fn); return this; },
    get size() { return watchers.size; },
  };
}

module.exports = { watchTree };
