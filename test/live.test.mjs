// node --test (npm test): the live margin (public/live.js, lib/live.js) — a
// line's chip by rule, its date, the model's reply as it streams, and the
// line the note gets when the minutes are kept; the resident session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wanted, ruleOf, dueOf, leadOf, parseReply, keptLine, keepEdit, keepAll, memoryOf, plainReply, asked, quantile } from '../public/live.js';

const require = createRequire(import.meta.url);
const server = require('../lib/live.js');
const MON = new Date(2026, 9, 12); // Monday, October 12, 2026

test('ruleOf: a chip at once, before any model', () => {
  assert.equal(ruleOf('-> go w/ 20th', MON).kind, 'decision');
  assert.equal(ruleOf('press kit?? bob unsure', MON).kind, 'question');
  assert.deepEqual(ruleOf('ann: survey thurs', MON), { kind: 'todo', fixed: false, owner: 'ann', due: '2026-10-15' });
  assert.deepEqual(ruleOf('- [ ] Draft the notes @bob', MON), { kind: 'todo', fixed: true, owner: 'bob', due: null });
  assert.equal(ruleOf('> [!question] A press kit?', MON).fixed, true);
  assert.equal(ruleOf('beta 40 ppl, 92% done', MON).kind, 'note');
  assert.equal(ruleOf('\uCD9C\uC2DC\uC77C 20\uC77C\uB85C \uACB0\uC815', MON).kind, 'decision');
  assert.equal(ruleOf('\uBBFC\uC218: \uBAA9\uC694\uC77C\uAE4C\uC9C0 \uC124\uBB38 \uBCF4\uB0B4\uAE30', MON).due, '2026-10-15');
  // A risk, an idea, one for next time.
  assert.equal(ruleOf('store review might slip a week', MON).kind, 'risk');
  assert.equal(ruleOf('\uC2EC\uC0AC \uC9C0\uC5F0 \uC704\uD5D8', MON).kind, 'risk');
  assert.equal(ruleOf('what if the first month is free?', MON).kind, 'idea');
  assert.equal(ruleOf('\uCCAB \uB2EC \uBB34\uB8CC\uB294 \uC5B4\uB54C?', MON).kind, 'idea');
  assert.equal(ruleOf('\uC624\uD37C \uBC94\uC704\uB294 \uB2E4\uC74C \uD68C\uC758\uC5D0\uC11C', MON).kind, 'next');
  assert.deepEqual(ruleOf('- offer range #next', MON), { kind: 'next', fixed: true, owner: null, due: null });
  assert.equal(ruleOf('> [!warning] Review may slip', MON).kind, 'risk');
  assert.equal(ruleOf('> [!idea] Free month', MON).fixed, true);
});

test('dueOf: the next such weekday, tomorrow, a month/day', () => {
  assert.equal(dueOf('by friday', MON), '2026-10-16');
  assert.equal(dueOf('next mon', MON), '2026-10-19');
  assert.equal(dueOf('tomorrow', MON), '2026-10-13');
  assert.equal(dueOf('due 10/30', MON), '2026-10-30');
  assert.equal(dueOf('due 1/5', MON), '2027-01-05');
  assert.equal(dueOf('2026-11-02', MON), '2026-11-02');
  assert.equal(dueOf('this month', MON), null);
  assert.equal(dueOf('\uB9B4\uB9AC\uC988 \uC77C\uC2DC: 2026\uB144 10\uC6D4 10\uC77C', MON), '2026-10-10');
  assert.equal(dueOf('3\uC6D4 2\uC77C\uAE4C\uC9C0', MON), '2027-03-02');
});

test('a list item: its lead-in says what the items are', () => {
  // "Release: 2026-10-10 / Before that, to finish: / - QA? / - the tool / - Gmarket"
  const lines = ['## Plan (10m)', '\uB9B4\uB9AC\uC988 \uC77C\uC2DC: 2026\uB144 10\uC6D4 10\uC77C', '\uADF8\uC804\uC5D0 \uC644\uB8CC \uD574\uC57C \uD560 \uAC83:', '- QA \uD544\uC694\uD55C\uC9C0 \uACB0\uC815', '- \uD234 \uBC30\uD3EC', '- \uC9C0\uB9C8\uCF13 \uC9C0\uC6D0'];
  assert.equal(leadOf(lines, 4), lines[2]);
  assert.equal(leadOf(lines, 2), null);
  assert.equal(leadOf(['## Plan', '- a'], 1), null);
  for (const i of [3, 4, 5]) assert.equal(ruleOf(lines[i], MON, leadOf(lines, i)).kind, 'todo');
  assert.equal(ruleOf('- book the venue', MON, 'To do before Oct 30:').kind, 'todo');
  assert.equal(ruleOf('- the venue', MON, 'We talked about:').kind, 'note');
  assert.equal(ruleOf('- book the venue', MON, 'to do by 2026-10-30:').due, '2026-10-30');
});

