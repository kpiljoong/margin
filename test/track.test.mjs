// node --test (npm test): suggesting — tracked changes in one text (public/track.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { combine, original, proposed, reconcile, provisional, strike, runs, overlay, hunksOf, pairLines } from '../public/track.js';

const { buildHunks, applyHunks } = createRequire(import.meta.url)('../lib/diff.js');
// The text with its marks written out: [-struck-] {+written in+}.
const show = ({ text, marks }) => {
  let s = '';
  let open = 'b';
  for (let i = 0; i <= text.length; i++) {
    const m = i < text.length ? marks[i] : 'b';
    if (m !== open) { s += open === 'd' ? '-]' : open === 'i' ? '+}' : ''; s += m === 'd' ? '[-' : m === 'i' ? '{+' : ''; open = m; }
    if (i < text.length) s += text[i];
  }
  return s;
};
const both = (st) => [original(st.text, st.marks), proposed(st.text, st.marks)];

test('combine: base and work in one text, each side kept whole', () => {
  const cases = [
    ['a very good plan\n', 'a good plan\n', 'a [-very -]good plan\n'],
    ['# Plan\n\none\ntwo\n', '# Plan\n\none\n', '# Plan\n\none\n[-two\n-]'],
    ['a\nb', 'a', 'a[-\nb-]'],
    ['a', 'a\nb', 'a{+\nb+}'],
    ['x\n', 'new\nx\n', '{+new\n+}x\n'],
    ['one\ntwo\nthree', 'uno\ntwo', '[-one-]{+uno+}\ntwo[-\nthree-]'],
    ['', 'hello', '{+hello+}'],
    ['hello', '', '[-hello-]'],
    ['same\n', 'same\n', 'same\n'],
  ];
  for (const [base, work, want] of cases) {
    const st = combine(base, work);
    assert.deepEqual(both(st), [base, work], `${JSON.stringify(base)} → ${JSON.stringify(work)}`);
    assert.equal(show(st), want);
  }
});

test('typing writes in pen; deleting the note\'s own text strikes it', () => {
  let st = combine('We ship on Monday.', 'We ship on Monday.');
  // Type " soon" after "ship" (caret 7 → 12).
  let next = `${st.text.slice(0, 7)} soon${st.text.slice(7)}`;
  st = reconcile(st, next, [7, 7], 12);
  assert.equal(show(st), 'We ship{+ soon+} on Monday.');
  // ⌫ three times from after "Monday" (caret 22): struck, the caret goes left.
  let caret = 22;
  for (let n = 0; n < 3; n++) {
    next = st.text.slice(0, caret - 1) + st.text.slice(caret);
    st = reconcile(st, next, [caret, caret], caret - 1);
    assert.equal(st.restored, true);
    caret = st.caret;
  }
  assert.equal(caret, 19);
  assert.equal(show(st), 'We ship{+ soon+} on Mon[-day-].');
  // ⌫ over pen text takes it away for good.
  next = st.text.slice(0, 11) + st.text.slice(12);
  st = reconcile(st, next, [12, 12], 11);
  assert.equal(st.restored, false);
  assert.equal(show(st), 'We ship{+ soo+} on Mon[-day-].');
  assert.deepEqual(both(st), ['We ship on Monday.', 'We ship soo on Mon.']);
});

test('typing over a selection strikes it and writes the new words after it', () => {
  let st = combine('a good plan', 'a good plan');
  const next = 'a great plan';
  st = reconcile(st, next, [2, 6], 7);
  assert.equal(show(st), 'a [-good-]{+great+} plan');
  assert.equal(st.caret, 11);
  // ⌦ at the start of "plan" (after the space): struck, the caret goes past it.
  const at = st.text.indexOf('plan');
  st = reconcile(st, st.text.slice(0, at) + st.text.slice(at + 1), [at, at], at);
  assert.equal(st.caret, at + 1);
  assert.equal(show(st), 'a [-good-]{+great+} [-p-]lan');
});

