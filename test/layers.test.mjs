// node --test (npm test): layers on one note (public/layers.js) — the places
// of the lens and my comments as margin notes of the red pen, arcs nested,
// a fork's paragraph found on the marked note — and the film's change bars.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layerNotes, arcLevels, regionRows, forkWays, inUse, LAYERS } from '../public/layers.js';
import { penSource } from '../public/redpen.js';
import { changeAmount } from '../public/film.js';

test('the lens and my comments are on the note as margin notes, past the agent’s own', () => {
  const notes = layerNotes({
    lens: [{ i: 3, quotes: ['We ship', 'Monday'] }, { i: 5, quotes: ['dark'] }],
    mine: [{ quote: 'theme', text: 'why?' }],
  });
  assert.deepEqual(notes.map((x) => [x.layer, x.ref, x.quote, x.n]), [
    ['lens', 3, 'We ship', 1000], ['lens', 3, 'Monday', 1001], ['lens', 5, 'dark', 1002], ['mine', 0, 'theme', 1400],
  ]);
  assert.ok(notes.every((x) => x.comment === ''));
  assert.deepEqual(Object.keys(LAYERS), ['pen', 'lens', 'forks', 'mine']);
  // Marked on the note: an anchor each, of their own.
  const { text, marks } = penSource('We ship on Monday.\n\nA dark theme.\n', [], notes);
  assert.equal(marks.length, 4);
  assert.match(text, /\uE006/);
});

test('arcs nest: a short one inside, a long one round it', () => {
  assert.deepEqual(arcLevels([[0, 100], [10, 20], [30, 40]]), [2, 1, 1]);
  assert.deepEqual(arcLevels([[0, 100], [10, 90], [20, 30]]), [3, 2, 1]);
  // Apart, they all stay close in.
  assert.deepEqual(arcLevels([[0, 10], [20, 30]]), [1, 1]);
});

test('a fork’s paragraph on the marked note: its lines, and those of a change on it', () => {
  const base = '# T\n\nA b.\n\nEnd.\n';
  const hunks = [{ baseStart: 2, baseEnd: 3, removed: ['A b.'], added: ['- A.', '- b.'] }];
  const { text, rows } = penSource(base, hunks, []);
  assert.equal(rows.length, text.split('\n').length);
  assert.deepEqual([...regionRows(rows, hunks, 2, 3)], [2, 3, 4]);
  assert.deepEqual(rows.slice(5).map((r) => r.line), [3, 4, 5]);
  // A line only put in counts at either edge.
  const after = [{ baseStart: 3, baseEnd: 3, removed: [], added: ['More.'] }];
  const s = penSource(base, after, []);
  assert.deepEqual([...regionRows(s.rows, after, 2, 3)], [2, 3]);
  // No change: the paragraph's own lines.
  assert.deepEqual([...regionRows(penSource(base).rows, [], 4, 5)], [4]);
});

test('a fork’s ways: as it is, then each option; the one in use', () => {
  const fork = { quote: 'p', options: [{ text: 'a' }, { text: 'b' }], pick: null };
  assert.deepEqual(forkWays(fork), ['o', '0', '1']);
  assert.equal(inUse(fork), 'o');
  assert.equal(inUse({ ...fork, pick: 1 }), '1');
});

test('the film: a frame’s change, in characters taken out and put in', () => {
  assert.equal(changeAmount({ hunks: [{ removed: ['abc'], added: ['ab', 'c'] }, { removed: [], added: ['x'] }] }), 3 + 4 + 1);
  assert.equal(changeAmount({ kind: 'original' }), 0);
});
