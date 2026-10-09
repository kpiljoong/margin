// -*- coding: utf-8 -*-
import test from 'node:test';
import assert from 'node:assert/strict';
import { talkLang, questionOf, sortedLines, openingText, closingText, todoWhy, noteGist, spaceLayout } from '../public/talk.js';

test('a review talked through: in the notes\' language, one thing asked as the margin wrote it', () => {
  assert.equal(talkLang('\uD56D\uACF5\uC740 SF'), 'ko');
  assert.equal(talkLang('Flights: SF'), 'en');
  const q = questionOf({ title: 'Your pick · To decide', text: 'Napa: half a day or a whole one?\n\n_First: it moves the days_\n\nFrom: [[trip/napa]]\n\nTo-do: `- [ ] Book the Napa tour`' }, 'ko');
  assert.deepEqual(q, { label: '\uC774\uBC88\uC5D0 \uC815\uD558\uAE30\uB85C \uD55C \uAC83', say: 'Napa: half a day or a whole one?', why: 'it moves the days', todo: '- [ ] Book the Napa tour', from: ['trip/napa.md'] });
  assert.equal(questionOf({ title: 'Doesn’t agree', text: 'A or B' }, 'en').label, 'Doesn’t agree');
  assert.equal(todoWhy('_Another note gives it another state: [[trip/plan]]_', 'ko'), 'plan\uC5D0\uB294 \uC0C1\uD0DC\uAC00 \uB2E4\uB974\uAC8C \uC801\uD600 \uC788\uC5B4\uC694.');
  assert.equal(todoWhy('Its day (2026-10-01) has passed: is it done?', 'en'), 'Its day (2026-10-01) has passed: is it done?');
});

test('what was jotted, said back a line each; where it stands, said at the start and the end', () => {
  const lines = sortedLines([
    { jot: { kind: 'decided', say: 'Fly into SF', about: 'trip/01_plan.md', ticks: { text: 'Book the flights ⏫ [[99-assistant/inbox-archive/2026-09#a|src]]' } } },
    { jot: { kind: 'later', say: 'Napa: next week' } },
    { jot: { kind: 'withdrawn', say: 'x', replaces: 'Dinner at the pier → [[trip/plan]]' } },
    { jot: { kind: 'decided', say: 'Lunch at the market', replaces: 'Lunch at the pier' } },
    { jot: { kind: 'todo', say: 'book it' }, text: 'Book it\n\nTo-do: `- [ ] Book the cafe 📅 2026-10-20`' },
  ], 'en');
  assert.deepEqual(lines, ['Decided: Fly into SF (01_plan) — the to-do “Book the flights” done', 'Later: Napa: next week', 'Called off: Dinner at the pier', 'Changed: Lunch at the pier → Lunch at the market', 'To do: Book the cafe 📅 2026-10-20']);
  const mine = { goal: '', focus: ['Napa'], decided: ['A'], later: [], withdrawn: [] };
  assert.equal(openingText({ title: 'Trip', goal: 'Book it all', goalState: 'guessed', mine, n: 3 }, 'en'), 'Let’s go through Trip.\n\nI guessed the goal is “Book it all” — tell me if not.\n\nSo far 1 decided. You chose to settle: “Napa”.\n\n3 things to ask, one at a time. Write whatever comes to mind, any time.');
  assert.match(openingText({ title: 'T', goal: '', goalState: 'unknown', mine: { ...mine, goal: 'Mine' }, n: 0 }, 'ko'), /^T \uC815\uB9AC\uB97C \uC2DC\uC791\uD560\uAC8C\uC694\.\n\n\uBAA9\uD45C: Mine\n/);
  assert.equal(closingText({ decisions: [{ inNote: true }, { inNote: false }], later: 1, todos: ['- [ ] x'], waiting: [{}], withdrawals: [{ note: 'a' }, { note: 'a' }] }, 'en'),
    'That’s all I had to ask.\n\n2 decided so far, 1 not in the notes yet. 1 put off. 1 to-do next.\n\n1 proposal waiting in the notes mix in changes from a decision not decided now: look before accepting.\n\nA decision called off is still written as decided in 1 note.');
});

test('to-dos proposed done from the talk: said as the note has each now — made, done there already, or not found', async () => {
  const { Desk } = await import('../public/desk.js');
  const { meetingItems } = await import('../public/meeting.js');
  const note = '# Trip\n\n- [ ] Book the flights\n- [x] Apply for the ESTA\n';
  const key = (t) => meetingItems(note).find((i) => i.body.includes(t)).key;
  const card = (id, k) => ({ id, type: 'text', text: id, from: { file: 'trip.md', kind: 'todo', key: k, to: { done: true } } });
  let proposed = null;
  const fake = {
    d: { nodes: [card('a', key('flights')), card('b', key('ESTA')), card('c', 'todo:gone')], edges: [] },
    opts: { proposeNote: async (f, make) => { proposed = make(note); return 'r1'; } },
    event() {},
    change(next) { this.d = next; },
  };
  const r = await Desk.prototype.sendToNote.call(fake, 'trip.md', { open: false }, ['a', 'b', 'c']);
  assert.deepEqual(r, { id: 'r1', made: ['a'], there: ['b'], gone: ['c'] });
  assert.match(proposed, /- \[x\] Book the flights/);
  assert.deepEqual(fake.d.nodes.map((n) => !!n.from.sent), [true, false, false], 'only what it made is sent');
  // Nothing to change (only one gone): not proposed, none sent.
  fake.opts.proposeNote = async (f, make) => (make(note) === note ? false : 'r2');
  assert.deepEqual(await Desk.prototype.sendToNote.call(fake, 'trip.md', { open: false }, ['c']), { id: null, made: [], there: [], gone: ['c'] });
  // From the desk's own button (all its marked cards): the same — only what it made is sent.
  fake.d.nodes = [card('a', key('flights')), card('c', 'todo:gone')];
  fake.opts.proposeNote = async (f, make) => { make(note); return 'r3'; };
  assert.deepEqual(await Desk.prototype.sendToNote.call(fake, 'trip.md'), { id: 'r3', made: ['a'], there: [], gone: ['c'] });
  assert.deepEqual(fake.d.nodes.map((n) => !!n.from.sent), [true, false]);
});

