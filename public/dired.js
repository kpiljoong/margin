// A folder as text (Emacs's dired, with wdired's editing): one line for each
// thing in it, folders ending in "/". Edit the lines and the edits are a
// plan — a name changed is a rename, a path changed a move ("../x", "/x"
// from the top of the workspace, "archive/" into that folder), a line gone
// the trash, a new line a new note (or a folder, ending in "/"). The plan is
// looked at as any change is, line by line, before anything happens. Plain
// logic, tested without a page (test/dired.test.mjs).

import { hunksOf } from './track.js';

const NOTE = /\.(md|markdown|mdx|txt)$/i;
const RESERVED = new Set(['.git', 'node_modules', '.agent-notes', '.DS_Store', '.obsidian', '.trash']);
const base = (p) => p.replace(/\/$/, '').split('/').pop();
const parent = (p) => { const i = p.replace(/\/$/, '').lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const extOf = (p) => (/\.[^./]+$/.exec(base(p)) || [''])[0];

// What is in `dir` ('' the top): [{ name, path, folder }], folders first.
// files: the workspace's file paths; dirs: its folders (empty ones too).
export function listing(files, dirs, dir) {
  const pre = dir ? `${dir}/` : '';
  const folders = new Set();
  const names = [];
  for (const p of [...files, ...dirs.map((d) => `${d}/`)]) {
    if (!p.startsWith(pre)) continue;
    const rest = p.slice(pre.length);
    const i = rest.indexOf('/');
    if (i < 0) { if (rest) names.push(rest); } else if (i > 0) folders.add(rest.slice(0, i));
  }
  const by = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return [
    ...[...folders].sort(by).map((n) => ({ name: `${n}/`, path: pre + n, folder: true })),
    ...names.sort(by).map((n) => ({ name: n, path: pre + n, folder: false })),
  ];
}

// A line of the listing → where it means, from `dir`: { path, folder } or
// { error }. "/x" is from the top, ".." goes up.
export function resolveLine(dir, line) {
  const folder = line.endsWith('/');
  const parts = line.startsWith('/') ? [] : dir ? dir.split('/') : [];
  for (const part of line.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return { error: 'that is outside the workspace' }; parts.pop(); continue; }
    if (RESERVED.has(part)) return { error: `“${part}” is kept for Margin and git` };
    if (/[\\\0-\x1f]/.test(part)) return { error: 'a name can’t have \\ or control characters' };
    parts.push(part);
  }
  if (!parts.length) return { error: 'that is the top of the workspace' };
  return { path: parts.join('/'), folder };
}