test('a composing input method is shown as pen and settled at the end', () => {
  const st = combine('abc', 'abc');
  assert.equal(provisional(st, 'ab한c'), 'bbib');
  const done = reconcile(st, 'ab한c', null, 3);
  assert.equal(show(done), 'ab{+한+}c');
});

test('strike: a line, then the same again takes the strike back', () => {
  let st = combine('one\ntwo\nthree\n', 'one\ntwo\nthree\n');
  st = strike(st, 4, 8);
  assert.equal(show(st), 'one\n[-two\n-]three\n');
  assert.deepEqual(both(st), ['one\ntwo\nthree\n', 'one\nthree\n']);
  st = strike(st, 4, 8);
  assert.equal(st.struck, false);
  assert.equal(show(st), 'one\ntwo\nthree\n');
  // Pen text in the range goes, the note's own is struck.
  st = reconcile(combine('a b', 'a b'), 'a X b', [2, 2], 4);
  st = strike(st, 0, st.text.length);
  assert.equal(show(st), '[-a b-]');
});

test('runs and overlay: marks wrapped around text, never across tags', () => {
  const st = reconcile(combine('**bold** word', '**bold** word'), '**bold** new word', [9, 9], 13);
  assert.deepEqual(runs(st.marks), [[9, 13, 'i']]);
  const html = '<span class="md-mark">**</span><span class="md-strong">bold</span><span class="md-mark">**</span> new word';
  assert.equal(overlay(html, st.marks), '<span class="md-mark">**</span><span class="md-strong">bold</span><span class="md-mark">**</span> <span class="tr-i">new </span>word');
  const s2 = combine('a&b\nc', 'a&b');
  assert.equal(overlay('a&amp;b\nc', s2.marks), 'a&amp;b<span class="tr-nl tr-d"></span>\n<span class="tr-d">c</span>');
});

test('hunksOf: as the server builds them', () => {
  const base = 'intro\n\n- one one\n- two  two\n\nend\nmore\n';
  const work = 'intro\n\n- one\n- two two\n\nend\n';
  const strip = (hs) => hs.map(({ baseStart, baseEnd, removed, added }) => ({ baseStart, baseEnd, removed, added }));
  assert.deepEqual(strip(hunksOf(base, work)), strip(buildHunks(base, work)));
});

test('a line struck among lines changed: each still a change of its own', () => {
  const base = '# M\n\n- ship by the end of the month\n- notes by Mina did did\n- beta for a week\n- load test needed\n';
  const work = '# M\n\n- ship by the 25th\n- notes by Mina did\n- load test needed, Tae next week\n';
  assert.deepEqual(pairLines(['a b c d', 'x y z'], ['a b c', 'q', 'x y z w']), [[['a b c d'], ['a b c']], [[], ['q']], [['x y z'], ['x y z w']]]);
  const hs = buildHunks(base, work);
  assert.deepEqual(hs.map((h) => [h.removed.length, h.added.length]), [[1, 1], [1, 1], [1, 0], [1, 1]]);
  const strip = (x) => x.map(({ baseStart, baseEnd, removed, added }) => ({ baseStart, baseEnd, removed, added }));
  assert.deepEqual(strip(hunksOf(base, work)), strip(hs));
  // Each taken alone, all of them, or none: the text as it should be.
  assert.equal(applyHunks(base, hs, new Set([0, 1, 2, 3])), work);
  assert.equal(applyHunks(base, hs, new Set([2])), base.replace('- beta for a week\n', ''));
  // In the editor: word marks on each line, the struck one whole.
  const st = combine(base, work);
  assert.deepEqual(both(st), [base, work]);
  assert.match(show(st), /- ship by the \[-end of the month-\]\{\+25th\+\}\n/);
  assert.match(show(st), /\[-- beta for a week\n-\]/);
});
