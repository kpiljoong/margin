// node --test (npm test): drawing on a ```flow picture writes its text, public/flowedit.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow } from '../public/flow.js';
import { connect, addBox, freshName, nextAnswer, setColor, setDirection, removeBox, removeArrow, setArrowKind, setArrowLabel, reverseArrow } from '../public/flowedit.js';

const arrows = (src) => {
  const f = parseFlow(src);
  const name = (id) => f.nodes.find((n) => n.id === id).text;
  return f.edges.map((e) => `${name(e.from)}>${name(e.to)}${e.label ? `:${e.label}` : ''}`);
};

test('connecting writes a line; an arrow already there is left alone', () => {
  const src = 'A -> B\n\ncolor blue: A\n';
  const out = connect(src, 'A', 'C');
  assert.equal(out, 'A -> B\nA -> C\n\ncolor blue: A\n');
  // From the step the last line ends with: that line goes on.
  assert.equal(connect(out, 'C', 'D'), 'A -> B\nA -> C -> D\n\ncolor blue: A\n');
  assert.equal(connect('A -> B : note', 'B', 'C'), 'A -> B : note\nB -> C');
  assert.equal(connect(out, 'A', 'C'), out);
  assert.equal(connect('A <-> B', 'B', 'A'), 'A <-> B');
  assert.equal(connect('A', 'A', 'A'), 'A');
  assert.equal(connect('Ok?', 'Ok?', 'Next', 'yes'), 'Ok? -(yes)-> Next');
  assert.equal(connect('A', '# one', 'B'), 'A\n[# one] -> B');
  assert.equal(connect('Start', 'Start', 'Next'), 'Start -> Next');
});

test('a new box: a name of its own, alone or after another', () => {
  assert.equal(freshName('New step -> New step 2'), 'New step 3');
  assert.equal(freshName(''), 'New step');
  assert.equal(addBox('A -> B', 'New step'), 'A -> B\nNew step');
  assert.equal(addBox('\n', 'Start'), 'Start');
  assert.equal(nextAnswer('Ok? -> A', 'Ok?'), 'yes');
  assert.equal(nextAnswer('Ok?\n  yes -> A', 'Ok?'), 'no');
  assert.equal(nextAnswer('Ok?\n  yes -> A\n  no -> B', 'Ok?'), '');
  assert.equal(nextAnswer('A -> B', 'A'), '');
});

