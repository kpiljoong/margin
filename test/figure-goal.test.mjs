// node --test (npm test): what the cursor points at on the canvas, public/figure-goal.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFlow } from '../public/flow.js';
import { goalAt, boxAt, mentions, mentionRanges } from '../public/figure-goal.js';

// A note → sections and figures shaped like the app's (headings and fenced blocks).
function sectionsOf(v) {
  const lines = v.split('\n');
  const sections = [{ title: 'top', line: 0, figures: [] }];
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) sections.push({ title: lines[i], line: i, figures: [] });
    const m = /^```(\w+)/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('```')) j++;
    const source = lines.slice(i + 1, j).join('\n') + '\n';
    const fig = { line: i, source, lang: m[1] };
    if (m[1] === 'flow') fig.flowNodes = parseFlow(source).nodes;
    else fig.diagramNodes = [...source.matchAll(/\b([A-Za-z]\w*)\[/g)].map((x) => ({ id: x[1] }));
    sections[sections.length - 1].figures.push(fig);
    i = j;
  }
  return sections;
}
const info = (f) => f;
const at = (v, line, col = 0) => v.split('\n').slice(0, line).reduce((a, l) => a + l.length + 1, 0) + col;
const texts = (goal) => goal.nodes.map((n) => goal.fig.flowNodes.find((x) => x.id === n.id).text);

const NOTE = [
  '# Login design', //          0
  '', //                        1
  'The Auth server checks it.', // 2
  '', //                        3
  '## Request flow', //         4
  '```flow', //                  5
  'Login request -> Auth server -> Success?', // 6
  '  yes -> Dashboard', //       7
  '```', //                      8
  '', //                        9
  'Then to the Dashboard.', //   10
  '', //                        11
  '```mermaid', //               12
  'flowchart TD', //             13
  '  A[Start] --> B[End]', //    14
  '```', //                      15
  '', //                        16
  '## Last', //                  17
  '', //                        18
  'Only text here.', //         19
].join('\n');

test('a line of a flow block: that picture and the boxes the line writes', () => {
  const s = sectionsOf(NOTE);
  const g = goalAt(s, NOTE, at(NOTE, 7), info);
  assert.equal(g.fig.line, 5);
  assert.deepEqual(texts(g), ['Dashboard'], 'the answer yes is on the arrow, not a box');
});

test('a fence line: the picture, no boxes', () => {
  const s = sectionsOf(NOTE);
  for (const line of [5, 8]) {
    const g = goalAt(s, NOTE, at(NOTE, line), info);
    assert.equal(g.fig.line, 5);
    assert.deepEqual(g.nodes, []);
  }
});

test('a line of a mermaid block: boxes by id', () => {
  const s = sectionsOf(NOTE);
  const g = goalAt(s, NOTE, at(NOTE, 14), info);
  assert.equal(g.fig.line, 12);
  assert.deepEqual(g.nodes.map((n) => n.id), ['A', 'B']);
});

test('a line of text: the picture with the boxes it names, else the next picture', () => {
  const s = sectionsOf(NOTE);
  const named = goalAt(s, NOTE, at(NOTE, 10), info);
  assert.equal(named.fig.line, 5);
  assert.deepEqual(texts(named), ['Dashboard']);
  const next = goalAt(s, NOTE, at(NOTE, 11), info);
  assert.equal(next.fig.line, 12);
});

test('a section without pictures looks at the next one with pictures, else the one before', () => {
  const s = sectionsOf(NOTE);
  const intro = goalAt(s, NOTE, at(NOTE, 2), info);
  assert.equal(intro.section.line, 4);
  assert.deepEqual(texts(intro), ['Auth server']);
  const last = goalAt(s, NOTE, at(NOTE, 19), info);
  assert.equal(last.section.line, 4);
});

test('a note without headings still has a goal', () => {
  const v = 'note a\n\n```flow\nA -> B\n```\n';
  const g = goalAt(sectionsOf(v), v, at(v, 3), info);
  assert.equal(g.fig.line, 2);
  assert.deepEqual(texts(g), ['A', 'B']);
});

test('boxAt: the box the caret is in, else the first on the line', () => {
  const s = sectionsOf(NOTE);
  const pos = at(NOTE, 6, 'Login request -> Au'.length);
  const b = boxAt(goalAt(s, NOTE, pos, info), NOTE, pos, info);
  assert.equal(s[2].figures[0].flowNodes.find((n) => n.id === b.id).text, 'Auth server');
  const lineStart = at(NOTE, 7, 0);
  const c = boxAt(goalAt(s, NOTE, lineStart, info), NOTE, lineStart, info);
  assert.equal(s[2].figures[0].flowNodes.find((n) => n.id === c.id).text, 'Dashboard');
  assert.equal(boxAt(goalAt(s, NOTE, at(NOTE, 14), info), NOTE, at(NOTE, 14), info), null, 'not in a mermaid picture');
});

