// node --test (npm test): Emacs keys in the editor (public/emacs.js) — the
// text commands as plain functions, the kill ring, and key names.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  killLineRange, recase, transposeChars, transposeWords, transposeLines, joinLine, spaceAround, deleteBlankLines,
  zapRange, paragraphEdge, displayWidth, fillParagraph, sortLines, trimTrailing, occurLines, occurPattern, expansions,
  sentenceEdge, countText, indentLines, cursorInfo,
  KillRing, keyName, commandOf, emacsCommands, emacsName, keysOf, prefixKeys, EmacsKeys, emacs, PREFIX_HELP_DELAY,
} from '../public/emacs.js';

// Apply an edit { from, to, text, caret } to v.
const apply = (v, x) => ({ v: v.slice(0, x.from) + x.text + v.slice(x.to), caret: x.caret });

test('C-k: to the line end, the line break when only blanks are left, n lines', () => {
  const v = 'one two\n  \nthree';
  assert.deepEqual(killLineRange(v, 4), [4, 7]);
  assert.deepEqual(killLineRange(v, 7), [7, 8], 'at the end: the line break');
  assert.deepEqual(killLineRange(v, 8), [8, 11], 'only blanks: them and the break');
  assert.deepEqual(killLineRange(v, 4, 2), [4, 11]);
  assert.deepEqual(killLineRange(v, 13, 0), [11, 13], '0: back to the line start');
  assert.deepEqual(killLineRange(v, 13, -1), [8, 13]);
});

test('case, transposes, join, spaces, blank lines, zap', () => {
  assert.equal(recase('hello wORLD x1', 'cap'), 'Hello World X1');
  assert.equal(recase('\uD55C\uAE00 abc', 'up'), '\uD55C\uAE00 ABC');
  assert.deepEqual(apply('abc', transposeChars('abc', 1)), { v: 'bac', caret: 2 });
  assert.deepEqual(apply('abc', transposeChars('abc', 3)).v, 'acb', 'at the end: the two before');
  assert.equal(transposeChars('abc', 0), null);
  assert.deepEqual(apply('one two three', transposeWords('one two three', 3)), { v: 'two one three', caret: 7 });
  assert.deepEqual(apply('one two three', transposeWords('one two three', 5)), { v: 'one three two', caret: 13 }, 'in a word: it and the next');
  assert.equal(apply('a\nb\nc', transposeLines('a\nb\nc', 3)).v, 'b\na\nc');
  assert.deepEqual(apply('one\n   two', joinLine('one\n   two', 6)), { v: 'one two', caret: 3 });
  assert.equal(joinLine('one', 1), null, 'no line before');
  assert.deepEqual(apply('a    b', spaceAround('a    b', 3, 1)), { v: 'a b', caret: 2 });
  assert.equal(apply('a    b', spaceAround('a    b', 3, 0)).v, 'ab');
  assert.equal(apply('a\n\n\n\nb', deleteBlankLines('a\n\n\n\nb', 3)).v, 'a\n\nb');
  assert.deepEqual(zapRange('find the x here', 0, 'x'), [0, 10]);
  assert.deepEqual(zapRange('a.b.c', 0, '.', 2), [0, 4]);
  assert.deepEqual(zapRange('a.b.c', 5, '.', -1), [3, 5]);
  assert.equal(zapRange('abc', 0, 'z'), null);
});

