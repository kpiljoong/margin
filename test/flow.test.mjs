// node --test (npm test): the ```flow notation, public/flow.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow, isStepText, flowsAsMermaid, flowToMermaid } from '../public/flow.js';

const byText = (flow) => Object.fromEntries(flow.nodes.map((n) => [n.text, n]));

test('steps on a line are chained, and the same text is the same step', () => {
  const f = parseFlow('A -> B -> C\nC -> A');
  assert.deepEqual(f.nodes.map((n) => n.text), ['A', 'B', 'C']);
  assert.deepEqual(f.edges.map((e) => [e.from, e.to]), [['n1', 'n2'], ['n2', 'n3'], ['n3', 'n1']]);
});

test('an indented line continues from the step above; answers label the arrows of a question', () => {
  const f = parseFlow('Login -> Success?\n  yes -> Dashboard\n  no -> Login');
  const n = byText(f);
  assert.deepEqual(f.edges.map((e) => [e.from, e.to, e.label]), [
    [n['Login'].id, n['Success?'].id, ''],
    [n['Success?'].id, n['Dashboard'].id, 'yes'],
    [n['Success?'].id, n['Login'].id, 'no'],
  ]);
  assert.ok(!('yes' in n), 'the answer is not a step');
});

test('a chain over lines: a line starting with an arrow goes on from the line before, one ending with one into the next', () => {
  const chain = (src) => { const f = parseFlow(src); const t = Object.fromEntries(f.nodes.map((n) => [n.id, n.text])); return f.edges.map((e) => `${t[e.from]}${e.kind}${e.label ? `|${e.label}` : ''}${t[e.to]}`); };
  assert.deepEqual(chain('a\n-> b\n-> c'), ['a-->b', 'b-->c']);
  assert.deepEqual(chain('a ->\nb ->\nc ->'), ['a-->b', 'b-->c']);
  assert.deepEqual(chain('a\n-(ok)-> b\n..> c'), ['a-->|okb', 'b-.->c']);
  assert.deepEqual(chain('a ..>\n-> b'), ['a-->b']); // the line's own arrow
  assert.deepEqual(chain('Flow:\n  a\n  -> b\n  -> c'), ['a-->b', 'b-->c']);
  // Indented under a step: still branches from it; a question's answers as before.
  assert.deepEqual(chain('a\n  -> b\n  -> c'), ['a-->b', 'a-->c']);
  assert.deepEqual(chain('Order ->\nPaid?\n  yes -> Ship ->\n  Done'), ['Order-->Paid?', 'Paid?-->|yesShip', 'Ship-->Done']);
  const f = parseFlow('a\n-> b');
  assert.deepEqual(f.nodes.find((n) => n.text === 'b').spots, [{ line: 1, start: 3, end: 4 }]);
});

test('arrow kinds and labels', () => {
  const f = parseFlow('A ..> B\nB <-> C\nC -- D\nD -(HTTP)-> E');
  assert.deepEqual(f.edges.map((e) => [e.kind, e.label]), [['-.->', ''], ['<-->', ''], ['---', ''], ['-->', 'HTTP']]);
  assert.match(f.mermaid, /\|"HTTP"\|/);
});

test('shapes, notes, groups, direction and comments', () => {
  const f = parseFlow('direction: right\n# a comment\nServices:\n  [(DB)] -> ((End)) : a note\n  (Rounded) -> [Box]');
  assert.match(f.mermaid, /^flowchart LR/);
  assert.match(f.mermaid, /subgraph g1\["Services"\]/);
  assert.match(f.mermaid, /\[\("DB"\)\]/);
  assert.match(f.mermaid, /\(\("End<br>a note"\)\)/);
  assert.deepEqual(f.nodes.map((n) => n.text), ['DB', 'End', 'Rounded', 'Box']);
});

test('spots are where each step is written, without its shape marks', () => {
  const src = 'A -> [(DB server)]\n  yes -> B';
  const f = parseFlow(src);
  const lines = src.split('\n');
  for (const n of f.nodes) {
    for (const sp of n.spots) assert.equal(lines[sp.line].slice(sp.start, sp.end), n.text);
  }
  assert.deepEqual(byText(f)['DB server'].lines, [0]);
});

test('empty input is an error', () => {
  assert.throws(() => parseFlow('\n# only a comment\n'), /Nothing to draw/);
});

test('isStepText: one step, no arrows, notes or group marks', () => {
  assert.ok(isStepText('Auth server'));
  for (const bad of ['a -> b', 'a : b', 'Group:', '# x', 'a\nb', '']) assert.ok(!isStepText(bad), bad);
});

test('a trailing ! marks a problem, and is not part of the name', () => {
  const src = 'Request -> Waiting for approval !\nWaiting for approval -> [Deploy]!';
  const f = parseFlow(src);
  const n = byText(f);
  assert.deepEqual(Object.keys(n), ['Request', 'Waiting for approval', 'Deploy']);
  assert.ok(n['Waiting for approval'].flag && n['Deploy'].flag && !n['Request'].flag);
  assert.match(f.mermaid, /class n2,n3 problem/);
  const lines = src.split('\n');
  for (const x of f.nodes) for (const sp of x.spots) assert.equal(lines[sp.line].slice(sp.start, sp.end), x.text);
  assert.ok(!parseFlow('!').nodes[0].flag, 'a lone ! is a name');
});

