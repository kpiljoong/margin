// node --test (npm test): the editor's own undo history (public/undo.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { UndoHistory, diff } from '../public/undo.js';

const apply = (v, c) => v.slice(0, c.at) + c.insert + v.slice(c.at + c.remove);

test('a change is found where the caret was, also in repeated text', () => {
  assert.deepEqual(diff('a', 'aa', 0), { at: 0, removed: '', inserted: 'a' });
  assert.deepEqual(diff('a', 'aa', 1), { at: 1, removed: '', inserted: 'a' });
  assert.deepEqual(diff('one two', 'one 2', 4), { at: 4, removed: 'two', inserted: '2' });
});

test('typing in one run is one step; a new word after a space starts another', () => {
  const h = new UndoHistory('');
  let v = '';
  let t = 0;
  for (const c of 'hi there') { const before = v.length; v += c; h.record(v, [before, before], [v.length, v.length], (t += 50)); }
  let c = h.undo();
  v = apply(v, c);
  assert.equal(v, 'hi ');
  c = h.undo();
  v = apply(v, c);
  assert.equal(v, '');
  assert.deepEqual(c.sel, [0, 0]);
  v = apply(v, h.redo());
  v = apply(v, h.redo());
  assert.equal(v, 'hi there');
  assert.equal(h.redo(), null);
});

test('a pause, a new line or a caret move ends a step; backspaces join', () => {
  const h = new UndoHistory('ab');
  h.record('abc', [2, 2], [3, 3], 0);
  h.record('abcd', [3, 3], [4, 4], 5000);
  assert.equal(apply('abcd', h.undo()), 'abc');
  const g = new UndoHistory('abc');
  g.record('ab', [3, 3], [2, 2], 0);
  g.record('a', [2, 2], [1, 1], 100);
  assert.equal(apply('a', g.undo()), 'abc', 'backspaces in a row are one step');
  const k = new UndoHistory('');
  k.record('a', [0, 0], [1, 1], 0);
  k.close();
  k.record('ab', [1, 1], [2, 2], 10);
  assert.equal(apply('ab', k.undo()), 'a');
});

test('a new change clears redo', () => {
  const h = new UndoHistory('x');
  h.record('xy', [1, 1], [2, 2], 0);
  h.undo();
  h.record('xz', [1, 1], [2, 2], 5000);
  assert.equal(h.redo(), null);
});
