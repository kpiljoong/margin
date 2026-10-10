// The meeting room: what is typed kept in the note as typed (a mark only as
// they set it), the wrap-up from the draft they accepted, the margin's
// replies checked, and the server with a stand-in for the claude CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { WORDS, closeItems, sigOf, addsDate, roomEntries, typedLine, addLines, markEntry, editEntry, dropEntry, wrapSection, withWrap, whoDue, splitCond, todoLines, withTodos, wovenLinks, laneOf, roomLang } from '../public/room.js';
import { meetingItems } from '../public/meeting.js';

const require = createRequire(import.meta.url);
const room = require('../lib/room.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const START = '---\ntype: meeting\ndate: 2026-10-10\n---\n# Weekly\n\nPrevious meeting: [[2026-10-03 Weekly]]\n';

test('typed: kept as typed, marked only as they said; an item of the agenda a heading; ?? never in the note', () => {
  let t = START;
  for (const x of ['ship friday', '! ship on monday', '# QA', '[] ann drafts the notes', '? a beta', 'plain words', '?? when did we say']) { const l = typedLine(x); if (l) t = addLines(t, [l]); }
  assert.equal(t, `${START}\n- ship friday\n- ship on monday #decision\n\n## QA\n\n- [ ] ann drafts the notes\n- a beta #question\n- plain words\n`);
  const { entries, sections } = roomEntries(t);
  assert.deepEqual(entries.map((e) => [e.words, e.mark, e.section]), [['ship friday', null, ''], ['ship on monday', 'decision', ''], ['ann drafts the notes', 'todo', 'QA'], ['a beta', 'question', 'QA'], ['plain words', null, 'QA']]);
  assert.deepEqual(sections, ['QA']);
  // Their kind set on a card: in the note; plain again; its words; gone.
  t = markEntry(t, entries[0], 'decision');
  assert.match(t, /^- ship friday #decision$/m);
  t = markEntry(t, roomEntries(t).entries[0], null);
  assert.match(t, /^- ship friday$/m);
  t = editEntry(t, roomEntries(t).entries[2], 'ann drafts the release notes');
  assert.match(t, /^- \[ \] ann drafts the release notes$/m);
  t = editEntry(t, roomEntries(t).entries[1], 'ship on tuesday');
  assert.match(t, /^- ship on tuesday #decision$/m);
  t = dropEntry(t, roomEntries(t).entries.at(-1));
  assert.doesNotMatch(t, /plain words/);
  // The same words twice: two entries.
  assert.deepEqual(roomEntries('# T\n\n- a b\n- a b\n').entries.map((e) => e.key), ['a b', 'a b#2']);
  assert.equal(laneOf('risk'), 'other');
  assert.equal(laneOf('decision'), 'decision');
  assert.equal(roomLang('\uCD9C\uC2DC'), 'ko');
});

test('the wrap-up: what they accepted (decided with its condition, to-dos with who and when, open, not sure), before it lines go on being added', () => {
  const draft = {
    decided: [splitCond({ text: 'Ship on Monday — after QA' })],
    who: [whoDue({ who: 'ann', text: 'Draft the notes — 2026-10-12' }), whoDue({ who: '?', text: 'Book the room' })],
    open: [{ text: 'A beta?', cond: '' }],
    unsure: [{ text: 'Who reviews the page' }],
  };
  const sec = wrapSection(draft, { at: '2026-10-10 10:00', next: 'x/2026-10-17 Weekly.md' });
  let t = withWrap(`${START}\n- ship on monday\n`, sec);
  assert.match(t, /## Wrap-up\n\n> The draft at the end \(2026-10-10 10:00\)[^\n]*\n\n### Decided\n\n- Ship on Monday — after QA #decision\n\n### To-dos\n\n- \[ \] Draft the notes @ann \u{1F4C5} 2026-10-12\n- \[ \] Book the room\n\n### Still open\n\n- A beta\? #question\n\n### Not confirmed\n\n- Who reviews the page\n\nNext meeting: \[\[2026-10-17 Weekly\]\]\n$/u);
  // Read as a meeting's: the decision, the to-dos, the question.
  assert.deepEqual(meetingItems(t).map((i) => i.kind), ['decision', 'todo', 'todo', 'question']);
  // Not its lines: what is added goes before it; done again, it is replaced.
  t = addLines(t, ['- one more']);
  assert.match(t, /- ship on monday\n- one more\n\n## Wrap-up/);
  assert.equal(roomEntries(t).entries.length, 2);
  const again = withWrap(t, wrapSection({ decided: [{ text: 'X', cond: '' }] }, { lang: 'ko', kind: 'lecture' }));
  assert.equal(again.match(/## Wrap-up/g).length, 1);
  assert.match(again, /### \uD575\uC2EC\n\n- X\n/, 'a lecture: its points, no #decision');
});

test('the close reads the whole session; a long one keeps what was decided, given or asked however early; a draft from other lines is old', () => {
  const e = (kind, words, mark = null) => ({ kind, words, key: words, mark });
  const early = [e('decision', 'ship on monday', 'decision'), e('todo', 'ann drafts the notes')];
  const long = [...early, ...Array.from({ length: 500 }, (_, i) => e('note', `a plain note number ${i} ${'x'.repeat(100)}`)), e('question', 'a beta?')];
  const k = closeItems(long);
  assert.deepEqual(k.slice(0, 2).map((x) => x.words), ['ship on monday', 'ann drafts the notes']);
  assert.equal(k.at(-1).words, 'a beta?');
  assert.ok(k.length <= 400 && k.reduce((n, x) => n + x.words.length + 24, 0) <= 60000);
  assert.equal(closeItems(early).length, 2, 'a short one whole');
  assert.notEqual(sigOf(early), sigOf([...early, e('note', 'one more')]));
  assert.notEqual(sigOf(early), sigOf([{ ...early[0], mark: null }, early[1]]), 'a mark set since: old too');
});

test('the margin\'s sentence with a day their words don\'t have: not shown', () => {
  assert.ok(addsDate('\uCD9C\uC2DC\uC77C\uC744 10\uC6D4 18\uC77C \uAE08\uC694\uC77C\uB85C \uD55C\uB2E4.', '\uCD9C\uC2DC\uB294 \uAE08\uC694\uC77C\uB85C \uD558\uC790'));
  assert.ok(addsDate('We launch on October 18.', 'launch friday'));
  assert.ok(!addsDate('\uCD9C\uC2DC\uC77C\uC744 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4.', '\uCD9C\uC2DC 10\uC6D4 20\uC77C'));
  assert.ok(!addsDate('\uC218\uC544\uAC00 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8\uB97C \uB9C8\uBB34\uB9AC\uD55C\uB2E4.', '\uC218\uC544 \uCCB4\uD06C\uB9AC\uC2A4\uD2B8 \uB9C8\uBB34\uB9AC'));
});

test('its words: the same in Korean and in English', () => {
  const keys = (o) => Object.keys(o).sort().map((k) => (o[k] && typeof o[k] === 'object' ? `${k}{${keys(o[k])}}` : k)).join(',');
  assert.equal(keys(WORDS.ko), keys(WORDS.en));
});

test('the to-do list: in its format, a project folder\'s tag, not twice', () => {
  const who = [{ text: 'Draft the notes', due: '2026-10-12' }, { text: 'Book it', due: null }];
  const lines = todoLines(who, { list: '# Todo\n\n- [ ] Book it \u{1F4C5} 2026-10-01 #project/x\n', folder: '01-projects/x/sub' });
  assert.deepEqual(lines, ['- [ ] Draft the notes \u{1F4C5} 2026-10-12 #project/x']);
  assert.equal(withTodos('# Todo\n\n- [ ] a\n\n', lines), '# Todo\n\n- [ ] a\n- [ ] Draft the notes \u{1F4C5} 2026-10-12 #project/x\n');
});

test('the margin\'s links on the lines: a cut one not again, one there not twice, numbers in range', () => {
  const r = { links: [{ a: 1, b: 2, kind: 'link' }, { a: 2, b: 1, kind: 'clash' }, { a: 1, b: 9, kind: 'link' }, { a: 3, b: 1, kind: 'changes' }, { a: 2, b: 3, kind: 'answers' }] };
  assert.deepEqual(wovenLinks(r, ['a', 'b', 'c'], { cut: [['c', 'b'].sort().join('\u0000')] }).map((l) => [l.a, l.b, l.kind]), [['a', 'b', 'link'], ['c', 'a', 'changes']]);
  assert.deepEqual(wovenLinks(r, ['a', 'b', 'c'], { have: [{ a: 'b', b: 'a' }] }).map((l) => l.kind), ['changes', 'answers']);
});

test('weave and close: what Claude says checked — numbers in range, a quote that is in its note, no line numbers in the words, three questions first and the rest kept', () => {
  const w = room.parseWeave([
    'ask: Is it Monday (S2) for sure?', 'about: S2', '---',
    'stand: Launch', 'agreed: Beta with 10 people (S6)', 'open: Friday or Monday', '---',
    'link: S1 S3', 'why: same launch', '---', 'link: S3 S1', '---', 'link: S1 S1', '---', 'link: S1 S9', '---',
    'changes: S2 S1', 'why: put off', '---',
    'clash: S4 S5', 'why: both cannot hold', '---',
    'before: S2 N1', 'was: The launch is on October 20', 'why: another day', '---',
    'before: S3 N1', 'was: Something never written there at all', '---',
  ].join('\n'), { n: 6, notes: [{ text: '- The launch is on October 20 #decision' }] });
  assert.deepEqual(w.ask, { text: 'Is it Monday for sure?', s: 2 });
  assert.deepEqual(w.stand, { item: 'Launch', agreed: 'Beta with 10 people', open: 'Friday or Monday', next: '' });
  assert.deepEqual(w.links.map((l) => [l.a, l.b, l.kind]), [[1, 3, 'link'], [2, 1, 'changes'], [4, 5, 'clash']]);
  assert.deepEqual(w.before, [{ s: 2, n: 1, was: 'The launch is on October 20', why: 'another day' }]);
  const c = room.parseClose([
    'decided: Launch on Monday — because QA is next week [S2]', 'decided: Beta (S6) [S6, S9]',
    'who: ann — Draft the notes — Wednesday [S4]', 'who: ? — Book the room [S5]', 'who: nobody',
    'open: A beta? — after the survey [S5]',
    'check: Monday the 19th? [S2]', 'check: b [S1]', 'check: c [S1]', 'check: d [S1]',
    'unsure: Who reviews the page [S3]', 'chatter',
  ].join('\n'), { n: 6 });
  assert.deepEqual(c.decided, [{ text: 'Launch on Monday — because QA is next week', from: [2] }, { text: 'Beta', from: [6] }]);
  assert.deepEqual(c.who, [{ who: 'ann', text: 'Draft the notes — Wednesday', from: [4] }, { who: '?', text: 'Book the room', from: [5] }]);
  assert.equal(c.check.length, 3, 'three questions at most');
  assert.deepEqual(c.unsure, [{ text: 'Who reviews the page', from: [3] }]);
  // A line's number in what it wrote: its words instead (not the lines' own S3).
  assert.deepEqual(room.unnumbered({ ask: { text: 'Did S2 change S1?', s: 2 }, x: 'Clean the S3 bucket', y: 'N1 says otherwise' }, [{ text: 'ship friday' }, { text: 'ship monday' }, { text: 'the S3 bucket' }], [{ path: 'a/plan.md' }]),
    { ask: { text: 'Did “ship monday” change “ship friday”?', s: 2 }, x: 'Clean the S3 bucket', y: '[[plan]] says otherwise' });
  assert.match(room.weaveText({ title: 'W', items: [{ kind: 'decision?', text: 'ship', section: 'Launch' }], notes: [{ path: 'a.md', text: 'A' }] }), /^Session: W \(a meeting\)\n\nLines:\nS1 decision\? \(Launch\): ship\n\nNotes before it:\nN1 a\.md:\nA$/);
  assert.match(room.WEAVE, /not an error|a change, maybe/);
  assert.match(room.closeText({ kind: 'note-taking', items: [] }), /^Session: untitled \(note-taking: one person's notes\)/);
  assert.match(room.CLOSE, /note-taking/);
  assert.match(room.CLOSE, /not in the record/);
  assert.match(room.CLOSE, /never for a missing date alone/);
});

// A stand-in for the claude CLI: a weave for "Notes before it:", a draft for a session without, changes for "D1.".
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    const m = j.message.content;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(m) + '\\n');
    const text = m.includes('\\nD1. ')
      ? 'note: N1\\nline: 3\\nwas: The launch is on\\nnow: - The launch is on Monday the 19th\\nfor: D1\\n---\\nnote: N1\\nafter: 3\\nadd: - Launch on Monday #decision\\nfor: D1'
      : m.includes('Notes before it:')
      ? 'ask: Monday the 19th for sure?\\nabout: S2\\n---\\nstand: Launch\\nagreed: Monday\\n---\\nchanges: S2 S1\\nwhy: put off\\n---\\nbefore: S2 N1\\nwas: The launch is on October 20\\nwhy: another day'
      : 'decided: Launch on Monday [S2]\\nwho: ann — Draft the notes [S3]\\ncheck: Monday the 19th? [S2]';
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: a room\'s note begun after the one before, what it knows (never a private note), weave, close, and changes only to notes that are not a meeting\'s', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-room-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-room-bin-'));
  t.after(() => { for (const d of [ws, bin]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  fs.mkdirSync(path.join(ws, 'launch'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'launch/2026-10-03 Weekly.md'), '---\ntype: meeting\n---\n# Weekly\n\n- The launch is on October 20 #decision\n');
  fs.writeFileSync(path.join(ws, 'launch/plan.md'), '# Plan\n\n- The launch is on October 20\n- QA a week before\n');
  fs.writeFileSync(path.join(ws, 'launch/secret.md'), '---\nprivate: true\n---\nThe secret launch plan, long enough.\n');
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
  const s = await api('POST', '/api/room/start', { kind: 'meeting', folder: 'launch', title: 'Launch / check' });
  assert.equal(s.status, 200, s.error);
  assert.match(s.path, /^launch\/\d{4}-\d{2}-\d{2} Launch check\.md$/);
  assert.equal(s.previous, 'launch/2026-10-03 Weekly.md');
  const note = fs.readFileSync(path.join(ws, s.path), 'utf8');
  assert.match(note, /^---\ntype: meeting\ndate: \d{4}-\d{2}-\d{2}\n---\n# Launch check\n\nPrevious meeting: \[\[2026-10-03 Weekly\]\]\n/);
  const again = await api('POST', '/api/room/start', { kind: 'meeting', folder: 'launch', title: 'Launch check' });
  assert.match(again.path, / \(2\)\.md$/, 'one there already: (2)');
  assert.equal((await api('POST', '/api/room/start', { folder: 'nowhere', title: 'x' })).status, 400);
  const nt = await api('POST', '/api/room/start', { kind: 'note-taking', folder: 'launch', title: 'Reading' });
  assert.match(fs.readFileSync(path.join(ws, nt.path), 'utf8'), /^---\ntype: note-taking\n/);
  assert.equal(nt.previous, null, 'the session before is one of its kind');
  const c = await api('POST', '/api/room/context', { path: s.path });
  assert.equal(c.notes[0].path, 'launch/2026-10-03 Weekly.md', 'the meeting before first');
  assert.ok(c.notes[0].previous);
  assert.ok(!c.notes.some((n) => /secret/.test(n.path)), 'never a private note');
  assert.equal(c.layer.kind, 'meeting');
  assert.equal((await api('PUT', '/api/room/layer', { path: s.path, layer: { kind: 'meeting', links: [{ a: 'x', b: 'y' }] } })).status, 200);
  assert.deepEqual((await api('POST', '/api/room/context', { path: s.path })).layer.links, [{ a: 'x', b: 'y' }]);
  assert.equal((await api('PUT', '/api/room/layer', { path: s.path, layer: [] })).status, 400);
  const items = [{ kind: 'decision?', text: 'ship friday' }, { kind: 'decision?', text: 'ship monday after QA' }, { kind: 'todo', text: 'ann drafts the notes' }];
  const w = await api('POST', '/api/room/weave', { path: s.path, items });
  assert.equal(w.status, 200, w.error);
  assert.deepEqual(w.ask, { text: 'Monday the 19th for sure?', s: 2 });
  assert.deepEqual(w.links, [{ a: 2, b: 1, kind: 'changes', why: 'put off' }]);
  assert.deepEqual(w.before, [{ s: 2, was: 'The launch is on October 20', why: 'another day', note: 'launch/2026-10-03 Weekly.md' }]);
  assert.match(sent().at(-1), /^Session: Launch check \(a meeting\)/);
  assert.match(sent().at(-1), /S2 decision\?: ship monday after QA/);
  assert.doesNotMatch(sent().at(-1), /secret/);
  const cl = await api('POST', '/api/room/close', { path: s.path, items });
  assert.equal(cl.status, 200, cl.error);
  assert.deepEqual(cl.decided, [{ text: 'Launch on Monday', from: [2] }]);
  assert.deepEqual(cl.check, [{ text: 'Monday the 19th?', from: [2] }]);
  const ch = await api('POST', '/api/room/changes', { path: s.path, decided: ['Launch on Monday'] });
  assert.equal(ch.status, 200, ch.error);
  assert.ok(ch.changes.length && ch.changes.every((x) => x.file === 'launch/plan.md'), 'the plan, not the meeting before (what was said then stays)');
  assert.doesNotMatch(sent().at(-1), /2026-10-03 Weekly/);
  fs.writeFileSync(path.join(ws, 'launch/mine.md'), '---\nprivate: true\n---\n# Mine\n');
  assert.equal((await api('POST', '/api/room/weave', { path: 'launch/mine.md', items })).status, 403);
});
