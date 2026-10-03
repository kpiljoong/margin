// node --test (npm test): a folder edited as text, read as a plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listing, resolveLine, planDired, describeOps, orderOps, plainLine } from '../public/dired.js';

const FILES = ['notes/a.md', 'notes/b.md', 'notes/meeting 2026-10-01.md', 'notes/pics/x.png', 'notes/old_draft.md', 'top.md', 'archive/z.md'];
const DIRS = ['notes/empty'];

test('the listing: what is in the folder, folders first', () => {
  assert.deepEqual(listing(FILES, DIRS, 'notes').map((e) => e.name), ['empty/', 'pics/', 'a.md', 'b.md', 'meeting 2026-10-01.md', 'old_draft.md']);
  assert.deepEqual(listing(FILES, DIRS, '').map((e) => e.name), ['archive/', 'notes/', 'top.md']);
  assert.equal(listing(FILES, DIRS, 'notes')[1].path, 'notes/pics');
});

test('a line is a path from the folder; never outside the workspace', () => {
  assert.deepEqual(resolveLine('notes', '../archive/a.md'), { path: 'archive/a.md', folder: false });
  assert.deepEqual(resolveLine('notes', '/top2.md'), { path: 'top2.md', folder: false });
  assert.deepEqual(resolveLine('notes', 'sub/'), { path: 'notes/sub', folder: true });
  assert.match(resolveLine('notes', '../../x.md').error, /outside/);
  assert.match(resolveLine('', '.git/config').error, /kept/);
});

test('edits as a plan: rename, move, trash, new note and folder; a moved line is nothing', () => {
  const entries = listing(FILES, DIRS, 'notes');
  const exists = (p) => FILES.includes(p) || p === 'notes/empty' || p === 'notes/pics';
  const text = [
    'pics/', 'empty/', // swapped: nothing
    'alpha.md', // a.md renamed
    '../archive/', // b.md moved into archive
    'meeting 2026-10-01', // the same (the extension added back)
    // old_draft.md gone
    'ideas', 'later/',
  ].join('\n');
  const { base, hunks } = planDired('notes', entries, text, exists);
  assert.equal(base.split('\n')[5], '- old_draft.md');
  const ops = hunks.flatMap((h) => h.ops);
  assert.deepEqual(ops, [
    { op: 'rename', from: 'notes/a.md', to: 'notes/alpha.md', folder: false },
    { op: 'move', from: 'notes/b.md', to: 'archive/b.md', folder: false },
    { op: 'trash', from: 'notes/old_draft.md', folder: false },
    { op: 'note', to: 'notes/ideas.md' },
    { op: 'folder', to: 'notes/later', folder: true },
  ]);
  assert.ok(hunks.every((h) => !h.problem));
  assert.equal(describeOps(hunks[0].ops, 'notes'), 'Rename a.md → alpha.md (links follow)');
  assert.equal(describeOps([ops[1]], 'notes'), 'Move b.md → /archive/b.md (links follow)');
  assert.deepEqual(orderOps(ops).map((o) => o.op), ['trash', 'folder', 'rename', 'move', 'note']);
  // Hunks are shaped as a run's: context around, lines as the base has them.
  const h = hunks[0];
  assert.deepEqual([h.baseStart, h.baseEnd, h.removed, h.added], [2, 3, ['- a.md'], ['- alpha.md']]);
  assert.deepEqual(h.before, ['- empty/', '- pics/']);
  assert.equal(plainLine('- a\\*b.md'), 'a*b.md');
});

test('what can’t be done is said, on its own change', () => {
  const entries = listing(FILES, DIRS, 'notes');
  const exists = (p) => FILES.includes(p);
  const text = ['empty/', 'pics/', 'b.md', 'b.md', 'meeting 2026-10-01.md', '../../old.md'].join('\n');
  const { hunks } = planDired('notes', entries, text, exists);
  const problems = hunks.map((h) => h.problem).filter(Boolean);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /b\.md is there already/);
  assert.match(problems[1], /outside the workspace/);
  // b.md renamed away frees its name.
  const swap = planDired('notes', entries, ['empty/', 'pics/', 'b.md', 'c.md', 'meeting 2026-10-01.md', 'old_draft.md'].join('\n'), exists);
  assert.ok(swap.hunks.every((h) => !h.problem), JSON.stringify(swap.hunks));
});

test('a line naming a folder that is there is where the line beside it went', () => {
  const entries = listing(FILES, DIRS, 'notes');
  const exists = (p) => FILES.includes(p) || ['archive', 'notes/pics', 'notes/empty'].includes(p);
  // meeting… moved into archive, old_draft.md gone: one hunk, two lines for one.
  const text = ['empty/', 'pics/', 'a.md', 'b.md', '../archive/'].join('\n');
  const ops = planDired('notes', entries, text, exists).hunks.flatMap((h) => h.ops);
  assert.deepEqual(ops, [
    { op: 'trash', from: 'notes/old_draft.md', folder: false },
    { op: 'move', from: 'notes/meeting 2026-10-01.md', to: 'archive/meeting 2026-10-01.md', folder: false },
  ]);
});
