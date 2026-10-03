// node --test (npm test): keyboard macros (public/macro.js) do again what the
// keys did, so caret moves are worked out the way the browser makes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moveCaret, caretMove } from '../public/macro.js';

test('caret moves: characters, words, lines, the ends', () => {
  const v = 'one two\nthree\n\nfour';
  assert.equal(moveCaret(v, 0, 'right').pos, 1);
  assert.equal(moveCaret(v, 0, 'left').pos, 0);
  assert.equal(moveCaret(v, 0, 'wordRight').pos, 3);
  assert.equal(moveCaret(v, 3, 'wordRight').pos, 7);
  assert.equal(moveCaret(v, 7, 'wordLeft').pos, 4);
  assert.equal(moveCaret(v, 10, 'lineStart').pos, 8);
  assert.equal(moveCaret(v, 10, 'lineEnd').pos, 13);
  assert.equal(moveCaret(v, 10, 'docEnd').pos, v.length);
  assert.equal(moveCaret('😀a', 2, 'left').pos, 0, 'a surrogate pair is one character');
  assert.equal(moveCaret('한글 단어', 0, 'wordRight').pos, 2, 'Korean is a word');
});

test('up and down keep the column, through short lines', () => {
  const v = 'abcdef\nxy\nabcdef';
  const a = moveCaret(v, 5, 'down');
  assert.equal(a.pos, 9); // end of "xy"
  const b = moveCaret(v, a.pos, 'down', { goal: a.goal });
  assert.equal(b.pos, 15); // column 5 again
  assert.equal(moveCaret(v, 15, 'down').pos, v.length);
  assert.equal(moveCaret(v, 2, 'up').pos, 0);
});

test('which keys move the caret, on a Mac and elsewhere', () => {
  const k = (key, o = {}) => ({ key, code: o.code || key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o });
  assert.equal(caretMove(k('ArrowLeft', { altKey: true }), true), 'wordLeft');
  assert.equal(caretMove(k('ArrowLeft', { ctrlKey: true }), false), 'wordLeft');
  assert.equal(caretMove(k('ArrowRight', { metaKey: true }), true), 'lineEnd');
  assert.equal(caretMove(k('ArrowDown', { metaKey: true }), true), 'docEnd');
  assert.equal(caretMove(k('a', { code: 'KeyE', ctrlKey: true }), true), 'lineEnd', '⌃E (Emacs keys in macOS text)');
  assert.equal(caretMove(k('a', { code: 'KeyA', metaKey: true }), true), 'all');
  assert.equal(caretMove(k('x', { code: 'KeyX' }), true), null);
});
