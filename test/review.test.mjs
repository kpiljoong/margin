// A review (Labs): topics checked against the vault's folders, a session's
// to-dos in the vault's format, the desk it is laid out on, and the server
// with a stand-in for the claude CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { reviewDesk, toNote } from '../public/desk.js';
import { meetingItems } from '../public/meeting.js';

const require = createRequire(import.meta.url);
const review = require('../lib/review.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('topics: only the vault\'s folders (or a new project as its rules name one); the goal written, guessed or not known', () => {
  const folders = ['01-projects/tramio', '02-areas/career'];
  const t = review.parseTopics([
    'title: Honeymoon bookings', 'folder: none', 'notes: 1, 2, 9', 'goal: Book it all before the 27th', 'goal from: guess', 'ask: Is it the honeymoon in October?', '---',
    'title: Tramio launch', 'folder: 01-projects/tramio/', 'notes: 3', 'goal: Ship Tramio', 'goal from: 3', 'ask: Not asked.', '---',
    'title: Seller tools', 'folder: new: 01-projects/seller-tools', 'notes: 4', 'goal: x', 'goal from: 2', '---',
    'title: Bad folder', 'folder: 03-resources/x', 'notes: 5', 'goal:', 'goal from: unknown', 'ask: What is it for?', '---',
    'title: No notes', 'folder: none', 'notes: 99',
  ].join('\n'), 5, folders);
  assert.deepEqual(t.map((x) => [x.title, x.folder, x.isNew, x.notes, x.goalState, x.goalFrom, x.ask]), [
    ['Honeymoon bookings', '', false, [1, 2], 'guessed', null, 'Is it the honeymoon in October?'],
    ['Tramio launch', '01-projects/tramio', false, [3], 'stated', 3, ''],
    ['Seller tools', '01-projects/seller-tools', true, [4], 'guessed', null, ''],
    ['Bad folder', '', false, [5], 'unknown', null, 'What is it for?'],
  ]);
  assert.match(review.topicsText({ folders, notes: [{ path: 'a.md', date: '2026-10-01', text: 'A.', copies: 2 }], today: '2026-10-09' }), /^Folders:\n01-projects\/tramio\n02-areas\/career\n\nNotes:\n\[1\] a\.md \(2026-10-01, 3 copies\):\nA\.\n\nToday: 2026-10-09$/);
});

test('a session: to-dos in the vault\'s format or none, the most important first, a consider once', () => {
  const projects = new Set(['honeymoon', 'tramio']);
  assert.equal(review.todoLine('- [ ] Book the Napa tour \u{1F4C5} 2026-10-14 #project/honeymoon', projects), '- [ ] Book the Napa tour \u{1F4C5} 2026-10-14 #project/honeymoon');
  assert.equal(review.todoLine('`- [ ] Ask Ben #project/nope`', projects), '- [ ] Ask Ben', 'a project that is not one: its tag out');
  assert.equal(review.todoLine('- [ ] Call them tomorrow', projects), '', 'a date as the rules never write it');
  assert.equal(review.todoLine('- [ ] \uB0B4\uC77C \uC804\uD654\uD558\uAE30', projects), '');
  assert.equal(review.todoLine('- [ ] Book \u{1F4C5} soon', projects), '');
  assert.equal(review.todoLine('Book it', projects), '');
  assert.equal(review.todoLine('- [ ] Book the return flight \u{1F4C5} 2026-10-12 \u23EB', projects, new Set(['2026-10-27'])), '- [ ] Book the return flight \u23EB', 'a day not written anywhere it was given: without it');
  assert.equal(review.todoLine('- [ ] Book it \u{1F4C5} 2026-10-27', projects, new Set(['2026-10-27'])), '- [ ] Book it \u{1F4C5} 2026-10-27');
  const s = review.parseSession([
    'mine: T1, T2, T4', 'maybe done: T2 (written as booked in N3), T3 (not mine), T9', '---',
    'kind: decide', 'say: Half a day or a whole one in Napa.', 'why: It sets the nights in SF', 'from: N1, [2]', 'todo: - [ ] Decide the Napa tour \u{1F4C5} 2026-10-14 #project/honeymoon', '---',
    'kind: consider', 'say: One.', '---', 'kind: consider', 'say: Two.', '---',
    'kind: praise', 'say: Nice.', '---',
    'kind: ask', 'say: Booked already?', 'from: N7',
  ].join('\n'), { nNotes: 3, nOlder: 2, nTodos: 4, projects });
  assert.deepEqual(s.mine, [1, 2, 4]);
  assert.deepEqual(s.maybe, [{ t: 2, why: 'written as booked in N3' }]);
  assert.deepEqual(s.items.map((x) => [x.kind, x.why, x.notes, x.older, x.todo]), [
    ['decide', 'It sets the nights in SF', [1], [2], '- [ ] Decide the Napa tour \u{1F4C5} 2026-10-14 #project/honeymoon'],
    ['consider', '', [], [], ''],
    ['ask', '', [], [], ''],
  ]);
  assert.match(review.SESSION.join('\n'), /not in the notes found/);
  assert.match(review.sessionText({ topic: { title: 'Trip', goal: 'Book it', goalState: 'unknown' }, notes: [{ path: 'a.md', date: '2026-10-01', text: 'A.' }], todos: ['- [ ] x'] }), /Goal \(unknown\): Book it[\s\S]*N1 a\.md \(2026-10-01\):\nA\.[\s\S]*Older paragraphs:\n\(none found\)[\s\S]*Open to-dos:\nT1 - \[ \] x/);
});