test('where a note says what a question is about: its line with the most words of it, none from its front matter or headings', async () => {
  const { evidence, questionOf } = await import('../public/talk.js');
  const note = '---\ntitle: \uD56D\uACF5\uAD8C \uC785\uAD6D \uBE44\uAD50\n---\n# \uD56D\uACF5\uAD8C \uC785\uAD6D \uBE44\uAD50\n\n- \uAE30\uC900 \uC5EC\uC815: \uC778\uCC9C→\uC0CC\uD504\uB780\uC2DC\uC2A4\uCF54 \uC785\uAD6D, LA \uCD9C\uAD6D \uCD94\uCC9C\n- \uB80C\uD130\uCE74\uB294 \uB098\uC911\uC5D0\n';
  assert.deepEqual(evidence(note, '\uD56D\uACF5\uAD8C \uC785\uAD6D \uB3C4\uC2DC: \uC0CC\uD504\uB780\uC2DC\uC2A4\uCF54 \uC785\uAD6D \uCD94\uCC9C vs LA \uC785\uAD6D'), [{ line: 5, text: '- \uAE30\uC900 \uC5EC\uC815: \uC778\uCC9C→\uC0CC\uD504\uB780\uC2DC\uC2A4\uCF54 \uC785\uAD6D, LA \uCD9C\uAD6D \uCD94\uCC9C' }]);
  assert.deepEqual(evidence(note, '\uB274\uC695 \uBBF8\uC220\uAD00 \uD6C4\uBCF4'), [], 'nothing much in common: none');
  assert.deepEqual(evidence('- \uD504\uB85C\uC81D\uD2B8 \uB9C8\uAC10\uC740 \uAE08\uC694\uC77C\n', '\uC774 \uD504\uB85C\uC81D\uD2B8 \uC5B8\uC81C \uB05D\uB098\uB098'), [], 'one word in common (its letter pairs counted once): none');
  assert.deepEqual(questionOf({ title: 'Doesn’t agree', text: 'A or B\n\nFrom: [[trip/air]], [[trip/plan.md]]' }).from, ['trip/air.md', 'trip/plan.md']);
});

test('noteGist: a note in a few words, from what it says itself', () => {
  const g = noteGist('---\ntags: [trip]\n---\n# Flights\n\n- [ ] Book SFO #project/trip\n- [x] Pick dates\n\nWe fly on the 3rd, see [[plan]] and [[trip/hotel|the hotel]].\n\n- Dinner at the pier #decision\n', 'trip/flights.md');
  assert.deepEqual(g, { file: 'trip/flights.md', title: 'Flights', gist: 'We fly on the 3rd, see plan and the hotel.', todos: 1, decisions: 1, links: ['plan', 'trip/hotel'] });
  assert.equal(noteGist('---\nsummary: "All of it"\n---\nText', 'a.md').gist, 'All of it');
  assert.equal(noteGist('- [ ] One 📅 2026-10-12\n- Two #decision', 'x/list.md').gist, 'One · Two', 'only lists: its first items, without their marks');
  assert.equal(noteGist('', 'x/empty.md').title, 'empty');
});

test('spaceLayout: linked notes on one side, the sides about as full, a note asked about forward, each showing where it is meant to', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const p = spaceLayout({ w: 1400, h: 700, ids, links: [['a', 'c'], ['c', 'e']], now: new Set(['d']) });
  assert.equal(new Set(['a', 'c', 'e'].map((i) => p.get(i).side)).size, 1, 'linked together');
  assert.notEqual(p.get('b').side, p.get('a').side);
  assert.ok(p.get('d').z > 0, 'forward');
  assert.ok(['a', 'b', 'c', 'e'].every((i) => p.get(i).z < 0));
  // Seen through the perspective (1000, from the middle and 40% down), each card's middle is on its side, outside the talk's column.
  for (const [, q] of p) {
    const k = 1000 / (1000 - q.z);
    const sx = 700 + (q.x + 110 - 700) * k;
    const half = 110 * k;
    assert.ok(q.side === 0 ? sx + half <= 700 - 340 && sx - half >= 0 : sx - half >= 700 + 340 && sx + half <= 1400, `${sx} on side ${q.side}`);
  }
});
