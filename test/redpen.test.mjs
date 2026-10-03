// node --test (npm test): the red pen view's marks (public/redpen.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { penSource, wordOps } from '../public/redpen.js';
import { renderMarkdown } from '../public/markdown.js';

const { buildHunks, applyHunks, mergeHunks } = createRequire(import.meta.url)('../lib/diff.js');
// The marks written out: [-gone-] [+inline+] [^line^] [@anchor@], with the key.
const show = (s) => s.replace(/\uE000(.)/gu, (_, c) => `[-${c.charCodeAt(0).toString(16).slice(-1)}:`)
  .replace(/\uE002(.)/gu, (_, c) => `[+${c.charCodeAt(0).toString(16).slice(-1)}:`)
  .replace(/\uE005(.)/gu, (_, c) => `[^${c.charCodeAt(0).toString(16).slice(-1)}:`)
  .replace(/\uE006(.)/gu, (_, c) => `[@${c.charCodeAt(0).toString(16).slice(-1)}:`)
  .replace(/\uE001/g, ']');
const pen = (a, b, comments) => penSource(a, buildHunks(a, b), comments);

test('words: what goes and what comes, deletions first', () => {
  assert.deepEqual(wordOps('a very good plan', 'a good plan'), [['=', 'a '], ['-', 'very '], ['=', 'good plan']]);
  assert.deepEqual(wordOps('the cat sat', 'the dog sat'), [['=', 'the '], ['-', 'cat'], ['+', 'dog'], ['=', ' sat']]);
  assert.deepEqual(wordOps('one two', 'uno dos'), [['-', 'one two'], ['+', 'uno dos']]);
});

test('a changed line: the words struck and written in, after the list bullet', () => {
  const r = pen('# Plan\n\n- a very good plan for the the team\n- next\n', '# Plan\n\n- a good plan for the team\n- next\n');
  assert.equal(show(r.text), '# Plan\n\n- a [-0:very ]good plan for the [-0:the ]team\n- next\n');
  assert.deepEqual(r.marks.map((m) => [m.key, m.kind, m.line]), [['h0', 'hunk', 2]]);
  // Still a list item when rendered.
  assert.match(renderMarkdown(r.text).replace(/[\uE000-\uEFFF]/g, ''), /<li[^>]*>a very good plan for the the team</);
});

test('lines added and removed whole; headings keep their hashes', () => {
  const r = pen('# Old title\n\ntext\n', '## New title\n\ntext\n\nA new line.\n');
  assert.equal(show(r.text), '# [-0:Old title]\n## [^0:New title]\n\ntext\n\n[^1:A new line.]\n');
  assert.deepEqual(r.marks.map((m) => m.key), ['h0', 'h1']);
});

test('fences and table rules stay unmarked; only spaces changed shows a pilcrow', () => {
  const r = pen('text\n', 'text\n\n```js\nx()\n```\n');
  assert.equal(show(r.text), 'text\n\n```js\n[^0:x()]\n```\n');
  const s = pen('a  \nb\n', 'a\nb\n');
  assert.equal(show(s.text), 'a[-0:  ]\n[-0:¶]\nb\n');
});

test('comments: with their change, on the words they quote, or in general', () => {
  const base = '# Plan\n\nThis is a very good plan.\n\nWe ship on Monday.\n';
  const r = pen(base, base.replace('a very good', 'a good'), [
    { n: 0, quote: 'very good', suggest: 'good', comment: 'Filler word.', made: true },
    { n: 1, quote: 'ship on Monday', comment: 'Which Monday?' },
    { n: 2, quote: 'not in the note', comment: 'Overall: clear.' },
  ]);
  assert.equal(show(r.text), '# Plan\n\nThis is a [-0:very ]good plan.\n\nWe [@1:ship on Monday].\n');
  assert.deepEqual(r.marks.map((m) => [m.key, m.notes.map((c) => c.comment)]), [['h0', ['Filler word.']], ['n1', ['Which Monday?']]]);
  assert.deepEqual(r.general.map((c) => c.comment), ['Overall: clear.']);
});

test('a comment on a heading is anchored after its hashes', () => {
  const r = penSource('# Plan\n\ntext\n', [], [{ n: 3, quote: '# Plan', comment: 'Reads well.' }]);
  assert.equal(show(r.text), '# [@3:Plan]\n\ntext\n');
});

test('lines changed one for one are a change each: one can be taken alone, also over the user\'s edits', () => {
  const base = 'intro\n\n- one one\n- two  two\n- three three\n\nend\n';
  const work = 'intro\n\n- one\n- two two\n- three\n\nend\n';
  const hunks = buildHunks(base, work);
  assert.deepEqual(hunks.map((h) => [h.baseStart, h.baseEnd, h.before.length, h.after.length]), [[2, 3, 2, 0], [3, 4, 0, 0], [4, 5, 0, 3]]);
  assert.equal(applyHunks(base, hunks, new Set([1])), 'intro\n\n- one one\n- two two\n- three three\n\nend\n');
  assert.equal(applyHunks(base, hunks, new Set([0, 1, 2])), work);
  const merged = mergeHunks(base, `${base}more\n`, hunks, new Set([0, 2]));
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.text, 'intro\n\n- one\n- two  two\n- three\n\nend\nmore\n');
  assert.equal(penSource(base, hunks).marks.length, 3);
});

test('notes on overlapping words: the second takes the rest, or joins the first', () => {
  const r = penSource('We ship the docs and the video by the 20th.\n', [], [
    { n: 0, quote: 'the docs and the video by the 20th', comment: 'Which docs?' },
    { n: 1, quote: 'by the 20th.', comment: 'Which month?' },
    { n: 2, quote: 'the video', comment: 'Who films it?' },
    { n: 3, quote: 'ship the docs', comment: 'Ship how?' },
  ]);
  assert.equal(show(r.text), 'We [@3:ship ][@0:the docs and the video by the 20th].\n');
  assert.deepEqual(r.marks.map((m) => [m.key, m.notes.map((c) => c.comment)]), [['n3', ['Ship how?']], ['n0', ['Which docs?', 'Which month?', 'Who films it?']]]);
  assert.deepEqual(r.general, []);
});