test('mentions: whole words; Korean names may take a particle', () => {
  assert.ok(mentions('go to the login screen', 'login'));
  assert.ok(!mentions('note a', 'no'));
  assert.ok(mentions('go to the Dashboard.', 'Dashboard'));
  // The one Korean case: a Korean name followed by a particle ("to the dashboard").
  assert.ok(mentions('\uB300\uC2DC\uBCF4\uB4DC\uB85C', '\uB300\uC2DC\uBCF4\uB4DC'));
  assert.ok(!mentions('x', 'x'), 'one letter is too short');
});

test('mentionRanges skip code blocks and front matter', () => {
  const v = '---\ntitle: Dashboard\n---\nDashboard view\n```flow\nDashboard -> End\n```\nDashboard';
  const r = mentionRanges(v, 'Dashboard');
  assert.deepEqual(r.map(([a, b]) => v.slice(a, b)), ['Dashboard', 'Dashboard']);
  assert.equal(r.length, 2);
});

test('definitionLines: list items that say what a box is, and the lines under them', async () => {
  const { definitionLines } = await import('../public/figure-goal.js');
  const note = [
    '# Deploy',                                  // 0
    'A PR goes through review before deploy.',   // 1: names PR, but says nothing about it
    '',
    '- PR: a **change request** from a developer', // 3
    '  - about `12` a day',                      // 4
    '- Review: checked by the [[Review rules|rules]]', // 5
    '- **Deploy**: every afternoon',             // 6
    'next line',                                 // 7
    '```flow',                                   // 8
    '- PR: not this, it is in a code block',     // 9
    '```',                                       // 10
    '* pr : a second note',                      // 11
  ].join('\n');
  assert.deepEqual(definitionLines(note, 'PR', 0, 99), ['a change request from a developer', '· about 12 a day', 'a second note']);
  assert.deepEqual(definitionLines(note, 'Review?', 0, 99), ['checked by the rules'], 'a question box by its name without ?');
  assert.deepEqual(definitionLines(note, 'Deploy', 0, 99), ['every afternoon']);
  assert.deepEqual(definitionLines(note, 'PR', 5, 99), ['a second note'], 'only in the range');
  assert.deepEqual(definitionLines(note, 'Fix', 0, 99), []);
});

test('a frame caption: the first lines of a section, markup out, no blocks or pictures', async () => {
  const { leadLines } = await import('../public/figure-goal.js');
  const note = [
    '---', 'title: x', '---',                   // 0-2
    '# Deploy',                                  // 3
    '',                                          // 4
    'Waiting for **approval** takes [too long](x.md).', // 5
    '![shot](a.png)',                            // 6
    '```flow',                                   // 7
    'A -> B',                                    // 8
    '```',                                       // 9
    '- [ ] ask [[Ops|the ops team]]',            // 10
    '> [!tip] keep it short',                    // 11
    '## Next',                                   // 12
    'later',                                     // 13
  ].join('\n');
  assert.deepEqual(leadLines(note, 3, 12), ['Waiting for approval takes too long.', '· ask the ops team', 'keep it short']);
  assert.deepEqual(leadLines(note, 0, 99, 2), ['Waiting for approval takes too long.', '· ask the ops team'], 'front matter out, at most max');
});

test('numberedItems: numbered as they read; goalAt: a numbered item looks at its dot', async () => {
  const { numberedItems } = await import('../public/figure-goal.js');
  const v = ['# Login', '', '![s](s.png)', '', '1. The **button** is hidden', '1. Too small', '   more on it', '   1. nested', '3. Wrong colour', '', 'Text.', '', '4. after text', '```', '9. in code', '```', '# Next', '1. other'].join('\n');
  assert.deepEqual(numberedItems(v, 0, 16).map((x) => [x.n, x.line, x.text]),
    [['1', 4, 'The button is hidden'], ['2', 5, 'Too small'], ['1', 7, 'nested'], ['3', 8, 'Wrong colour'], ['4', 12, 'after text']]);
  const fig = { inkMarks: [{ kind: 'box', line: 0 }, { kind: 'num', text: '2', line: 1 }], line: 2 };
  const sections = [{ line: 0, figures: [fig] }, { line: 16, figures: [] }];
  const info = (f) => ({ line: f.line, source: null, inkMarks: f.inkMarks });
  const at = (line) => v.split('\n').slice(0, line).join('\n').length + 1;
  assert.deepEqual(goalAt(sections, v, at(5), info).marks, [1]);
  assert.equal(goalAt(sections, v, at(4), info).marks, undefined);
});