test('colour lines: written, read, moved between colours, taken away', () => {
  let src = 'Auth server, v2 -> Payment -> Done';
  src = setColor(src, ['Auth server, v2', 'Payment'], 'blue');
  assert.equal(src, 'Auth server, v2 -> Payment -> Done\ncolor blue: Auth server, v2, Payment');
  const n = Object.fromEntries(parseFlow(src).nodes.map((x) => [x.text, x.color]));
  assert.deepEqual(n, { 'Auth server, v2': 'blue', Payment: 'blue', Done: null });
  src = setColor(src, ['Payment'], 'red');
  assert.equal(src, 'Auth server, v2 -> Payment -> Done\ncolor blue: Auth server, v2\ncolor red: Payment');
  src = setColor(src, ['Auth server, v2'], null);
  assert.equal(src, 'Auth server, v2 -> Payment -> Done\ncolor red: Payment');
  // Drawn: a class per colour, before the problem mark's.
  const m = parseFlow(`${src}\nPayment !`).mermaid;
  assert.match(m, /classDef c-red fill:#fde2e1,stroke:#e5484d,color:#1c2024\n {2}class n2 c-red\n {2}classDef problem/);
  // In Korean, and a later line wins.
  assert.equal(parseFlow('A\n색 파랑: A\ncolor green: A').nodes[0].color, 'green');
  assert.throws(() => setColor('A', ['A'], 'pink'), /not a colour/);
});

test('turning the picture', () => {
  assert.equal(setDirection('A -> B', 'right'), 'direction: right\nA -> B');
  assert.equal(setDirection('direction: right\nA -> B', 'down'), 'direction: down\nA -> B');
  assert.equal(setDirection('A -> B', 'down'), 'A -> B');
  assert.equal(parseFlow(setDirection('A', 'left')).direction, 'RL');
});

test('deleting a box: the steps beside it join up, its lines and colour go', () => {
  const src = [
    'A -> B -(x)-> C : about C',
    'B : about B',
    'D -> B',
    'Ok?',
    '  yes -> B -> E',
    '  no -> B',
    'color blue: B, C',
  ].join('\n');
  const out = removeBox(src, 'B');
  assert.equal(out, [
    'A -> C : about C',
    'D',
    'Ok?',
    '  yes -> E',
    'color blue: C',
  ].join('\n'));
  assert.deepEqual(arrows(out), ['A>C', 'Ok?>E:yes']);
  // A line left with a step written elsewhere too goes; alone, it stays.
  assert.equal(removeBox('A -> B\nB -> C\nC -> D\nX -> B -> D', 'B'), 'A\nC -> D\nX -> D');
  assert.equal(removeBox('C -> B\nB -> D\nC -> D', 'B'), 'C -> D');
  assert.equal(removeBox('A -> B\nB -> C\n  more', 'B'), 'A\nC\n  more');
  // The last step taken: its note goes too; one not there changes nothing.
  assert.equal(removeBox('A -> B : about B', 'B'), 'A');
  assert.equal(removeBox('A -> B', 'Z'), 'A -> B');
  // Shapes and marks are the step's: [(DB)] is DB.
  assert.equal(removeBox('API -> [(DB)] ! -> Log', 'DB'), 'API -> Log');
});

test('arrows: take out, both ways, dotted, words, the other way round', () => {
  const D = ['주문 -> 결제 요청 -> 승인?', '  yes -> 영수증', '  no -> 재시도', '영수증 -> 배송', '재시도 -> 결제 요청', 'color red: 재시도'].join('\n');
  const edges = (s) => parseFlow(s).edges.length;
  const names = (s) => parseFlow(s).nodes.map((n) => n.text).sort();
  // Out of a line: the steps either side stay, each where it was written.
  assert.equal(removeArrow('A -> B -> C', 'A', 'B'), 'A\nB -> C');
  assert.equal(removeArrow('X -> A\nA -> B -> C', 'A', 'B'), 'X -> A\nB -> C');
  assert.equal(removeArrow('A -> B -> C <-> A\ncolor blue: B', 'C', 'A'), 'A -> B -> C\ncolor blue: B');
  assert.equal(removeArrow('A -> B -> A', 'A', 'B'), 'B -> A');
  // An answer's line goes when its step is written elsewhere.
  assert.equal(removeArrow(D, '승인?', '재시도'), D.replace('\n  no -> 재시도', ''));
  // The arrow into a question: the question's lines go on from it as before.
  const cut = removeArrow(D, '결제 요청', '승인?');
  assert.equal(cut.split('\n').slice(0, 3).join('\n'), '주문 -> 결제 요청\n승인?\n  yes -> 영수증');
  for (const [a, b] of [['주문', '결제 요청'], ['결제 요청', '승인?'], ['승인?', '영수증'], ['영수증', '배송'], ['재시도', '결제 요청']]) {
    const s = removeArrow(D, a, b);
    assert.equal(edges(s), edges(D) - 1, `${a} -> ${b}`);
    assert.deepEqual(names(s), names(D));
  }
  // Under a line, the steps after the arrow go to a line of their own (with
  // the lines going on from them).
  assert.equal(removeArrow('S?\n  yes -> A -> B\n    C\n  no -> Z', 'A', 'B'), 'S?\n  yes -> A\n  no -> Z\nB\n  C');
  assert.equal(removeArrow('Login\n  Check -> Done : ok\n  Retry', 'Login', 'Check'), 'Login\n  Retry\nCheck -> Done : ok');
  // Kinds, written where the arrow is.
  assert.match(setArrowKind(D, '영수증', '배송', '<-->'), /^영수증 <-> 배송$/m);
  assert.match(setArrowKind(D, '승인?', '재시도', '<-->'), /^ {2}no <-> 재시도$/m);
  assert.match(setArrowKind(D, '결제 요청', '승인?', '-.->'), /결제 요청 \.\.> 승인\?/);
  assert.equal(setArrowKind('A <-> B', 'A', 'B', '-->'), 'A -> B');
  assert.equal(setArrowKind('A -(go)-> B', 'A', 'B', '---'), 'A -- B');
  // An arrow not written (a line going on from the one above) gets a line.
  assert.equal(setArrowKind('Login\n  Check -> Done : ok\n  Retry', 'Login', 'Retry', '<-->'), 'Login\n  Check -> Done : ok\nLogin <-> Retry');
  // Words: on the arrow, or the answer out of a question.
  assert.equal(setArrowLabel('A -> B -> C', 'A', 'B', 'go'), 'A -(go)-> B -> C');
  assert.equal(setArrowLabel('A -(go)-> B', 'A', 'B', ''), 'A -> B');
  assert.match(setArrowLabel(D, '승인?', '재시도', '아니오'), /^ {2}아니오 -> 재시도$/m);
  assert.equal(setArrowLabel('Q?\n  Fix', 'Q?', 'Fix', 'no'), 'Q?\n  no -> Fix');
  assert.throws(() => setArrowLabel('A <-> B', 'A', 'B', 'x'), /one-way/);
  // The other way round, its words kept.
  assert.equal(reverseArrow('A -> B -> C', 'B', 'C'), 'A -> B\nC -> B');
  assert.match(reverseArrow(D, '승인?', '재시도'), /^재시도 -\(no\)-> 승인\?$/m);
  assert.equal(reverseArrow('A <-> B', 'A', 'B'), 'A <-> B');
  // Nothing written: nothing changes.
  assert.equal(removeArrow('A -> B', 'B', 'A'), 'A -> B');
  assert.equal(removeArrow('A <-> B', 'B', 'A'), 'A\nB');
});
