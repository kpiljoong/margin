// node --test (npm test): the desk (public/desk.js, lib/desk.js) — the
// JSON Canvas file kept as it was, piles and groups, the margin's replies
// read, and the cards the server sends (never a private note).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDesk, stringifyDesk, stackOnto, groupAround, childrenOf, groupAt, removeCards, parseGroups, parseLinks, parseQuestions, groupLayout, nearest, cardTitle, edgePath, STEP, EMPTY_DESK, noteDesk, linksOf, fromState, toNote } from '../public/desk.js';

const require = createRequire(import.meta.url);
const { requestText, picturesOf, answerLang, textLang } = require('../lib/desk.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const card = (id, x, y, more = {}) => ({ id, type: 'text', text: id, x, y, width: 200, height: 100, ...more });

test('the file: what Obsidian wrote is kept, tabs as it writes them', () => {
  const text = '{\n\t"nodes":[\n\t\t{"id":"a","type":"text","text":"hi","x":1.4,"y":2,"width":250,"height":60,"color":"3","pluginData":{"k":1}},\n\t\t{"id":"b","type":"file","file":"n.md","x":0,"y":0,"width":400,"height":400}\n\t],\n\t"edges":[\n\t\t{"id":"e","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","label":"see"},\n\t\t{"id":"gone","fromNode":"a","toNode":"zz"}\n\t],\n\t"metadata":{"v":1}\n}';
  const d = parseDesk(text);
  assert.equal(d.nodes[0].x, 1);
  assert.deepEqual(d.nodes[0].pluginData, { k: 1 });
  assert.deepEqual(d.metadata, { v: 1 });
  assert.deepEqual(d.edges.map((e) => e.id), ['e']); // an edge to no card is left out
  const out = stringifyDesk(d);
  assert.match(out, /^\{\n\t"nodes": \[\n\t\t\{/);
  assert.ok(out.endsWith('}\n'));
  assert.deepEqual(parseDesk(out), d);
  assert.deepEqual(parseDesk(EMPTY_DESK), { nodes: [], edges: [] });
  assert.deepEqual(parseDesk(''), { nodes: [], edges: [] });
  assert.throws(() => parseDesk('[1]'), /Not a desk/);
});

test('a card on a card: a pile in a group; more onto it; the group holds them', () => {
  let d = { nodes: [card('a', 0, 0), card('b', 500, 0), card('c', 900, 300)], edges: [] };
  d = stackOnto(d, ['b'], 'a');
  const g = d.nodes[0];
  assert.equal(g.type, 'group');
  assert.equal(g.label, 'Stack');
  const at = (id) => d.nodes.find((n) => n.id === id);
  assert.deepEqual([at('b').x, at('b').y], [STEP.x, STEP.y]);
  assert.deepEqual(childrenOf(d, g).map((n) => n.id).sort(), ['a', 'b']);
  assert.equal(d.nodes.at(-1).id, 'b'); // on top
  // Onto a card in the pile: the same group, grown.
  d = stackOnto(d, ['c'], 'a');
  assert.equal(d.nodes.filter((n) => n.type === 'group').length, 1);
  assert.deepEqual([at('c').x, at('c').y], [2 * STEP.x, 2 * STEP.y]);
  assert.deepEqual(childrenOf(d, d.nodes[0]).map((n) => n.id).sort(), ['a', 'b', 'c']);
  assert.equal(groupAt(d, at('c')).id, g.id);
  // Nothing to move: as it was.
  assert.equal(stackOnto(d, ['a'], 'a'), d);
});

test('a group around cards, and cards taken off with their edges', () => {
  let d = { nodes: [card('a', 0, 0), card('b', 300, 0)], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] };
  d = groupAround(d, ['a', 'b'], 'Both');
  assert.equal(d.nodes[0].label, 'Both');
  assert.deepEqual(childrenOf(d, d.nodes[0]).map((n) => n.id), ['a', 'b']);
  d = removeCards(d, ['b']);
  assert.deepEqual(d.nodes.map((n) => n.id).slice(1), ['a']);
  assert.deepEqual(d.edges, []);
});

test('the margin’s replies: groups, links, questions', () => {
  assert.deepEqual(parseGroups('Budget: 1, 4\n**Places**: #2 and 3\nnoise\nAgain: 1', 5), [
    { name: 'Budget', cards: [0, 3] }, { name: 'Places', cards: [1, 2] }, { name: 'Other', cards: [4] },
  ]);
  assert.deepEqual(parseGroups('\uc608\uc0b0: 1, 2', 2), [{ name: '\uc608\uc0b0', cards: [0, 1] }]);
  assert.deepEqual(parseGroups('nothing here', 3), []);
  assert.deepEqual(parseLinks('#1-#3: same budget\n#3-#1: again\n2 - 2: self\n#1–#9: none\n- #2-#3: **depends**', 3), [
    { a: 0, b: 2, label: 'same budget' }, { a: 1, b: 2, label: 'depends' },
  ]);
  assert.deepEqual(parseQuestions('? Who pays? (#1, #3)\n1. ? When?\nnot a question?\n- ?  Where'), ['Who pays? (#1, #3)', 'When?', 'Where']);
});

test('the layout of groups, the next card by arrow, a card’s name, an edge', () => {
  const ns = [card('a', 0, 0), card('b', 0, 0, { width: 300 }), card('c', 0, 0)];
  const l = groupLayout([{ name: 'A', cards: [ns[0], ns[1]] }, { name: 'B', cards: [ns[2]] }], 100, 200);
  assert.deepEqual(l[0].box, { x: 100, y: 200, width: 380, height: 320 });
  assert.deepEqual(l[0].at, [{ id: 'a', x: 140, y: 260 }, { id: 'b', x: 140, y: 380 }]);
  assert.equal(l[1].box.x, 100 + 380 + 40);
  const grid = [card('o', 0, 0), card('r', 400, 30), card('d', 10, 300), card('far', 900, 0)];
  assert.equal(nearest(grid, grid[0], 'right').id, 'r');
  assert.equal(nearest(grid, grid[0], 'down').id, 'd');
  assert.equal(nearest(grid, grid[0], 'left'), null);
  assert.equal(cardTitle({ type: 'file', file: 'a/b/Plan.md' }), 'Plan');
  assert.equal(cardTitle({ type: 'text', text: '\n## Ideas *now*\nmore' }), 'Ideas *now*');
  assert.equal(cardTitle({ type: 'group' }), 'Group');
  assert.match(edgePath(card('a', 0, 0), card('b', 400, 0)).d, /^M200,50 C/);
});

test('requestText: the cards, then the request; a talk shows a card once, again when it changed', () => {
  const cards = [{ n: 1, key: 'a', title: 'Plan', text: 'go' }, { n: 2, key: 'b', title: '', text: 'stay' }];
  assert.equal(requestText('summary', cards), 'Cards:\n#1 "Plan":\ngo\n\n#2 card:\nstay\n\nRequest (cards #1, #2): Sum these cards up in three to five short sentences: what they say together, where they agree and where they do not.');
  const seen = new Map([['a', 'go']]);
  assert.match(requestText('chat', cards, 'why?', seen), /^Cards:\n#2 card:\nstay\n\nAbout cards #1, #2\. Answer[\s\S]*\nQuestion: why\?$/);
  seen.set('b', 'stay');
  assert.match(requestText('chat', cards, 'and?', seen), /^About cards #1, #2/);
  seen.set('b', 'old');
  assert.match(requestText('chat', cards, 'and?', seen), /^Cards:\n#2 card:\nstay/);
});

// A stand-in for the claude CLI: it answers with what it was sent.
const FAKE = `#!/usr/bin/env node
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    const c = j.message.content;
    const text = Array.isArray(c) ? c.map((b) => (b.type === 'image' ? '[image ' + b.source.media_type + ' ' + b.source.data + ']' : b.text)).join('\\n') : c;
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: the cards it sends, numbered; a private note never', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-desk-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-desk-bin-'));
  t.after(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  fs.writeFileSync(path.join(ws, 'a.md'), '---\ntags: x\n---\n# A\n\nopen text\n');
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nthe secret\n');
  fs.writeFileSync(path.join(ws, 'hidden.md'), 'hidden text\n');
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'hidden.md\n');
  fs.writeFileSync(path.join(ws, 'd.canvas'), EMPTY_DESK);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', path.join(bin, 'claude')], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const ask = async (body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}/api/desk/ask`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await r.text();
    if (!r.ok) return { status: r.status, error: JSON.parse(text).error };
    return text.trim().split('\n').map((l) => JSON.parse(l));
  };
  const cards = [{ key: 'k1', file: 'a.md' }, { key: 'k2', file: 'secret.md' }, { key: 'k3', file: 'hidden.md' }, { key: 'k4', text: 'a card' }, { key: 'k5', file: '../outside.md' }];
  const lines = await ask({ path: 'd.canvas', task: 'summary', cards });
  assert.deepEqual(lines[0], { cards: [['k1', 1], ['k4', 2]], withheld: ['secret.md', 'hidden.md'] });
  const said = lines.filter((l) => l.t != null).map((l) => l.t).join('');
  assert.match(said, /^Cards:\n#1 "a":\n# A\n\nopen text\n\n#2 card:\na card\n\nRequest \(cards #1, #2\): Sum/);
  assert.doesNotMatch(said, /secret|hidden|tags/);
  assert.equal(lines.at(-1).end.ok, true);
  // A talk: a card keeps its number, and is shown once.
  const talk = async (cs, q) => (await ask({ path: 'd.canvas', task: 'chat', cards: cs, question: q, talk: 'T1' }));
  let r = await talk([{ key: 'x', text: 'one' }], 'q1');
  assert.deepEqual(r[0].cards, [['x', 1]]);
  r = await talk([{ key: 'y', text: 'two' }, { key: 'x', text: 'one' }], 'q2');
  assert.deepEqual(r[0].cards, [['y', 2], ['x', 1]]);
  assert.match(r.filter((l) => l.t).map((l) => l.t).join(''), /^Cards:\n#2 card:\ntwo\n\nAbout cards #2, #1\./);
  // Pictures: a picture's card with it, a mark with its part and the whole —
  // never one .agentnotesignore names, nor one that isn't a picture there.
  fs.writeFileSync(path.join(ws, 'p.png'), 'png');
  fs.writeFileSync(path.join(ws, 'hidden.png'), 'png');
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'hidden.md\nhidden.png\n');
  const pic = (data) => ({ media: 'image/png', data });
  r = await ask({ path: 'd.canvas', task: 'region', cards: [
    { key: 'p', file: 'p.png', picture: pic('AAAA') },
    { key: 'm', text: 'Is this right?', region: { file: 'p.png', rect: [1, 2, 3, 4] }, picture: pic('BBBB'), whole: pic('CCCC') },
    { key: 'h', text: 'and this?', region: { file: 'hidden.png', rect: [1, 2, 3, 4] }, picture: pic('DDDD') },
    { key: 'b', text: 'bad', region: { file: 'a.md', rect: [1, 2, 3, 4] }, picture: { media: 'text/html', data: 'EEEE' } },
  ] });
  assert.deepEqual(r[0].withheld, ['hidden.png']);
  const sent = r.filter((l) => l.t).map((l) => l.t).join('');
  assert.match(sent, /^\[image image\/png AAAA\]\n\[image image\/png BBBB\]\n\[image image\/png CCCC\]\nCards:\n#1 "p":\n\[picture 1: the picture p\.png\]\n\n#2 card:\nIs this right\?\n\[picture 2: the part of p\.png it marks \(x, y, width, height: 1, 2, 3, 4\)\]\n\[picture 3: the whole of p\.png\]\n\n#3 card:\nand this\?\n\n#4 card:\nbad\n\nRequest/);
  assert.doesNotMatch(sent, /DDDD|EEEE/);
  // Not a request it knows; a desk in .agentnotesignore.
  assert.equal((await ask({ path: 'd.canvas', task: 'rm', cards })).at(-1).end.ok, false);
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'hidden.md\nd.canvas\n');
  assert.equal((await ask({ path: 'd.canvas', task: 'summary', cards })).status, 403);
});

test('a note on a desk: the note, its open questions and to-dos not done (each knowing its line), the notes it links to; the card says when the note moves on', () => {
  const note = [
    '# Weekly',
    '',
    'Previous meeting: [[Weekly 09-28]]',
    '',
    '## Launch (10m)',
    '',
    '> [!question] Do we need a beta?',
    '> [!decision] We ship on Friday.',
    '- [ ] Draft the notes @ann',
    '- [x] Book the room',
    '> [!question] \uc608\uc0b0\uc740 \uc5b4\ub5bb\uac8c \ud558\uc9c0? \uc5ec\ud589 \uacbd\ube44\uc640 \uc219\uc18c\ub97c \ub2e4\uc2dc \ubcf4\uace0 \uc815\ud558\uc790',
    'See [[Pricing|the prices]] and [[Pricing#Tiers]], ![[chart.png]], `[[not a link]]`.',
    '```',
    '[[Nor this]]',
    '```',
  ].join('\n');
  assert.deepEqual(linksOf(note), ['Weekly 09-28', 'Pricing']);
  const d = noteDesk('m/Weekly.md', note, ['m/Weekly 09-28.md', 'Pricing.md'], '2026-10-06');
  const groups = d.nodes.filter((n) => n.type === 'group');
  assert.deepEqual(groups.map((g) => g.label), ['Open questions', 'To do', 'Linked notes']);
  const qs = childrenOf(d, groups[0]);
  assert.deepEqual(qs.map((n) => n.text), ['Do we need a beta?', note.split('\n')[10].replace('> [!question] ', '')]);
  assert.deepEqual(qs[0].from, { file: 'm/Weekly.md', line: 6, kind: 'question', key: qs[0].from.key, at: '2026-10-06' });
  assert.ok(qs[1].height > qs[0].height, 'wide letters: a taller card');
  assert.deepEqual(childrenOf(d, groups[1]).map((n) => n.text), ['Draft the notes @ann']);
  assert.deepEqual(childrenOf(d, groups[2]).map((n) => n.file), ['m/Weekly 09-28.md', 'Pricing.md']);
  const self = d.nodes.find((n) => n.type === 'file' && n.file === 'm/Weekly.md');
  assert.ok(self && !groupAt(d, self), 'the note itself, outside the groups');
  for (const g of groups) assert.ok(g.x >= self.x + self.width, 'the groups beside the note');
  // The note, later: the question settled (a plain line now), the to-do ticked, lines moved.
  const later = `# Weekly\n\nAdded a line.\n\n${note.replace('> [!question] Do we need a beta?', '- Do we need a beta? (no)').replace('- [ ] Draft', '- [x] Draft').split('\n').slice(2).join('\n')}`;
  assert.equal(fromState(qs[0].from, later).state, 'gone');
  const todo = childrenOf(d, groups[1])[0].from;
  assert.deepEqual(fromState(todo, later), { state: 'done', line: 10 });
  assert.deepEqual(fromState(qs[1].from, later), { state: 'open', line: 12 });
  // A note with nothing of a meeting: just itself, and what it links to.
  const plain = noteDesk('a.md', 'Just words.', [], '');
  assert.deepEqual(plain.nodes.map((n) => n.type), ['file']);
});

test('what the desk asks of a note: a to-do ticked, a question decided (in other words, or as asked), every line of it (a wrap-up repeats it); the rest as it was', () => {
  const note = '# M\n\n> [!question] Do we need a beta?\n\n> [!question] Which day?\n\n- [ ] Draft the notes @ann\n- [ ] Book the room\n\n## Wrap-up\n\n### Open questions\n\n> [!question] Do we need a beta?\n';
  const d = noteDesk('m.md', note, [], '2026-10-06');
  const card = (words) => d.nodes.find((n) => n.text === words);
  const set = (n, to) => ({ ...n, from: { ...n.from, to } });
  const out = toNote(note, [set(card('Do we need a beta?'), { decided: 'No beta: we ship to everyone.' }), set(card('Which day?'), { decided: '' }), set(card('Draft the notes @ann'), { done: true }), card('Book the room')]);
  assert.equal(out, '# M\n\n> [!decision] No beta: we ship to everyone.\n\n> [!decision] Which day?\n\n- [x] Draft the notes @ann\n- [ ] Book the room\n\n## Wrap-up\n\n### Open questions\n\n> [!decision] No beta: we ship to everyone.\n');
  // Gone from the note since: nothing asked of it.
  assert.equal(toNote('# M\n', [set(card('Which day?'), { decided: 'Friday' })]), '# M\n');
});

test('requestText and picturesOf: the pictures of a card named in its text, sent in that order; a card seen in a talk, not again', () => {
  const cards = [
    { n: 1, key: 'a', title: 'shot', text: '', pictures: [{ media: 'image/jpeg', data: 'AA', what: 'the picture shot.png' }] },
    { n: 2, key: 'b', title: '', text: 'Is this right?', pictures: [{ media: 'image/png', data: 'BB', what: 'the part of shot.png it marks' }, { media: 'image/jpeg', data: 'CC', what: 'the whole of shot.png' }] },
  ];
  assert.match(requestText('region', cards), /^Cards:\n#1 "shot":\n\[picture 1: the picture shot\.png\]\n\n#2 card:\nIs this right\?\n\[picture 2: the part of shot\.png it marks\]\n\[picture 3: the whole of shot\.png\]\n\nRequest \(cards #1, #2\): Each marked card/);
  assert.deepEqual(picturesOf(cards).map((p) => p.data), ['AA', 'BB', 'CC']);
  const seen = new Map([['a', '']]);
  assert.deepEqual(picturesOf(cards, seen).map((p) => p.data), ['BB', 'CC']);
  assert.match(requestText('chat', cards, 'why?', seen), /^Cards:\n#2 card:\nIs this right\?\n\[picture 1: the part/);
});

test('answerLang: the cards\' words decide, not their titles, tags or links; a question in a talk by itself; Settings win', () => {
  // "출시는 20일로 확정했다" under an English title, with English tags and a link.
  const ko = { n: 1, title: 'Launch sync 2026-10-07', text: '## Agenda (10m)\n- \uCD9C\uC2DC\uB294 20\uC77C\uB85C \uD655\uC815\uD588\uB2E4 #decision @ann [[Launch plan]]\n- QA \uCCB4\uD06C\uB9AC\uC2A4\uD2B8 \uD655\uC778 #todo https://example.com/a/very/long/link' };
  const en = { n: 2, title: '\uD68C\uC758', text: 'We ship on the 20th; the store review may take a week.' };
  assert.equal(answerLang([ko]), 'ko');
  assert.equal(answerLang([en]), 'en');
  assert.equal(answerLang([]), 'en');
  assert.equal(answerLang([ko], 'what is left open?'), 'en');
  assert.equal(answerLang([en], '\uBB50\uAC00 \uB0A8\uC558\uC9C0?'), 'ko');
  assert.equal(answerLang([ko], '', 'en'), 'en');
  assert.equal(answerLang([en], '', 'ko'), 'ko');
  // Pictures have no words: the system's language; what the server says for a file is not the card's.
  const pic = { n: 3, title: 'shot', text: '', pictures: [{ what: 'the picture shot.png' }] };
  assert.equal(answerLang([pic], '', '', 'ko-KR'), 'ko');
  assert.equal(answerLang([pic, { n: 4, title: 'a.pdf', text: '(a file that is not a note)' }], '', '', 'ko'), 'ko');
  assert.equal(answerLang([pic], '', '', 'en-US'), 'en');
  assert.equal(answerLang([pic]), 'en');
  assert.equal(answerLang([pic, ko], '', '', 'en-US'), 'ko');
  // The workspace's notes, for the fallback.
  assert.equal(textLang([ko.text, en.text, '']), 'ko');
  assert.equal(textLang([en.text]), 'en');
  assert.equal(textLang(['', '#tag [[x]]']), '');
  // Said at the end of the request, in so many words.
  assert.match(requestText('summary', [ko], '', undefined, 'ko'), /\n\nAnswer in Korean \(\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694\)\.$/);
  assert.match(requestText('questions', [en], '', undefined, 'en'), /\n\nAnswer in English\.$/);
});