test('parseReply: the head once its bracket closes, then the sentence (both sides)', () => {
  for (const parse of [parseReply, server.parseReply]) {
    assert.deepEqual(parse('[to'), { head: false, sentence: '' });
    assert.deepEqual(parse('[todo @bob 2026-10-15] Bob drafts'), { head: true, kind: 'todo', owner: 'bob', due: '2026-10-15', sentence: 'Bob drafts', remark: '' });
    assert.equal(parse('[decision] We launch on October 20.').sentence, 'We launch on October 20.');
    assert.equal(parse('[whatever] Hi').kind, null);
    assert.equal(parse('[todo @bob] Bob drafts the notes; [todo @mina] Mina reviews').sentence, 'Bob drafts the notes; Mina reviews');
    assert.equal(parse('[todo @bob] Bob drafts the notes,\n[todo @mina] Mina reviews').sentence, 'Bob drafts the notes, Mina reviews');
    assert.equal(parse('No head at all.').sentence, 'No head at all.');
    // A remark after "||" (a partial "|" while it streams is not shown).
    assert.deepEqual([parse('[decision] We launch Oct 27. |').sentence, parse('[decision] We launch Oct 27. |').remark], ['We launch Oct 27.', '']);
    const r = parse('[decision] We launch Oct 27. || Last meeting set Oct 20. Changed?');
    assert.deepEqual([r.sentence, r.remark], ['We launch Oct 27.', 'Last meeting set Oct 20. Changed?']);
  }
});

test('ask the margin: a ?? line, answered, kept in its place', () => {
  assert.equal(asked('?? when did we say'), true);
  assert.equal(asked('press kit?? bob unsure'), false);
  assert.deepEqual(ruleOf('?? when did we say the beta ends', MON), { kind: 'answer', fixed: true, owner: null, due: null });
  assert.equal(plainReply('The beta ends\non Oct 30.\n'), 'The beta ends on Oct 30.');
  assert.equal(plainReply('[note] It ends Oct 30.'), 'It ends Oct 30.');
  assert.equal(keptLine({ kind: 'answer', sentence: 'It ends Oct 30.' }), 'It ends Oct 30.');
  assert.deepEqual(keepEdit('a\n  ?? when\nb', 1, { kind: 'answer', sentence: 'Oct 30.' }), { from: 2, to: 11, insert: '  Oct 30.', caret: 11 });
});

test('memoryOf: the last meeting, as the margin is told it', () => {
  const items = [
    { kind: 'decision', body: 'We launch on Oct 20' },
    { kind: 'todo', body: 'QA checklist', owner: 'sua', due: '2026-10-09' },
    { kind: 'todo', body: 'Book the venue', done: true },
    { kind: 'question', body: 'A press kit?' },
    { kind: 'next', body: 'Pricing' },
  ];
  assert.equal(memoryOf('Weekly 2026-10-05', items), 'Last meeting (Weekly 2026-10-05):\nDecided: We launch on Oct 20\nOpen to-dos: QA checklist @sua (due 2026-10-09)\nDone: Book the venue\nOpen questions: A press kit?\nLeft for this meeting: Pricing');
  assert.equal(memoryOf('W', []), '');
  const long = memoryOf('W', Array.from({ length: 200 }, (_, i) => ({ kind: 'decision', body: `decision number ${i}` })), 300);
  assert.equal(long.length, 300);
  assert.ok(long.endsWith('\u2026'));
});