test('paragraphs: their edges, filling and unfilling', () => {
  const v = 'one\ntwo\n\nthree\nfour\n\nfive';
  assert.equal(paragraphEdge(v, 0, 1), 8);
  assert.equal(paragraphEdge(v, 12, -1), 8);
  const long = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
  const filled = apply(long, fillParagraph(long, 0, 30)).v;
  assert.ok(filled.split('\n').every((l) => l.length <= 30), filled);
  assert.equal(filled.replace(/\n/g, ' '), long);
  // A list item keeps its marker, the lines after it line up under the text.
  const item = `- ${long}`;
  const lines = apply(item, fillParagraph(item, 3, 30)).v.split('\n');
  assert.ok(lines[0].startsWith('- word0') && lines.slice(1).every((l) => l.startsWith('  word')), lines.join('|'));
  // A quote keeps its > on every line; unfilling makes one line again.
  const quote = `> ${long}`;
  const q = apply(quote, fillParagraph(quote, 3, 30)).v;
  assert.ok(q.split('\n').every((l) => l.startsWith('> ')), q);
  assert.equal(apply(q, fillParagraph(q, 3, Infinity)).v, quote);
  assert.equal(fillParagraph(long, 0, 200), null, 'nothing to fill');
  // Korean characters are two columns wide.
  assert.equal(displayWidth('\uD55C\uAE00ab'), 6);
});

test('sentences: M-e to their ends, M-a to their starts (a heading, a list item, a blank line end one too)', () => {
  const v = 'One two. Three? "Four!" Five\n\n# Head\n- item a\n1. num one. More\n\n\uC624\uB298\uC740 \uBE44. \uB0B4\uC77C\uC740 \uB9D1\uB2E4.\n**Done.** End';
  const ends = [];
  for (let p = 0, q; (q = sentenceEdge(v, p, 1)) !== p; p = q) ends.push(v.slice(0, q).split(/\s/).at(-1));
  assert.deepEqual(ends, ['two.', 'Three?', '"Four!"', 'Five', 'Head', 'a', 'one.', 'More', '\uBE44.', '\uB9D1\uB2E4.', '**Done.**', 'End']);
  const starts = [];
  for (let p = v.length, q; (q = sentenceEdge(v, p, -1)) !== p; p = q) starts.push(v.slice(q).split(/\s/)[0]);
  assert.deepEqual(starts, ['End', '**Done.**', '\uB0B4\uC77C\uC740', '\uC624\uB298\uC740', 'More', 'num', 'item', 'Head', 'Five', '"Four!"', 'Three?', 'One']);
  assert.equal(sentenceEdge('a.b c', 0, 1), 5, 'no space after: not an end');
  assert.equal(sentenceEdge('\uAC00。\uB098', 0, 1), 2, 'a full-width stop needs no space');
  assert.equal(sentenceEdge('One. Two', 4, -1), 0, 'in the spaces after an end: back to that sentence');
  assert.equal(sentenceEdge('One. Two', 5, -1), 0, 'at a start: the one before');
});

test('M-= counts; C-x TAB indents lines, keeping places; C-x = says where', () => {
  assert.deepEqual(countText('one two\n\uC138 \uB2E8\uC5B4\n'), { lines: 2, words: 4, chars: 13 });
  assert.deepEqual(countText(''), { lines: 0, words: 0, chars: 0 });
  const v = 'a\n  b\n\n\tc\nd';
  const x = indentLines(v, 0, 9, 2);
  assert.equal(apply(v, x).v, '  a\n    b\n\n\t  c\nd', 'the blank line stays empty; d is not in it');
  assert.equal(x.map(4), 8, 'b is still b');
  assert.equal(x.map(10), 16);
  assert.equal(apply(v, indentLines(v, 2, 6, -4)).v, 'a\nb\n\n\tc\nd', 'not past the margin; b ends at a line start: not that line');
  assert.equal(apply(v, indentLines(v, 8, 8, -1)).v, 'a\n  b\n\n c\nd', 'a tab is two columns');
  assert.equal(cursorInfo('ab\n\uD55Cc', 3), 'Char: \uD55C (54620, U+D55C) point=4 of 5 (60%) line=2 column=0');
  assert.equal(cursorInfo('ab\nc', 2), 'Char: C-j (10, U+000A) point=3 of 4 (50%) line=1 column=2');
  assert.match(cursorInfo('ab', 2), /end of note/);
});

