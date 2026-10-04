// node --test (npm test): gather (public/gather.js) — a note's blocks as
// written, the note made of the pieces, moving one in the tray, and where a
// flick ends.
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksOf, gatheredText, moved, flickTo } from '../public/gather.js';

test('blocksOf: paragraphs, lists and headings as written; a fence whole; front matter left out', () => {
  const text = '---\ntags: [a]\n---\n# Title\nFirst line\nsecond line\n\n- one\n- two\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n## Next\n\nThe end.\n';
  assert.deepEqual(blocksOf(text), [
    { text: '# Title', line: 3 },
    { text: 'First line\nsecond line', line: 4 },
    { text: '- one\n- two', line: 7 },
    { text: '```js\nconst a = 1;\n\nconst b = 2;\n```', line: 10 },
    { text: '## Next', line: 15 },
    { text: 'The end.', line: 17 },
  ]);
  assert.deepEqual(blocksOf('a\r\n\r\n\u321c\ub2e8'), [{ text: 'a', line: 0 }, { text: '\u321c\ub2e8', line: 2 }]);
  // A fence never closed runs to the end.
  assert.deepEqual(blocksOf('x\n~~~\ncode'), [{ text: 'x', line: 0 }, { text: '~~~\ncode', line: 1 }]);
  assert.deepEqual(blocksOf(''), []);
});

test('gatheredText: the pieces in the order of the tray, and where they came from', () => {
  const pieces = [
    { path: 'sub/a.md', line: 2, text: 'We ship on Friday.\n' },
    { path: 'b.md', line: 0, text: '- one\n- two' },
    { path: 'sub/a.md', line: 6, text: 'The end.' },
  ];
  assert.equal(gatheredText(pieces, 'Friday'), '# Friday\n\nWe ship on Friday.\n\n- one\n- two\n\nThe end.\n\n---\nGathered from [[a]], [[b]].\n');
  assert.equal(gatheredText(pieces.slice(1, 2)), '- one\n- two\n\n---\nGathered from [[b]].\n');
});

test('moved: a piece from k by one, within the tray; the list itself unchanged', () => {
  const list = ['a', 'b', 'c'];
  assert.deepEqual(moved(list, 2, -1), ['a', 'c', 'b']);
  assert.deepEqual(moved(list, 0, 1), ['b', 'a', 'c']);
  assert.equal(moved(list, 0, -1), list);
  assert.equal(moved(list, 2, 1), list);
  assert.equal(moved(list, -1, 1), list);
  assert.deepEqual(list, ['a', 'b', 'c']);
});

test('flickTo: as far as it was pulled, and further when fast, within the cards', () => {
  assert.equal(flickTo(3, 0, 0, 8), 3);
  assert.equal(flickTo(3, 1, 0, 8), 2);
  assert.equal(flickTo(3, -0.4, 0, 8), 3);
  assert.equal(flickTo(3, -0.4, -8, 8), 5);
  assert.equal(flickTo(3, -2, -30, 8), 7);
  assert.equal(flickTo(1, 2, 10, 8), 0);
});
