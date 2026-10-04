// node --test (npm test): marks drawn on a picture, as lines (public/ink.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInk, inkLine, simplify, addMark, removeMark, bentPath, movedMark, grips, reshapedMark, setMark, fitBoard, boardLine } from '../public/ink.js';

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

test('an arrow that bends: its bends in order, drawn round at them', () => {
  const { marks, bad } = parseInk(['arrow blue: 0,0 -> 100,0 -> 100,100', 'arrow: 1,2 → 3,4 → 5,6 → 7,8', 'arrow: 1,2 -> 3,4 -> x'].join('\n'));
  assert.deepEqual(marks.map((m) => [m.from, m.via, m.to]), [[[0, 0], [[100, 0]], [100, 100]], [[1, 2], [[3, 4], [5, 6]], [7, 8]]]);
  assert.deepEqual(bad, [2]);
  assert.equal(inkLine(marks[0]), 'arrow blue: 0,0 -> 100,0 -> 100,100');
  assert.equal(inkLine(parseInk('arrow: 1,2 -> 3,4').marks[0]), 'arrow red: 1,2 -> 3,4');
  assert.equal(bentPath([[0, 0], [100, 0], [100, 100]], 20), 'M0,0 L80,0 Q100,0 100,20 L100,100');
  // Never more than half a side: a short side is rounded all the way.
  assert.equal(bentPath([[0, 0], [10, 0], [10, 100]], 20), 'M0,0 L5,0 Q10,0 10,5 L10,100');
  assert.equal(bentPath([[0, 0], [5, 5]], 20), 'M0,0 L5,5');
});

test('a mark moved, reshaped by its grips, and written back in its place', () => {
  const [box, arrow, pen, text] = parseInk(['box blue: 10,10 100x50', 'arrow: 0,0 -> 100,0 -> 100,100', 'pen: 1,1 5,5', 'text: 3,4 Hi'].join('\n')).marks;
  assert.equal(inkLine(movedMark(box, 5, -5)), 'box blue: 15,5 100x50');
  assert.equal(inkLine(movedMark(arrow, 1, 2)), 'arrow red: 1,2 -> 101,2 -> 101,102');
  assert.equal(inkLine(movedMark(pen, 1, 1)), 'pen red: 2,2 6,6');
  assert.equal(inkLine(movedMark(text, 1, 1)), 'text red: 4,5 Hi');
  assert.deepEqual(grips(box), [[10, 10], [110, 10], [110, 60], [10, 60]]);
  assert.deepEqual(grips(pen), []);
  // A corner dragged: the opposite one stays, even dragged past it.
  assert.equal(inkLine(reshapedMark(box, 2, [210, 80])), 'box blue: 10,10 200x70');
  assert.equal(inkLine(reshapedMark(box, 2, [0, 0])), 'box blue: 0,0 10x10');
  // An arrow: an end moved, a bend added in the middle of a side, a bend dragged straight gone.
  assert.equal(inkLine(reshapedMark(arrow, 2, [100, 200])), 'arrow red: 0,0 -> 100,0 -> 100,200');
  assert.equal(inkLine(reshapedMark(arrow, 0, [50, -40], { mid: true })), 'arrow red: 0,0 -> 50,-40 -> 100,0 -> 100,100');
  assert.equal(inkLine(reshapedMark(arrow, 1, [52, 48], { straight: 3 })), 'arrow red: 0,0 -> 100,100');
  // Its own words for the kind and colour stay.
  assert.equal(setMark('# note\n\uC0C1\uC790 \uD30C\uB791: 1,2 3x4\npen: 1,1 2,2', 1, movedMark(parseInk('box: 1,2 3x4').marks[0], 10, 0)), '# note\n\uC0C1\uC790 \uD30C\uB791: 11,2 3x4\npen: 1,1 2,2');
});

test('a sketch: a board line is the page, not a mark; it grows to hold what is drawn past it', () => {
  const src = [boardLine(), 'pen blue: 10,10 40,40', '\uBCF4\uB4DC: 800x600', 'board: 20x20', 'board: big'].join('\n');
  const { marks, bad, board } = parseInk(src);
  assert.equal(boardLine(), 'board: 1600x900');
  assert.deepEqual(board, { w: 1600, h: 900, line: 0 }, 'the largest one');
  assert.deepEqual(marks.map((m) => m.kind), ['pen']);
  assert.deepEqual(bad, [3, 4]);
  assert.equal(parseInk('pen: 1,1 2,2').board, null);
  // Inside: as it was. Past the bottom (and the right): larger, in steps of 100.
  assert.equal(fitBoard('board: 1600x900\npen: 10,10 1500,800'), 'board: 1600x900\npen: 10,10 1500,800');
  assert.equal(fitBoard('board: 1600x900\npen: 10,10 1500,950'), 'board: 1600x1100\npen: 10,10 1500,950');
  assert.equal(fitBoard('  board  : 1600 x 900\nbox red: 1600,10 200x100'), '  board  : 1900x900\nbox red: 1600,10 200x100');
  assert.equal(fitBoard('pen: 10,10 5000,5000'), 'pen: 10,10 5000,5000', 'no board: nothing to grow');
  assert.equal(fitBoard('board: 1600x900\npen: 1,1 99999,1'), 'board: 8000x900\npen: 1,1 99999,1');
});