// The listing as a note (for the red pen and the result): a list, the names
// kept from Markdown (only what would turn into something else: old_draft.md
// stays as it reads).
const md = (name) => `- ${name.replace(/[\\`*[\]<]/g, '\\$&')}`;
export const plainLine = (l) => l.replace(/^- /, '').replace(/\\(.)/g, '$1');

// The edits of `text` (the listing of `dir` as edited) as a plan: hunks as
// a run's (each one to take or leave), with what each does.
// exists(path) → is something there now.
// → { base, hunks: [{ baseStart, baseEnd, removed, added, before, after, ops, problem }] }
// ops: { op: 'rename' | 'move' | 'trash' | 'note' | 'folder', from?, to?, folder? }.
export function planDired(dir, entries, text, exists) {
  const baseLines = entries.map((e) => e.name);
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
  const raw = hunksOf(baseLines.join('\n'), lines.join('\n'));
  // A line only moved within the listing changes nothing.
  const gone = new Map();
  for (const hk of raw) for (const l of hk.removed) gone.set(l, (gone.get(l) || 0) + 1);
  const same = new Map();
  for (const hk of raw) for (const l of hk.added) if (gone.get(l) > (same.get(l) || 0)) same.set(l, (same.get(l) || 0) + 1);
  const left = new Map(same);
  const right = new Map(same);
  const take = (m, l) => { if (m.get(l) > 0) { m.set(l, m.get(l) - 1); return false; } return true; };
  const byName = new Map(entries.map((e) => [e.name, e]));
  const taken = new Set();
  const leaving = new Set();
  const hunks = [];
  const mdBase = baseLines.map(md);
  for (const hk of raw) {
    const R = hk.removed.filter((l) => take(left, l));
    const A = hk.added.filter((l) => take(right, l));
    const ops = [];
    let problem = null;
    const no = (why) => { problem ||= why; };
    // Lines changed one for one are renames; when lines went or came too
    // (and aren't alike, see track.js pairLines), they go and come.
    // A folder that is there already can't be made, so a line naming one
    // ("../archive/") is where a gone line went: the one beside it.
    let pairs;
    if (R.length === A.length) pairs = R.map((r, k) => [r, A[k]]);
    else {
      const free = R.map((r) => r);
      pairs = [];
      A.forEach((a, k) => {
        const to = resolveLine(dir, a);
        const i = to.folder && !to.error && exists(to.path) ? (free[k] != null ? k : free.findIndex((r) => r != null)) : -1;
        if (i >= 0) { pairs.push([free[i], a]); free[i] = null; } else pairs.push([null, a]);
      });
      pairs.unshift(...free.filter((r) => r != null).map((r) => [r, null]));
    }
    for (const [r, a] of pairs) {
      const from = r != null ? byName.get(r) : null;
      if (r != null && !from) { no(`“${r}” isn’t in this folder`); continue; }
      if (a == null) { ops.push({ op: 'trash', from: from.path, folder: from.folder }); leaving.add(from.path); continue; }
      const to = resolveLine(dir, a);
      if (to.error) { no(`${a}: ${to.error}`); continue; }
      let dest = to.path;
      if (from) {
        // "archive/" for a note: into that folder, with its name.
        if (to.folder && !from.folder) dest = `${dest}/${base(from.path)}`;
        else if (!from.folder && NOTE.test(from.path) && !extOf(dest)) dest += extOf(from.path);
        if (dest === from.path) continue;
        if (from.folder && (dest + '/').startsWith(`${from.path}/`)) { no(`${from.name} can’t go into itself`); continue; }
        ops.push({ op: parent(dest) === parent(from.path) ? 'rename' : 'move', from: from.path, to: dest, folder: from.folder });
        leaving.add(from.path);
      } else if (to.folder) ops.push({ op: 'folder', to: dest, folder: true });
      else {
        if (!extOf(dest)) dest += '.md';
        if (!NOTE.test(dest)) { no(`${a}: only notes and folders can be made here`); continue; }
        ops.push({ op: 'note', to: dest });
      }
    }
    for (const o of ops) {
      if (!o.to) continue;
      const key = o.to.toLowerCase();
      if (taken.has(key)) no(`two lines go to ${o.to}`);
      taken.add(key);
    }
    if (!ops.length && !problem) continue;
    const at = hk.baseStart;
    const end = hk.baseStart + hk.removed.length;
    hunks.push({ baseStart: at, baseEnd: end, removed: hk.removed.map(md), added: hk.added.map(md),
      before: mdBase.slice(Math.max(0, at - 2), at), after: mdBase.slice(end, end + 2), ops, problem });
  }
  // Something there already (and not on its way out) can't be written over.
  for (const hk of hunks) {
    for (const o of hk.ops) {
      if (o.to && exists(o.to) && !leaving.has(o.to) && o.to.toLowerCase() !== (o.from || '').toLowerCase()) hk.problem ||= `${o.to} is there already`;
    }
  }
  return { base: mdBase.join('\n'), hunks };
}

// One line on what a hunk does, for its note in the margin.
export function describeOps(ops, dir) {
  const rel = (p) => (dir && p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : `/${p}`);
  return ops.map((o) => {
    if (o.op === 'rename') return `Rename ${base(o.from)} → ${base(o.to)}${o.folder ? '' : ' (links follow)'}`;
    if (o.op === 'move') return `Move ${base(o.from)} → ${rel(o.to)}${o.folder ? '' : ' (links follow)'}`;
    if (o.op === 'trash') return `${base(o.from)}${o.folder ? '/' : ''} to the trash (it can be restored)`;
    if (o.op === 'folder') return `New folder ${rel(o.to)}/`;
    return `New note ${rel(o.to)}`;
  }).join(' · ');
}

// The order to do them in: away to the trash first (a name may be taken
// again), then new folders, renames and moves, then new notes.
export function orderOps(ops) {
  const rank = { trash: 0, folder: 1, rename: 2, move: 2, note: 3 };
  return [...ops].sort((a, b) => rank[a.op] - rank[b.op]);
}