test('a to-do of the assistant\'s list done: [x] and the day at its end, its link and marks kept', () => {
  const list = '# Todo\n\n- [ ] ESTA \uC2E0\uCCAD\uD558\uAE30 ⏫ [[99-assistant/inbox-archive/2026-09#2026-09-27 0538 df|\uC6D0\uBB38]]\n- [ ] Old one ↪ \uC62E\uAE40 [[x]]\n';
  const it = meetingItems(list).find((i) => /ESTA/.test(i.text));
  const card = { from: { file: '99-assistant/todo.md', line: it.line, kind: 'todo', key: it.key, tasks: true, to: { done: true, on: '2026-10-09' } } };
  assert.equal(toNote(list, [card]), '# Todo\n\n- [x] ESTA \uC2E0\uCCAD\uD558\uAE30 ⏫ [[99-assistant/inbox-archive/2026-09#2026-09-27 0538 df|\uC6D0\uBB38]] ✅ 2026-10-09\n- [ ] Old one ↪ \uC62E\uAE40 [[x]]\n');
  // A note's own to-do (not a Tasks list): ticked, as before.
  const note = '- [ ] Draft it\n';
  const n = meetingItems(note)[0];
  assert.equal(toNote(note, [{ from: { kind: 'todo', key: n.key, to: { done: true } } }]), '- [x] Draft it\n');
});

