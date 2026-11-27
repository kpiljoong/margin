import test from 'node:test';
import assert from 'node:assert/strict';
import { textToDiagram, layoutDiagram, diagramToText } from '../public/board-text.js';

const names = (g) => g.nodes.map((n) => n.text);
const pairs = (g) => g.edges.map((e) => `${g.nodes[e.from].text}>${g.nodes[e.to].text}${e.label ? `:${e.label}` : ''}${e.both ? '<>' : ''}${e.none ? '--' : ''}`);

test('an outline: one dash more each level, spaces and tabs too', () => {
  const g = textToDiagram('- \u3141\n-- \u3160\n-- \u314A\n--- deep\n- next');
  assert.deepEqual(names(g), ['\u3141', '\u3160', '\u314A', 'deep', 'next']);
  assert.deepEqual(pairs(g), ['\u3141>\u3160', '\u3141>\u314A', '\u314A>deep']);
  const h = textToDiagram('Plan\n  - Goals\n\t- Risks\n    - Revenue\nOther\n1. First');
  assert.deepEqual(pairs(h), ['Plan>Goals', 'Plan>Risks', 'Risks>Revenue', 'Other>First']);
});

test('arrows, both ways, none, backwards, and an arrow\u2019s words', () => {
  const g = textToDiagram('Plan -> Build \u2192 Ship\nBuild -> QA: if bugs\nQA <- Ops\nA <-> B\nB -- C');
  assert.deepEqual(names(g), ['Plan', 'Build', 'Ship', 'QA', 'Ops', 'A', 'B', 'C']);
  assert.deepEqual(pairs(g), ['Plan>Build', 'Build>Ship', 'Build>QA:if bugs', 'Ops>QA', 'A>B<>', 'B>C--']);
});

test('shapes by brackets; the same words, the same box; an outline line with arrows', () => {
  const g = textToDiagram('(Start) -> {Approved?}\nApproved? -> Done\n- Done -> Archive\n-- Later');
  assert.equal(g.nodes.find((n) => n.text === 'Start').shape, 'ellipse');
  assert.equal(g.nodes.find((n) => n.text === 'Approved?').shape, 'diamond');
  assert.deepEqual(pairs(g), ['Start>Approved?', 'Approved?>Done', 'Done>Archive', 'Archive>Later']);
});

test('no diagram: paragraphs, one box, rules, words with a colon or a dash in them', () => {
  assert.equal(textToDiagram('Just words.\n\nMore words.'), null);
  assert.equal(textToDiagram('- one'), null);
  assert.equal(textToDiagram('---\n***'), null);
  assert.equal(textToDiagram('Time: 3pm\nwell-known'), null);
});

test('layout: columns along the arrows, a box in the middle of the ones under it, nothing overlapping, loops kept', () => {
  const g = textToDiagram('Root\n- A\n-- A1\n-- A2\n- B\nB -> Root');
  const pos = layoutDiagram(g, () => [100, 50]);
  const at = Object.fromEntries(g.nodes.map((n, i) => [n.text, pos[i]]));
  assert.ok(at.Root.x < at.A.x && at.A.x < at.A1.x);
  assert.equal(at.A.x, at.B.x);
  assert.equal(at.A.y + 25, (at.A1.y + at.A2.y) / 2 + 25);
  assert.ok(at.Root.y > at.A.y && at.Root.y < at.B.y);
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i];
      const b = pos[j];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${g.nodes[i].text} / ${g.nodes[j].text}`);
    }
  }
});

test('back to words: an outline where each box has one way in, A -> B lines for the rest; read again, the same diagram', () => {
  const nodes = [
    { id: 'r', text: 'Plan' }, { id: 'a', text: 'Goals' }, { id: 'b', text: 'Risks' },
    { id: 'c', text: 'Revenue' }, { id: 'd', text: 'Ok?', shape: 'diamond' }, { id: 'e', text: 'Ship\nit' },
  ];
  const edges = [
    { from: 'r', to: 'a' }, { from: 'r', to: 'b' }, { from: 'a', to: 'c' },
    { from: 'b', to: 'd' }, { from: 'c', to: 'd' }, { from: 'd', to: 'e', label: 'yes' },
  ];
  const t = diagramToText(nodes, edges);
  assert.equal(t, 'Plan\n- Goals\n-- Revenue\n- Risks\n\nRisks -> {Ok?}\nRevenue -> {Ok?}\n{Ok?} -> Ship it: yes');
  const g = textToDiagram(t);
  assert.deepEqual(pairs(g).sort(), ['Plan>Goals', 'Plan>Risks', 'Goals>Revenue', 'Risks>Ok?', 'Revenue>Ok?', 'Ok?>Ship it:yes'].sort());
  assert.equal(g.nodes.find((n) => n.text === 'Ok?').shape, 'diamond');
});