test('sorting lines, trailing spaces (a Markdown line break stays)', () => {
  assert.equal(sortLines('b\nA\nc'), 'A\nb\nc');
  assert.equal(sortLines('b\nA\nc', true), 'c\nb\nA');
  assert.deepEqual(trimTrailing('a  \nb \t\nc'), { text: 'a  \nb\nc', count: 1 });
  assert.deepEqual(trimTrailing('a   \n  \n'), { text: 'a  \n\n', count: 2 });
});

test('occur: the lines that match, case by the query', () => {
  const text = 'Apple pie\nbanana\napple tart, apple jam\n';
  assert.deepEqual(occurLines(text, occurPattern('apple')).map((x) => [x.line, x.ranges]), [[1, [[0, 5]]], [3, [[0, 5], [12, 17]]]]);
  assert.deepEqual(occurLines(text, occurPattern('Apple')).map((x) => x.line), [1], 'a capital: case matters');
  assert.deepEqual(occurLines(text, occurPattern('ap+le (t|j)')).map((x) => x.line), [3]);
  assert.deepEqual(occurLines('a (b\nc', occurPattern('(b')).map((x) => x.line), [1], 'not a regular expression: as typed');
});

test('M-/: words of the note that start the same, the nearest before first, then after', () => {
  const v = 'alphabet alpine\nal and alpha';
  const x = expansions(v, 18);
  assert.equal(x.prefix, 'al');
  assert.equal(x.start, 16);
  assert.deepEqual(x.list, ['alpine', 'alphabet', 'alpha']);
  assert.deepEqual(expansions('one ', 4).list, []);
});

test('the kill ring: kills in a row join, M-y goes round', () => {
  const ring = new KillRing(3);
  ring.push('one');
  ring.push(' two', 'append');
  assert.equal(ring.current(), 'one two');
  ring.push('zero ', 'prepend');
  assert.equal(ring.current(), 'zero one two');
  ring.push('b');
  ring.push('c');
  ring.push('b');
  assert.deepEqual(ring.items, ['b', 'c', 'zero one two'], 'the same text again moves to the front; the oldest go');
  assert.equal(ring.rotate(1), 'c');
  assert.equal(ring.rotate(2), 'b');
});

test('key names, and the commands on them', () => {
  const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...o });
  assert.equal(keyName(ev({ key: 'x', code: 'KeyX', ctrlKey: true }), true), 'C-x');
  assert.equal(keyName(ev({ key: 'ß', code: 'KeyS', altKey: true }), true), 'M-s', 'option types ß: the key, not the letter');
  assert.equal(keyName(ev({ key: '%', code: 'Digit5', altKey: true, shiftKey: true }), true), 'M-%');
  assert.equal(keyName(ev({ key: ' ', code: 'Space', ctrlKey: true }), true), 'C-SPC');
  assert.equal(keyName(ev({ key: 'Backspace', code: 'Backspace', altKey: true }), true), 'M-DEL');
  assert.equal(keyName(ev({ key: 'Escape', code: 'Escape' }), true), 'ESC');
  assert.equal(keyName(ev({ key: 's', code: 'KeyS', metaKey: true }), true), null, 'the command key is the app’s');
  assert.equal(keyName(ev({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }), false), null, 'AltGr types');
  assert.equal(commandOf('C-x C-s'), 'save-buffer');
  assert.equal(commandOf('C-x r j'), 'jump-to-register');
  assert.equal(commandOf('M-s o'), 'occur');
  assert.equal(commandOf('C-k'), 'kill-line');
  assert.equal(commandOf('C-x q'), null);
  assert.equal(keyName(ev({ key: '@', code: 'Digit2', altKey: true, shiftKey: true }), true), 'M-@');
  assert.equal(keyName(ev({ key: '=', code: 'Equal', altKey: true }), true), 'M-=');
  assert.deepEqual(['M-a', 'M-e', 'M-k', 'M-=', 'M-@', 'C-x DEL', 'C-x TAB', 'C-x ='].map(commandOf),
    ['backward-sentence', 'forward-sentence', 'kill-sentence', 'count-words-region', 'mark-word', 'backward-kill-sentence', 'indent-rigidly', 'what-cursor-position']);
});