test('keepAll: every line the margin answered, kept as Tab would, from the bottom up', () => {
  const text = '## Plan (10m)\nlaunch 20th ok\n- [ ] Draft @bob\nann: survey thurs\n?? when\nbeta ok\nlater';
  const entries = new Map([
    ['launch 20th ok', { kind: 'decision', state: 'done', sentence: 'We launch on the 20th.' }],
    ['- [ ] Draft @bob', { kind: 'todo', fixed: true, state: 'done', sentence: 'Bob drafts.' }],
    ['ann: survey thurs', { kind: 'todo', state: 'done', owner: 'ann', due: '2026-10-15', sentence: 'Ann sends the survey.' }],
    ['?? when', { kind: 'answer', fixed: true, state: 'done', sentence: 'Oct 20.' }],
    ['beta ok', { kind: 'note', state: 'gone', sentence: 'Beta is fine.' }],
    ['later', { kind: 'note', state: 'stream', sentence: 'La' }],
  ]);
  assert.equal(keepAll(text, entries), '## Plan (10m)\n\n> [!decision] We launch on the 20th.\n\n- [ ] Draft @bob\n- [ ] Ann sends the survey. @ann \u{1F4C5} 2026-10-15\n?? when\nbeta ok\nlater');
});

test('keptLine and keepEdit: the line as the meeting writes it, a callout apart', () => {
  assert.equal(keptLine({ kind: 'todo', sentence: 'Send the beta survey.', owner: 'ann', due: '2026-10-15' }), '- [ ] Send the beta survey. @ann \u{1F4C5} 2026-10-15');
  assert.equal(keptLine({ kind: 'decision', sentence: ' We  launch on the 20th. ' }), '> [!decision] We launch on the 20th.');
  assert.equal(keptLine({ kind: 'note', sentence: 'Beta is at 92%.' }), 'Beta is at 92%.');
  assert.equal(keptLine({ kind: 'risk', sentence: 'The review may slip.' }), '> [!warning] The review may slip.');
  assert.equal(keptLine({ kind: 'idea', sentence: 'A free first month.' }), '> [!idea] A free first month.');
  assert.equal(keptLine({ kind: 'next', sentence: 'The offer range.' }), '- The offer range. #next');
  assert.equal(parseReply('[risk] The review may slip.').kind, 'risk');
  assert.equal(server.parseReply('[next] Later. [idea] x').sentence, 'Later. x');
  const text = '## Launch (5m)\n20th? mkt ok\n-> go w/ 20th\npress kit??\n';
  const e = keepEdit(text, 2, { kind: 'decision', sentence: 'We launch on October 20.' });
  const after = text.slice(0, e.from) + e.insert + text.slice(e.to);
  assert.equal(after, '## Launch (5m)\n20th? mkt ok\n\n> [!decision] We launch on October 20.\n\npress kit??\n');
  const t = keepEdit('a\n  ann: survey thurs\n', 1, { kind: 'todo', sentence: 'Send the survey', owner: 'ann' });
  assert.equal(t.insert, '  - [ ] Send the survey @ann');
});

test('keepEdit: the cursor after the kept line, not in its middle', () => {
  const D = { kind: 'decision', sentence: 'We launch on October 20.' };
  const apply = (text, e) => text.slice(0, e.from) + e.insert + text.slice(e.to);
  const mark = (text, e) => { const a = apply(text, e); return a.slice(0, e.caret) + '|' + a.slice(e.caret); };
  // On the line itself, at its end: the end of the kept sentence.
  const one = '## Launch\nmkt ok\n-> go w/ 20th';
  assert.equal(mark(one, keepEdit(one, 2, D, one.length)), '## Launch\nmkt ok\n\n> [!decision] We launch on October 20.|');
  // On the empty line under it: a blank line between, then the cursor.
  const two = '## Launch\n-> go w/ 20th\n\n## Next';
  assert.equal(mark(two, keepEdit(two, 1, D, two.indexOf('\n\n') + 1)), '## Launch\n\n> [!decision] We launch on October 20.\n\n|\n## Next');
  // A to-do: the cursor at its end, the date included.
  const three = 'ann: survey thurs';
  const t = keepEdit(three, 0, { kind: 'todo', sentence: 'Send the survey', owner: 'ann', due: '2026-10-15' }, 5);
  assert.equal(mark(three, t), '- [ ] Send the survey @ann \u{1F4C5} 2026-10-15|');
  // Above the line: where it was.
  assert.equal(keepEdit(one, 2, D, 3).caret, 3);
});

test('wanted and quantile', () => {
  assert.equal(wanted('## Status (5m)'), false);
  assert.equal(wanted('Previous meeting: [[Weekly 2026-10-05]]'), false);
  assert.equal(wanted('   '), false);
  assert.equal(wanted('ok go'), true);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5.5);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9.1);
  assert.equal(quantile([], 0.5), null);
});