test('a topic laid out: its goal and question, the to-dos that may be done (knowing their lines), its notes, the margin beside them', () => {
  const { desk, margin } = reviewDesk({
    title: 'Honeymoon', goal: 'Book it all', goalState: 'guessed', ask: 'Before the 27th?',
    todos: [{ file: '99-assistant/todo.md', line: 3, key: 'todo:esta', text: 'ESTA', why: 'written as done in N2', tasks: true }],
    notes: ['trip/plan.md', 'trip/flights.md'],
    items: [{ kind: 'decide', say: 'Half a day or a whole one.', why: 'It sets the nights', from: ['trip/plan.md'], todo: '- [ ] Decide it' }, { kind: 'ask', say: 'A.' }, { kind: 'ask', say: 'B.' }, { kind: 'missing', say: 'C.', why: 'later' }],
    at: '2026-10-09',
  });
  assert.deepEqual(desk.nodes.filter((n) => n.type === 'group').map((n) => n.label), ['The goal', 'Done already? (x: done)', 'Its notes']);
  const goal = desk.nodes.find((n) => n.type === 'text' && /Goal/.test(n.text));
  assert.equal(goal.text, '**Honeymoon**\n\nGoal (a guess): Book it all\n\n? Before the 27th?');
  const todo = desk.nodes.find((n) => n.from);
  assert.deepEqual(todo.from, { file: '99-assistant/todo.md', line: 3, kind: 'todo', key: 'todo:esta', at: '2026-10-09', tasks: true });
  assert.equal(todo.text, 'ESTA\n\n_written as done in N2_');
  assert.deepEqual(desk.nodes.filter((n) => n.type === 'file').map((n) => n.file), ['trip/plan.md', 'trip/flights.md']);
  assert.deepEqual(margin.map((m) => [m.kind, m.title]), [['review', 'To decide'], ['review', 'A question'], ['review', 'A question'], ['review', 'Missing']]);
  assert.equal(margin[0].text, 'Half a day or a whole one.\n\n_First: It sets the nights_\n\nFrom: [[trip/plan]]\n\nTo-do: `- [ ] Decide it`');
  assert.match(margin[3].text, /_Then: later_/);
  assert.ok(margin.every((m, i) => i === 0 || m.y > margin[i - 1].y), 'one under another, the first on top');
  assert.ok(margin[0].x > Math.max(...desk.nodes.map((n) => n.x + n.width)) - 1, 'beside the cards');
  assert.deepEqual(reviewDesk({ title: 'T', goalState: 'stated', goal: 'G', goalFrom: 'a/b.md', notes: ['a/b.md'] }).desk.nodes.filter((n) => n.type === 'group').map((n) => n.label), ['The goal', 'Its notes'], 'nothing may be done: no such group');
});

