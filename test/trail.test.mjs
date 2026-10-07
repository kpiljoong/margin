// node --test (npm test): the desk's "Over time" (public/trail.js, server.js
// deskTrail) — when a meeting was, the meetings in order, and what became of
// their to-dos and questions, from the notes and their kept versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dateIn, dateOf, orderNotes, sameOf, tickedAt, trailOf, trailText, dayOf } from '../public/trail.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('a date in words, as people write them', () => {
  assert.equal(dateIn('Weekly 2026-09-03'), '2026-09-03');
  assert.equal(dateIn('sync 2026.9.3'), '2026-09-03');
  assert.equal(dateIn('20260903 standup'), '2026-09-03');
  assert.equal(dateIn('\uC8FC\uAC04 2026\uB144 9\uC6D4 3\uC77C'), '2026-09-03');
  assert.equal(dateIn('build 2026-13-45'), null);
  assert.equal(dateIn('v12345678'), null);
  assert.equal(dateIn('no date'), null);
});

test('when a meeting was: its front matter, its name, its title; else estimated', () => {
  assert.deepEqual(dateOf({ path: 'm/Weekly 2026-09-10.md', text: '---\ndate: 2026-09-09\n---\n# W\n' }), { date: '2026-09-09', how: 'front', estimated: false });
  assert.deepEqual(dateOf({ path: 'm/Weekly 2026-09-10.md', text: '# W\n' }), { date: '2026-09-10', how: 'name', estimated: false });
  assert.deepEqual(dateOf({ path: 'm/Weekly.md', text: '# Weekly 2026-09-17\n' }), { date: '2026-09-17', how: 'title', estimated: false });
  // The earliest sign of it: its oldest kept version, or its file made.
  assert.deepEqual(dateOf({ path: 'kickoff.md', text: '# Kickoff\n', created: at(2026, 9, 20), versions: [[at(2026, 9, 25), ''], [at(2026, 9, 18), '']] }), { date: '2026-09-18', how: 'kept', estimated: true });
  assert.deepEqual(dateOf({ path: 'kickoff.md', text: '# Kickoff\n', created: at(2026, 9, 20), versions: [] }), { date: '2026-09-20', how: 'file', estimated: true });
  assert.deepEqual(dateOf({ path: 'kickoff.md', text: '' }), { date: null, how: null, estimated: true });
});

test('in order: by date, and a meeting after the one it names before it', () => {
  const o = orderNotes([
    { path: 'c.md', text: '# 2026-09-17', prev: 'b.md' },
    { path: 'a.md', text: '# 2026-09-03' },
    // Its file was made later (copied), but it names a.md as the meeting before.
    { path: 'b.md', text: '# B', prev: 'a.md', created: at(2026, 9, 30) },
  ]);
  assert.deepEqual(o.map((n) => n.path), ['a.md', 'b.md', 'c.md']);
  assert.equal(o[1].estimated, true);
});

test('the same to-do, however it is marked', () => {
  assert.equal(sameOf('Draft the release notes @ann \u{1F4C5} 2026-10-09 #todo'), 'draft the release notes');
  assert.equal(sameOf('Draft the release notes.'), 'draft the release notes');
});

test('when a to-do was ticked: between the last kept version with it open and the next', () => {
  const note = { modified: at(2026, 9, 30), versions: [
    [at(2026, 9, 21), '- [ ] Fix login @bo'],
    [at(2026, 9, 22), '- [ ] Fix login @bo'],
    [at(2026, 9, 24), '- [x] Fix login @bo'],
  ] };
  assert.deepEqual(tickedAt(note, 'fix login'), { by: at(2026, 9, 24), after: at(2026, 9, 22) });
  // Open in every version kept: by the file's last change.
  assert.deepEqual(tickedAt({ ...note, versions: note.versions.slice(0, 2) }, 'fix login'), { by: at(2026, 9, 30), after: at(2026, 9, 22) });
  // Never seen open: not known.
  assert.equal(tickedAt({ ...note, versions: [] }, 'fix login'), null);
});