// A stand-in for the claude CLI (stream-json in and out): it answers each
// line with "[note] <the line>", writes what it was sent to a log, and ends
// itself on a line "DIE".
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let n = 0, buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    const text = j.message.content;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ pid: process.pid, text }) + '\\n');
    const line = /Line: (.*)$/.exec(text)?.[1] ?? 'REQUEST';
    if (line === 'DIE') process.exit(3);
    n++;
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text: '[note] ' + line } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: n / 1000, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the resident session: one meeting, another, the swap, up again after it ends, stopped', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-live-test-'));
  const bin = path.join(dir, 'fake-claude');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  const log = path.join(dir, 'log');
  const m = server.liveMargin({ bin, env: { ...process.env, FAKE_LOG: log }, warmMs: 30, retryMs: 50 });
  const ask = (key, line) => new Promise((done) => m.line({ key, title: key, agenda: [], line, today: 'T' }, () => {}, done));
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    m.warm();
    const first = m.session;
    const cwds = [first.cwd];
    await sleep(60);
    assert.equal(m.state().ready, true);
    assert.equal((await ask('A', 'one')).ok, true);
    assert.equal((await new Promise((done) => m.line({ key: 'A', title: 'A', agenda: [], line: 'two', under: 'to do:', today: 'T' }, () => {}, done))).ok, true);
    let s = sent();
    assert.equal(s[0].text, "Meeting: A\nToday: T\n\nItem: (none)\nLine: one");
    assert.equal(s[1].text, 'Item: (none)\nUnder: to do:\nLine: two');
    // Another meeting: told so at once, then a fresh session told its minutes.
    assert.equal((await ask('B', 'three')).ok, true);
    s = sent();
    assert.match(s[2].text, /^Another meeting now/);
    assert.equal(s[2].pid, s[0].pid);
    await sleep(60);
    assert.equal((await ask('B', 'four')).ok, true);
    s = sent();
    assert.notEqual(s[3].pid, s[0].pid);
    assert.match(s[3].text, /^Meeting: B[\s\S]*Minutes so far:\n- three\n\nItem: \(none\)\nLine: four$/);
    assert.notEqual(m.session, first);
    assert.equal(first.dead, true);
    // It ends by itself: up again, and on.
    const was = m.session;
    cwds.push(was.cwd);
    assert.equal((await ask('B', 'DIE')).ok, false);
    await sleep(200);
    assert.notEqual(m.session, was);
    assert.equal(m.session.dead, false);
    assert.equal((await ask('B', 'five')).ok, true);
    cwds.push(m.session.cwd);
    m.stop();
    assert.equal(m.session, null);
    await sleep(100);
    // Their scratch folders are gone.
    assert.deepEqual(cwds.filter((d) => fs.existsSync(d)), []);
  } finally {
    m.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the resident session: the last meeting in its header; requests answered, not minutes', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-live-test-'));
  const bin = path.join(dir, 'fake-claude');
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  const log = path.join(dir, 'log');
  const m = server.liveMargin({ bin, env: { ...process.env, FAKE_LOG: log }, warmMs: 30, retryMs: 50 });
  const ask = (req) => new Promise((done) => m.line({ title: req.key, agenda: [], today: 'T', ...req }, () => {}, done));
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    m.warm();
    await sleep(60);
    const memory = 'Last meeting (W):\nDecided: launch Oct 20';
    assert.equal((await ask({ key: 'C', line: 'one', memory })).ok, true);
    assert.equal((await ask({ key: 'C', line: '?? when', task: 'answer', note: '# C\none', memory })).ok, true);
    assert.equal((await ask({ key: 'C', line: 'two', task: 'nonsense', memory })).ok, true);
    let s = sent();
    assert.equal(s[0].text, 'Meeting: C\nToday: T\n\nLast meeting (W):\nDecided: launch Oct 20\n\nItem: (none)\nLine: one');
    assert.match(s[1].text, /^Request: answer [\s\S]*\nQuestion: when\n\nThe note:\n# C\none$/);
    assert.equal(s[2].text, 'Item: (none)\nLine: two');
    // Another meeting, and back: C's minutes are its lines, not the request.
    await ask({ key: 'D', line: 'x' });
    await sleep(60);
    await ask({ key: 'D', line: 'y' });
    await ask({ key: 'C', line: 'three', memory });
    s = sent();
    assert.match(s.at(-1).text, /Minutes so far:\n- one\n- two\n\nItem: \(none\)\nLine: three$/);
  } finally {
    m.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
