// node --test (npm test): marks drawn on a picture, as lines (public/ink.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInk, inkLine, simplify, addMark, removeMark } from '../public/ink.js';

test('ink lines: read, written back the same', () => {
  const src = ['box red: 280,120 200x80', '# a comment', 'arrow: 410,220 -> 300,160', 'text blue: 420,230 The button is hidden', 'pen 초록: 100,100 120,104 140,112', '상자 빨강: 1,2 3×4', 'nonsense', 'pen red: 1,2', 'arrow purple: 1,2 -> x'].join('\n');
  const { marks, bad } = parseInk(src);
  assert.deepEqual(marks.map((m) => [m.kind, m.color, m.line]), [['box', 'red', 0], ['arrow', 'red', 2], ['text', 'blue', 3], ['pen', 'green', 4], ['box', 'red', 5]]);
  assert.deepEqual(bad, [6, 7, 8]);
  assert.deepEqual(marks[0], { kind: 'box', color: 'red', line: 0, x: 280, y: 120, w: 200, h: 80 });
  assert.deepEqual(marks[2].text, 'The button is hidden');
  assert.equal(inkLine(marks[0]), 'box red: 280,120 200x80');
  assert.equal(inkLine(marks[1]), 'arrow red: 410,220 -> 300,160');
  assert.equal(inkLine(marks[2]), 'text blue: 420,230 The button is hidden');
  assert.equal(inkLine(marks[3]), 'pen green: 100,100 120,104 140,112');
  assert.equal(inkLine({ kind: 'pen', color: 'red', pts: [[1.4, 2.6], [3, 4]] }), 'pen red: 1,3 3,4');
});

test('a drawn line keeps its shape with fewer points; marks added and taken out', () => {
  const line = Array.from({ length: 50 }, (_, i) => [i, i < 25 ? 0 : i - 25]);
  const s = simplify(line, 0.5);
  assert.deepEqual(s, [[0, 0], [25, 0], [49, 24]]);
  assert.equal(addMark('', 'box red: 1,2 3x4'), 'box red: 1,2 3x4');
  assert.equal(addMark('a\n\n', 'b'), 'a\nb');
  assert.equal(removeMark('a\nb\nc', 1), 'a\nc');
});

test('a numbered dot: its centre and a short number or letter', () => {
  const { marks, bad } = parseInk(['num: 10,20 1', 'number blue: 5,6 A', '\uBC88\uD638: 1,2 12', 'num: 1,2 too long', 'num: 1,2'].join('\n'));
  assert.deepEqual(marks.map((m) => [m.kind, m.color, m.text, m.x, m.y]), [['num', 'red', '1', 10, 20], ['num', 'blue', 'A', 5, 6], ['num', 'red', '12', 1, 2]]);
  assert.deepEqual(bad, [3, 4]);
  assert.equal(inkLine(marks[0]), 'num red: 10,20 1');
});

test('a hidden part: gray unless a colour is given, also blur and in Korean', () => {
  const { marks, bad } = parseInk(['hide: 40,20 300x30', 'blur teal: 1,2 3x4', '\uAC00\uB9AC\uAE30: 5,6 7\u00D78', 'hide: 1,2'].join('\n'));
  assert.deepEqual(marks.map((m) => [m.kind, m.color, m.x, m.y, m.w, m.h]), [['hide', 'gray', 40, 20, 300, 30], ['hide', 'teal', 1, 2, 3, 4], ['hide', 'gray', 5, 6, 7, 8]]);
  assert.deepEqual(bad, [3]);
  assert.equal(inkLine(marks[0]), 'hide gray: 40,20 300x30');
});