test('the trail: to-dos that came back, ticked, questions decided', () => {
  const notes = [
    { path: 'W 2026-09-03.md', text: '# W\n- [ ] Draft the release notes @ann\n- [ ] Fix login @bo\n- Do we need a beta? #question\n- We ship on Friday #decision\n' },
    { path: 'W 2026-09-10.md', prev: 'W 2026-09-03.md', modified: at(2026, 9, 12), versions: [[at(2026, 9, 10, 18), '- [ ] Fix login @bo']],
      text: '# W\n- [ ] Draft the release notes @ann\n- [x] Fix login @bo\n- Do we need a beta? #question\n' },
    { path: 'W 2026-09-17.md', prev: 'W 2026-09-10.md', text: '# W\n- [ ] Draft the release notes.\n- [x] Ask legal\n- Do we need a beta? #decision\n' },
  ];
  const t = trailOf(notes);
  assert.deepEqual(t.meetings.map((m) => m.date), ['2026-09-03', '2026-09-10', '2026-09-17']);
  const draft = t.todos.find((x) => /Draft/.test(x.text));
  assert.deepEqual([draft.in, draft.done, draft.owner], [[0, 1, 2], false, 'ann']);
  const login = t.todos.find((x) => /login/.test(x.text));
  assert.deepEqual([login.in, login.done, login.ticked], [[0, 1], true, { by: at(2026, 9, 12), after: at(2026, 9, 10, 18), how: 'kept' }]);
  assert.deepEqual(t.questions, [{ text: 'Do we need a beta?', in: [0, 1], decided: 2 }]);
  assert.deepEqual(t.decisions.map((d) => [d.in, d.text]), [[0, 'We ship on Friday'], [2, 'Do we need a beta?']]);
  const md = trailText(t);
  assert.match(md, /^\*\*3 meetings\*\*, 09-03 → 09-17\n/);
  assert.match(md, /\*\*Open to-dos\*\* \(1\)\n- Draft the release notes\. @ann · since 09-03 · \*\*in 3 meetings\*\*/);
  assert.match(md, new RegExp(`- Fix login @bo · 09-03 → ticked by ${dayOf(at(2026, 9, 12)).slice(5)} · in 2 meetings`));
  assert.doesNotMatch(md, /Ask legal/); // ticked when it was written: nothing to follow
  assert.match(md, /- Do we need a beta\? · 09-03, 09-10 → decided 09-17/);
  assert.match(md, /\*\*Decided\*\* \(2\)\n- 09-03 · We ship on Friday/);
  // A to-do ticked in a later meeting, not in a kept version: done by that meeting.
  const later = trailOf([notes[0], { ...notes[1], versions: [], text: '- [x] Draft the release notes @ann' }]);
  assert.deepEqual(later.todos.find((x) => /Draft/.test(x.text)).ticked, { by: null, after: null, how: 'meeting', in: 1 });
  assert.match(trailText(trailOf([{ path: 'x.md', text: '# x', created: at(2026, 9, 1) }])), /^\*\*1 meeting\*\*, ≈09-01\n\n- ≈ \*x\*: no date in it; 09-01 from when its file was made\n\nNo to-dos/);
});

test('the server: the chain both ways, the kept versions’ to-dos', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-trail-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.mkdirSync(path.join(ws, 'm'));
  fs.writeFileSync(path.join(ws, 'm/W 2026-09-03.md'), '# W\n- [ ] Fix login\n');
  fs.writeFileSync(path.join(ws, 'm/W 2026-09-10.md'), '# W\n\nPrevious meeting: [[W 2026-09-03]]\n\n- [x] Fix login\n');
  fs.writeFileSync(path.join(ws, 'W 2026-09-17.md'), '# W\n**Previous meeting:** [[m/W 2026-09-10]]\n');
  fs.writeFileSync(path.join(ws, 'other.md'), '# other\nPrevious meeting: [[nowhere]]\n');
  const kept = path.join(ws, '.agent-notes', 'history', 'm', 'W 2026-09-10.md');
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(path.join(kept, `${at(2026, 9, 10, 18)}.save`), '# W\n\nsome words\n- [ ] Fix login\n');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const trail = async (body) => (await fetch(`http://127.0.0.1:${m[1]}/api/desk/trail`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  // From the middle one: the one before it and the one after.
  const r = await trail({ paths: ['m/W 2026-09-10.md'] });
  assert.deepEqual(r.notes.map((n) => [n.path, n.prev]), [['m/W 2026-09-10.md', 'm/W 2026-09-03.md'], ['m/W 2026-09-03.md', null], ['W 2026-09-17.md', 'm/W 2026-09-10.md']]);
  assert.deepEqual(r.notes[0].versions, [[at(2026, 9, 10, 18), '- [ ] Fix login']]);
  assert.ok(r.notes[0].created > 0 && r.notes[0].modified > 0);
  assert.equal(r.more, false);
  const tr = trailOf(r.notes);
  assert.deepEqual(tr.meetings.map((x) => x.path), ['m/W 2026-09-03.md', 'm/W 2026-09-10.md', 'W 2026-09-17.md']);
  assert.equal(tr.todos[0].ticked.how, 'kept');
  // Not a note in the workspace: nothing.
  assert.deepEqual((await trail({ paths: ['../x.md', 'none.md'] })).notes, []);
  assert.match((await trail({})).error, /paths/);
});
