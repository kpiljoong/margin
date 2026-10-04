// node --test (npm test): marks drawn on a picture, as lines (public/ink.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInk, inkLine, simplify, addMark, removeMark, bentPath, movedMark, grips, reshapedMark, setMark, fitBoard, boardLine, anchors, snapEnd, snapArrow, followBox, wordsIn, textSize, elbowRoute, sideOf, arrowPath, arrowMids, curveParts, followBoxes, markBounds, elbowPoints, movedPart } from '../public/ink.js';

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

test('an arrow through points: the points in order (bentPath rounds an elbow arrow\'s corners)', () => {
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

test('an arrow\'s kind: straight (not said), curved or elbow, a word before or after the colour', () => {
  const { marks, bad } = parseInk([
    'arrow red curved: 0,0 -> 50,50 -> 100,0',
    'arrow curved blue: 1,2 -> 3,4',
    'arrow elbow: 0,0 -> 50,50 -> 100,0',
    '\uD654\uC0B4\uD45C \uACE1\uC120: 1,2 -> 3,4',
    'arrow: 1,2 -> 3,4',
    'box curved: 1,2 3x4',
    'arrow red blue: 1,2 -> 3,4',
    'arrow curved elbow: 1,2 -> 3,4',
  ].join('\n'));
  assert.deepEqual(marks.map((m) => [m.style, m.color]), [['curved', 'red'], ['curved', 'blue'], ['elbow', 'red'], ['curved', 'red'], ['straight', 'red']]);
  assert.deepEqual(bad, [5, 6, 7]);
  assert.deepEqual(marks[2].via, [[50, 50]], 'an elbow arrow\'s points between: its corners, set by hand');
  assert.equal(inkLine(marks[0]), 'arrow red curved: 0,0 -> 50,50 -> 100,0');
  assert.equal(inkLine(marks[2]), 'arrow red elbow: 0,0 -> 50,50 -> 100,0');
  assert.equal(inkLine(marks[4]), 'arrow red: 1,2 -> 3,4');
  // Its kind changed in place: the other words as they were.
  const src = 'arrow blue: 0,0 -> 10,10\n\uD654\uC0B4\uD45C \uACE1\uC120 \uD30C\uB791: 1,2 -> 3,4';
  const [a, b] = parseInk(src).marks;
  const curved = setMark(src, 0, { ...a, style: 'curved' });
  assert.equal(curved.split('\n')[0], 'arrow blue curved: 0,0 -> 10,10');
  assert.equal(setMark(curved, 0, { ...a, style: 'straight' }).split('\n')[0], 'arrow blue: 0,0 -> 10,10');
  assert.equal(setMark(src, 1, { ...b, to: [5, 6] }).split('\n')[1], '\uD654\uC0B4\uD45C \uACE1\uC120 \uD30C\uB791: 1,2 -> 5,6');
  assert.equal(setMark(src, 1, { ...b, style: 'elbow' }).split('\n')[1], '\uD654\uC0B4\uD45C \uD30C\uB791 elbow: 1,2 -> 3,4');
});

test('drawing an arrow: straight corners, a curve through its points, an elbow round its boxes', () => {
  const round = (ps) => ps.map((p) => p.map((v) => Math.round(v * 1000) / 1000));
  const straight = { kind: 'arrow', from: [0, 0], via: [[100, 0]], to: [100, 100], style: 'straight' };
  assert.deepEqual(arrowPath(straight, 2), { d: 'M0,0 L100,0 L100,100', back: [100, 0] });
  assert.deepEqual(round(arrowMids(straight)), [[50, 0], [100, 50]]);
  // Curved: through the point between (a lever), the head along the curve's end.
  const curved = { kind: 'arrow', from: [0, 0], via: [[50, 50]], to: [100, 0], style: 'curved' };
  const parts = curveParts([curved.from, ...curved.via, curved.to]);
  assert.deepEqual(parts.map((x) => [x[0], x[3]]), [[[0, 0], [50, 50]], [[50, 50], [100, 0]]]);
  assert.match(arrowPath(curved, 2).d, /^M0,0 C8\.3,8\.3 33\.3,50 50,50 C66\.7,50 91\.7,8\.3 100,0$/);
  assert.deepEqual(round([arrowPath(curved, 2).back]), [[91.667, 8.333]]);
  assert.deepEqual(round(arrowMids(curved)), [[21.875, 28.125], [78.125, 28.125]]);
  assert.match(arrowPath({ ...curved, via: [] }, 2).d, /^M0,0 L100,0$/, 'with no point between, a curve is straight');
  // Elbow: on no box, across then down as it mostly goes.
  assert.deepEqual(elbowRoute([0, 0], [100, 50]), [[0, 0], [50, 0], [50, 50], [100, 50]]);
  assert.deepEqual(elbowRoute([0, 0], [20, 100]), [[0, 0], [0, 50], [20, 50], [20, 100]]);
  // Out of a box's right side into the next one's left side.
  assert.deepEqual(elbowRoute([300, 150], [600, 140], 1, 3, 10), [[300, 150], [450, 150], [450, 140], [600, 140]]);
  // Out of the bottom, into a left side: one corner.
  assert.deepEqual(elbowRoute([200, 200], [400, 300], 2, 3, 10), [[200, 200], [200, 300], [400, 300]]);
  // Both on top sides: up past both, across, down.
  assert.deepEqual(elbowRoute([100, 100], [300, 150], 0, 0, 10), [[100, 100], [100, 90], [300, 90], [300, 150]]);
  // The sides come from the boxes the ends are on.
  const { marks } = parseInk(['box: 100,100 200x100', 'box: 600,100 200x100', 'arrow elbow: 300,150 -> 600,150'].join('\n'));
  assert.equal(sideOf([300, 150], marks), 1);
  assert.equal(sideOf([600, 150], marks), 3);
  assert.equal(sideOf([601, 150], marks), -1);
  assert.deepEqual(arrowMids(marks[2]), [], 'no points to add to an elbow arrow');
  assert.deepEqual(arrowPath(marks[2], 2, marks).back, [300, 150]);
});

test('an elbow arrow goes round the boxes in its way; a part moved across, the way is its own', () => {
  const { marks } = parseInk(['box: 100,100 200x100', 'box: 450,80 100x140', 'box: 700,100 200x100', 'arrow elbow: 300,150 -> 700,150'].join('\n'));
  const arrow = marks[3];
  // The box between: over it, gap (16) off it.
  const way = elbowPoints(arrow, marks, 16);
  assert.deepEqual(way, [[300, 150], [434, 150], [434, 64], [566, 64], [566, 150], [700, 150]]);
  assert.deepEqual(elbowPoints(arrow, [marks[0], marks[2]], 16), [[300, 150], [700, 150]], 'nothing in the way: straight across');
  // A box holding an end (a frame round them all) is not in its way.
  assert.deepEqual(elbowPoints(arrow, [...marks, { kind: 'box', x: 0, y: 0, w: 1000, h: 400 }], 16), way);
  // The part over the box moved down below it: the corners written.
  const below = movedPart(way, 2, [500, 300], 16);
  assert.deepEqual(below, [[300, 150], [434, 150], [434, 300], [566, 300], [566, 150], [700, 150]]);
  const own = { ...arrow, via: below.slice(1, -1) };
  assert.equal(inkLine(own), 'arrow red elbow: 300,150 -> 434,150 -> 434,300 -> 566,300 -> 566,150 -> 700,150');
  assert.deepEqual(elbowPoints(own, marks, 16), below, 'its own way, as written');
  // Its box moved down: the end goes along, the corner by it stays in line.
  const moved = [marks[0], marks[1], { ...marks[2], y: 150 }];
  assert.deepEqual(elbowPoints({ ...own, to: [700, 200] }, moved, 16), [[300, 150], [434, 150], [434, 300], [566, 300], [566, 200], [700, 200]]);
  // A part at an end: the end stays, a short way out of it first.
  assert.deepEqual(movedPart([[300, 150], [700, 150]], 0, [0, 300], 16), [[300, 150], [316, 150], [316, 300], [684, 300], [684, 150], [700, 150]]);
  // Corners not in line, written by hand: put at right angles.
  assert.deepEqual(elbowPoints({ kind: 'arrow', style: 'elbow', from: [0, 0], via: [[50, 80]], to: [100, 100] }), [[0, 0], [0, 80], [50, 80], [50, 100], [100, 100]]);
  // Reshaping an end keeps the corners.
  assert.deepEqual(reshapedMark(own, 5, [700, 160]).via, own.via);
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

test('a sketch: arrows end on the middles of boxes\' sides, and go with a box moved', () => {
  const { marks } = parseInk(['board: 1600x900', 'box: 100,100 200x100', 'box: 600,100 200x100', 'arrow: 310,150 -> 590,140', 'text: 120,120 Start', 'arrow: 900,800 -> 1000,800'].join('\n'));
  const [a, b] = marks;
  assert.deepEqual(anchors(a), [[200, 100], [300, 150], [200, 200], [100, 150]]);
  assert.deepEqual(snapEnd([320, 160], marks, 40).at, [300, 150]);
  assert.equal(snapEnd([360, 160], marks, 40), null, 'too far');
  assert.deepEqual(snapEnd([250, 190], marks, 40).at, [200, 200], 'inside: the nearest side');
  // Not both ends on one box.
  const s = snapArrow({ kind: 'arrow', from: [310, 150], to: [590, 140], via: [] }, marks, 40);
  assert.deepEqual([s.from, s.to], [[300, 150], [600, 150]]);
  assert.deepEqual(snapArrow({ kind: 'arrow', from: [210, 120], to: [250, 180], via: [] }, marks, 40).to, [250, 180]);
  // The box moved: the arrow on its anchor goes along, the others stay.
  const on = { ...marks[2], from: [300, 150], to: [600, 150] };
  const moved = followBox([a, b, on, marks[3], marks[4]], b, { ...b, x: 700, y: 300 });
  assert.deepEqual(moved, [[on.line, { ...on, to: [700, 350] }]]);
  assert.equal(textSize(1600, 900), 45);
  assert.deepEqual(wordsIn(marks, a, 45).map((m) => m.text), ['Start']);
  assert.deepEqual(wordsIn(marks, b, 45), []);
});

test('several marks at once: boxes moved together take the arrows between them, the bounds of each kind', () => {
  const { marks } = parseInk(['board: 1600x900', 'box: 100,100 200x100', 'box: 600,100 200x100', 'arrow: 300,150 -> 600,150', 'arrow: 200,200 -> 200,400', 'arrow: 700,200 -> 700,400'].join('\n'));
  const [a, b, between, down] = marks;
  const moved = (m) => ({ ...m, x: m.x + 10, y: m.y + 20 });
  // Both boxes moved: both ends of the arrow between them go; one picked too goes as it was moved (skipped).
  assert.deepEqual(followBoxes(marks, [[a, moved(a)], [b, moved(b)]]).map(([l, m]) => [l, m.from, m.to]), [
    [3, [310, 170], [610, 170]], [4, [210, 220], [200, 400]], [5, [710, 220], [700, 400]],
  ]);
  assert.deepEqual(followBoxes(marks, [[a, moved(a)]], [between.line]).map(([l]) => l), [down.line]);
  assert.deepEqual(markBounds(a, 1600, 900), { x: 100, y: 100, w: 200, h: 100 });
  assert.deepEqual(markBounds({ kind: 'arrow', from: [10, 50], via: [[40, 5]], to: [30, 20] }, 1600, 900), { x: 10, y: 5, w: 30, h: 45 });
  assert.deepEqual(markBounds({ kind: 'num', x: 100, y: 100, text: '1' }, 1600, 900), { x: 65, y: 65, w: 70, h: 70 });
  const t = markBounds({ kind: 'text', x: 10, y: 20, text: 'ab\uAC00' }, 1600, 900);
  assert.deepEqual([t.x, t.y, Math.round(t.w), Math.round(t.h)], [10, 20, 95, 54]);
});