test('flowStepNames and similarNames', async () => {
  const { flowStepNames, similarNames, flowBlocks } = await import('../public/flow.js');
  const md = '# a\n```flow\nAuth server -> End\n```\n\n```mermaid\nA --> B\n```\n~~~flow\nAuthServer -> Login-Page\n~~~\n```flow\nlogin page -> End\n```';
  assert.deepEqual(flowBlocks(md).map((b) => b.line), [1, 8, 11]);
  assert.deepEqual(flowStepNames(md), ['Auth server', 'End', 'AuthServer', 'Login-Page', 'login page']);
  const sim = similarNames(flowStepNames(md));
  assert.deepEqual(sim.get('Auth server'), ['AuthServer']);
  assert.deepEqual(sim.get('login page'), ['Login-Page']);
  assert.ok(!sim.has('End'));
});

test('flowTour: from the start, each answer followed to its end, each step once', async () => {
  const { flowTour } = await import('../public/flow.js');
  const f = parseFlow('Request -> Success?\n  yes -> Dashboard -> End\n  no -> Retry -> Request');
  const n = byText(f);
  const t = flowTour(f);
  assert.deepEqual(t.map((s) => f.nodes.find((x) => x.id === s.id).text), ['Request', 'Success?', 'Dashboard', 'End', 'Success?', 'Retry', 'Request']);
  assert.deepEqual(t[2], { id: n['Dashboard'].id, from: n['Success?'].id, label: 'yes' });
  assert.deepEqual(t[4], { id: n['Success?'].id, back: true, label: 'no' }, 'back at the question before its next answer');
  assert.deepEqual(t[6], { id: n['Request'].id, from: n['Retry'].id, label: '', join: 'loop' });
  const loop = parseFlow('A -> B\nB -> A');
  assert.deepEqual(flowTour(loop).map((s) => s.id), ['n1', 'n2', 'n1'], 'a loop starts at its first step');
});

test('flowTour: ways that join, and a branch picked first', async () => {
  const { flowTour } = await import('../public/flow.js');
  const f = parseFlow('PR -> Review?\n  pass -> Deploy -> End\n  changes -> Fix -> Deploy');
  const n = byText(f);
  const text = (t) => t.map((s) => `${s.back ? '↩' : ''}${s.join ? '+' : ''}${f.nodes.find((x) => x.id === s.id).text}`);
  assert.deepEqual(text(flowTour(f)), ['PR', 'Review?', 'Deploy', 'End', '↩Review?', 'Fix', '+Deploy']);
  assert.equal(flowTour(f)[6].join, 'join');
  assert.deepEqual(text(flowTour(f, { [n['Review?'].id]: [n['Fix'].id] })), ['PR', 'Review?', 'Fix', 'Deploy', 'End', '↩Review?', '+Deploy']);
});

test('different notes on one step go on the arrows that bring them; one note stays under the box', () => {
  const f = parseFlow([
    'Change -> Resolver?',
    '  same -> Active : kept',
    '  normalized -> Active : updated',
    '  conflict -> Conflict : recorded',
    'Active : the current value',
  ].join('\n'));
  const id = (t) => f.nodes.find((n) => n.text === t).id;
  const label = (to) => f.edges.filter((e) => e.to === id(to)).map((e) => e.label);
  assert.deepEqual(label('Active'), ['same: kept', 'normalized: updated']);
  assert.equal(f.nodes.find((n) => n.text === 'Active').note, 'the current value');
  assert.deepEqual(label('Conflict'), ['conflict']);
  assert.equal(f.nodes.find((n) => n.text === 'Conflict').note, 'recorded');
  assert.match(f.mermaid, /\|"same: kept"\|/);
  const same = parseFlow('A -> B : a note\nC -> B : a note');
  assert.equal(same.nodes.find((n) => n.text === 'B').note, 'a note');
  assert.deepEqual(same.edges.map((e) => e.label), ['', '']);
});

test('under a question, an answer and its arrow label both stay', () => {
  const f = parseFlow('Check?\n  yes -(retry)-> Result\n  no -> End');
  assert.deepEqual(f.edges.map((e) => e.label), ['yes: retry', 'no']);
});

test('flowLineAt: in a flow block, and whether the line is half written', async () => {
  const { flowLineAt } = await import('../public/flow.js');
  const md = 'text\n```flow\nA -> B\nA -\nA ->\nA -(la\nB :\nGroup:\n```\nafter';
  const at = (line, col = Infinity) => { const ls = md.split('\n'); return ls.slice(0, line).reduce((a, l) => a + l.length + 1, 0) + Math.min(col, ls[line].length); };
  assert.equal(flowLineAt(md, at(0)), null);
  assert.equal(flowLineAt(md, at(9)), null);
  assert.deepEqual(flowLineAt(md, at(2)), { partial: false });
  for (const l of [3, 4, 5, 6]) assert.deepEqual(flowLineAt(md, at(l)), { partial: true }, md.split('\n')[l]);
  assert.deepEqual(flowLineAt(md, at(7)), { partial: false });
});

test('a note for GitHub: each flow block becomes a mermaid block, the rest stays', () => {
  const md = ['# Deploy', '', '```flow', 'PR -> Review -> Deploy !', '```', '', '```js', 'a -> b', '```', '', '~~~~flow', '', '~~~~', 'Done.'].join('\n');
  const r = flowsAsMermaid(md);
  assert.equal(r.converted, 1);
  assert.equal(r.failed, 1); // the empty block has nothing to draw: kept
  assert.equal(r.md, ['# Deploy', '', '```mermaid', flowToMermaid('PR -> Review -> Deploy !'), '```', '', '```js', 'a -> b', '```', '', '~~~~flow', '', '~~~~', 'Done.'].join('\n'));
  assert.match(r.md, /class n3 problem/);
  assert.deepEqual(flowsAsMermaid('no pictures'), { md: 'no pictures', converted: 0, failed: 0 });
});