// A stand-in for the claude CLI: topics for "Folders:", a session for "Today:".
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(j.message.content) + '\\n');
    const text = /^Folders:/.test(j.message.content)
      ? 'title: Honeymoon\\nfolder: none\\nnotes: 1, 2\\ngoal: Book it all before the trip\\ngoal from: guess\\nask: Is the trip on the 27th?'
      : 'mine: T1, T2\\nmaybe done: T2 (the plan says the ESTA came)\\n---\\nkind: decide\\nsay: Half a day or a whole one in Napa.\\nwhy: It sets the nights\\nfrom: N1\\ntodo: - [ ] Decide the Napa tour #project/nope\\n---\\nkind: ask\\nsay: Are the flights booked?';
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: topics of the recent notes (not the assistant\'s records, never a private note), one on a desk with its margin', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-review-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-review-bin-'));
  t.after(() => { for (const d of [ws, bin]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  for (const d of ['trip', '99-assistant/log', '99-assistant/rules', '01-projects/tramio']) fs.mkdirSync(path.join(ws, d), { recursive: true });
  fs.writeFileSync(path.join(ws, 'trip/plan.md'), '# Plan\n\nLA first, then SF, then New York. Napa tour: half a day or a whole one?\n\n- [ ] Book the Napa tour \u{1F4C5} 2026-01-02\n');
  fs.writeFileSync(path.join(ws, 'trip/flights.md'), '# Flights\n\nICN to SFO on the 27th, about 1.2M won each; not booked yet.\n');
  fs.writeFileSync(path.join(ws, 'trip/plan (copy).md'), '# Plan\n\nLA first, then SF, then New York. Napa tour: half a day or a whole one?\n\n- [ ] Book the Napa tour \u{1F4C5} 2026-01-02\n');
  // The same beginning, another end (a decision made since): not a copy.
  fs.writeFileSync(path.join(ws, 'trip/napa 2.md'), `# Napa\n\n${'The Napa tour, half a day or a whole one, as the guide says. '.repeat(6)}\n\nDecided: a whole day.\n`);
  fs.writeFileSync(path.join(ws, 'trip/napa.md'), `# Napa\n\n${'The Napa tour, half a day or a whole one, as the guide says. '.repeat(6)}\n\nNot decided yet.\n`);
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret plan for the trip, long enough to be read.\n');
  fs.writeFileSync(path.join(ws, '99-assistant/log/2026-10-05.md'), '- 18:48 a record of the assistant, long enough to be a note\n');
  fs.writeFileSync(path.join(ws, '99-assistant/rules/todo-format.md'), '# Todo rules\n\n- [ ] <what to do> [\u{1F4C5} YYYY-MM-DD]\n');
  fs.writeFileSync(path.join(ws, '99-assistant/todo.md'), '# Todo\n\n- [ ] Apply for the ESTA ⏫ [[99-assistant/inbox-archive/2026-09#a|src]]\n- [ ] Old one ↪ moved [[x]]\n- [x] Done long ago\n');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open', '--agent', path.join(bin, 'claude')], { env: { ...process.env, FAKE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const api = async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}${p}`, { method, headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...(await r.json()) };
  };
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const tp = await api('POST', '/api/lab/review/topics', {});
  assert.equal(tp.status, 200, tp.error);
  assert.equal(tp.topics.length, 1);
  assert.equal(tp.topics[0].goalState, 'guessed');
  assert.match(sent()[0], /^Folders:\n01-projects\/tramio\n/);
  assert.match(sent()[0], /trip\/plan\.md \([\d-]+, 2 copies\)/, 'a copy once (as the first was named), with how many');
  assert.doesNotMatch(sent()[0], /\(copy\)/);
  assert.match(sent()[0], /Decided: a whole day/);
  assert.match(sent()[0], /Not decided yet/);
  assert.doesNotMatch(sent()[0], /secret|a record of the assistant|Todo rules|Apply for the ESTA/, 'not private, not the assistant\'s records, rules or list');
  assert.equal(tp.topics[0].notes.length, 2);
  const topic = { ...tp.topics[0], notes: ['trip/plan.md', 'trip/flights.md'] };
  const d = await api('POST', '/api/lab/review/desk', { topic });
  assert.equal(d.status, 200, d.error);
  assert.match(d.path, /^Reviews\/Honeymoon \d{4}-\d{2}-\d{2}\.canvas$/);
  const s = sent()[1];
  assert.match(s, /^Today: \d{4}-\d{2}-\d{2}\n\nTopic: Honeymoon\n\nGoal \(a guess\): Book it all before the trip/);
  assert.match(s, /Open to-dos:\nT1 Book the Napa tour .* \(trip\/plan\.md\)\nT2 Apply for the ESTA/);
  assert.doesNotMatch(s, /Old one|Done long ago/, 'not one moved elsewhere, nor one done');
  const desk = JSON.parse(fs.readFileSync(path.join(ws, d.path), 'utf8'));
  const todos = desk.nodes.filter((n) => n.from?.kind === 'todo');
  assert.deepEqual(todos.map((n) => [n.text.split('\n')[0].replace(/ \u{1F4C5}.*/u, ''), n.from.file, !!n.from.tasks]), [['Book the Napa tour', 'trip/plan.md', false], ['Apply for the ESTA \u23EB [[99-assistant/inbox-archive/2026-09#a|src]]', '99-assistant/todo.md', true]]);
  assert.match(todos[0].text, /Its day has passed/);
  assert.match(todos[1].text, /the plan says the ESTA came/);
  const mg = await api('GET', `/api/desk/margin?path=${encodeURIComponent(d.path)}`);
  assert.deepEqual(mg.cards.map((c) => [c.kind, c.title]), [['review', 'To decide'], ['review', 'A question']]);
  assert.match(mg.cards[0].text, /To-do: `- \[ \] Decide the Napa tour`/, 'a project that is not one: its tag out');
  // Again today: the same desk, nothing asked.
  const again = await api('POST', '/api/lab/review/desk', { topic });
  assert.deepEqual([again.path, again.existed], [d.path, true]);
  assert.equal(sent().length, 2);
  assert.equal((await api('POST', '/api/lab/review/desk', { topic: { ...topic, notes: ['secret.md'] }, again: true })).status, 400, 'a private note alone: nothing to read');
});