test('M-x: the commands by Emacs’s names, with their keys', () => {
  const list = emacsCommands();
  const by = (n) => list.find((c) => c.name === n);
  assert.deepEqual(by('save-buffer'), { cmd: 'save-buffer', name: 'save-buffer', keys: 'C-x C-s', doc: 'Save' });
  assert.equal(by('set-mark-command').keys, 'C-SPC');
  assert.equal(by('kill-ring-save').keys, 'M-w');
  assert.equal(by('sort-lines').keys, '', 'on no key: by name only');
  assert.ok(!list.some((c) => ['universal-argument', 'ctl-x', 'keyboard-quit', 'meta-prefix'].includes(c.cmd)), 'prefixes are keys only');
  assert.deepEqual(keysOf('point-to-register'), ['C-x r SPC', 'C-x r C-SPC', 'C-x r C-@']);
  assert.equal(emacsName('redo'), 'undo-redo');
});

test('the keys after a prefix, as the help shows them: a command\'s keys together, a prefix in it "+its name"', () => {
  const x = prefixKeys('C-x');
  assert.deepEqual(x.find((k) => k.cmd === 'save-buffer'), { keys: ['C-s'], cmd: 'save-buffer', doc: 'Save' });
  assert.deepEqual(x.find((k) => k.cmd === 'split-window').keys, ['2', '3']);
  assert.equal(x.find((k) => k.keys[0] === 'r').doc, '+registers');
  assert.equal(x.find((k) => k.keys[0] === 'n').doc, '+narrow');
  assert.deepEqual(prefixKeys('C-x n').map((k) => k.keys[0]), ['n', 'w']);
  assert.deepEqual(prefixKeys('nope'), []);
});

test('C-x and a pause: its keys show (? or C-h: at once); the next key hides them, C-x r after them shows its own at once', (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); emacs.on = false; emacs.hooks = {}; });
  emacs.on = true;
  const shown = [];
  emacs.hooks = { prefixHelp: (map) => shown.push(map), echo: () => {} };
  const ed = { extra: [], find: { open: false }, ta: { selectionStart: 0, selectionEnd: 0, value: '' } };
  const keys = new EmacsKeys(ed);
  const press = (code, ctrlKey = false, key = code.slice(-1).toLowerCase()) => keys.key({ code, key, ctrlKey, altKey: false, shiftKey: false, metaKey: false, preventDefault() {} });
  // Typed on at once: nothing shows.
  press('KeyX', true);
  mock.timers.tick(PREFIX_HELP_DELAY - 100);
  press('KeyG', true);
  mock.timers.tick(1000);
  assert.deepEqual(shown, []);
  // A pause: shown; the next key hides them.
  press('KeyX', true);
  mock.timers.tick(PREFIX_HELP_DELAY);
  assert.deepEqual(shown, ['C-x']);
  press('KeyR');
  assert.deepEqual(shown, ['C-x', null, 'C-x r'], 'r, a prefix: its keys at once');
  press('KeyG', true);
  assert.deepEqual(shown.at(-1), null);
  // ? right after C-x: at once, and C-x still waits.
  shown.length = 0;
  press('KeyX', true);
  keys.key({ code: 'Slash', key: '?', ctrlKey: false, altKey: false, shiftKey: true, metaKey: false, preventDefault() {} });
  assert.deepEqual(shown, ['C-x']);
  assert.deepEqual(keys.pending, { map: 'C-x' });
  press('KeyG', true);
  assert.deepEqual(shown, ['C-x', null]);
  assert.equal(keys.pending, null);
});
