// node --test (npm test): forks (public/forks.js) — a paragraph and the
// agent's other ways of writing it; the one taken becomes a change of the
// proposal — and the film (public/film.js): a note through a run's rounds.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { forkTask, paragraphAt, swapIn } from '../public/forks.js';
import { frameLabel, frameCaption } from '../public/film.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the paragraph at the cursor: its lines between blank lines, exactly', () => {
  const t = '# Title\n\nOne line.\nTwo line.\n\n```\ncode\n```\nAfter.\n';
  assert.equal(paragraphAt(t, 0), '# Title');
  assert.equal(paragraphAt(t, t.indexOf('Two')), 'One line.\nTwo line.');
  assert.equal(paragraphAt(t, t.indexOf('line.') + 5), 'One line.\nTwo line.'); // at the end of a line
  assert.equal(paragraphAt(t, t.indexOf('\n\n') + 1), ''); // a blank line
  assert.equal(paragraphAt(t, t.indexOf('After')), 'After.');
  assert.equal(paragraphAt(t, t.indexOf('```')), '');
});

test('a fork is asked with the paragraph quoted, and swapped in its place', () => {
  const task = forkTask('A.\nB.');
  assert.match(task, /\.agent-notes\/forks\.json/);
  assert.match(task, /<<<\nA\.\nB\.\n>>>$/);
  assert.doesNotMatch(task, /red pen|comments\.json|lens\.json/);
  assert.deepEqual(swapIn('# T\n\nA.\nB.\n\nC.\n', 'A.\nB.', 'X.\nY.\nZ.'), { text: '# T\n\nX.\nY.\nZ.\n\nC.\n', from: 2, to: 4 });
  assert.deepEqual(swapIn('abc', 'zz', 'y'), { text: 'abc', from: -1, to: -1 });
});

test('a film frame says what it is', () => {
  assert.equal(frameLabel({ kind: 'original' }), 'As it was');
  assert.equal(frameLabel({ kind: 'round', round: 2 }), 'Round 2');
  assert.equal(frameLabel({ kind: 'applied', undone: true }), 'Applied, undone');
  assert.deepEqual(frameCaption({ kind: 'original', task: 'Tidy' }), ['You asked: Tidy']);
  assert.deepEqual(frameCaption({ kind: 'round', round: 1, hunks: [{}] }), ['The agent’s proposal']);
  assert.deepEqual(frameCaption({ kind: 'round', round: 2, task: 'Shorter', hunks: [] }), ['You followed up: Shorter', 'No change to this note in this round.']);
  assert.deepEqual(frameCaption({ kind: 'applied', of: [1, 1] }), ['You applied 1 of 1 change.']);
});

test('forks on the server: kept with the run, the note untouched; one taken is a change, taken back is none; the film shows the rounds', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-forks-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const note = '# Plan\n\nWe ship on Friday. The team is ready.\n\nThe end.\n';
  fs.writeFileSync(path.join(ws, 'a.md'), note);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', 'demo'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const api = async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}${p}`, { method, headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status });
    return data;
  };
  const finish = async (run) => {
    for (let i = 0; i < 100 && run.status === 'running'; i++) { await sleep(100); run = await api('GET', `/api/runs/${run.id}`); }
    return run;
  };

  let run = await finish(await api('POST', '/api/runs', { task: forkTask('We ship on Friday. The team is ready.'), scope: 'file', focus: 'a.md' }));
  assert.equal(run.status, 'review');
  assert.deepEqual(run.changes, []);
  assert.equal(run.forks.length, 1);
  assert.equal(run.forks[0].quote, 'We ship on Friday. The team is ready.');
  assert.deepEqual(run.forks[0].options.map((o) => o.text), ['We ship on Friday.', '- We ship on Friday.\n- The team is ready.', 'The team is ready. We ship on Friday.']);
  assert.equal(run.forks[0].pick, null);
  assert.equal(run.lensBases['a.md'], note);
  assert.match(fs.readFileSync(path.join(ws, '.agent-notes', 'runs', run.id, 'prompt-1.txt'), 'utf8'), /"options"/);

  // Taken: the option is the change; another taken instead; back as it was.
  await api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: 1 });
  run = await api('GET', `/api/runs/${run.id}`);
  assert.equal(run.forks[0].pick, 1);
  assert.deepEqual(run.changes[0].hunks.flatMap((h) => h.added), ['- We ship on Friday.', '- The team is ready.']);
  await api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: 2 });
  run = await api('GET', `/api/runs/${run.id}`);
  assert.deepEqual(run.changes[0].hunks.flatMap((h) => h.added), ['The team is ready. We ship on Friday.']);
  await assert.rejects(api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: 7 }), { status: 400 });
  await assert.rejects(api('POST', `/api/runs/${run.id}/fork`, { n: 3, pick: 0 }), { status: 404 });
  await api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: null });
  run = await api('GET', `/api/runs/${run.id}`);
  assert.deepEqual(run.changes, []);
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), note);

  // Taken, then a follow-up round, then applied: the film has each.
  await api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: 0 });
  run = await finish(await api('POST', `/api/runs/${run.id}/followup`, { task: 'Red pen: anything else? Write to .agent-notes/comments.json' }));
  assert.equal(run.round, 2);
  assert.equal(run.forks[0].pick, 0); // the forks go on with the proposal
  await api('POST', `/api/runs/${run.id}/apply`, { decisions: { 'a.md': { hunks: [0] } } });
  const film = await api('GET', `/api/runs/${run.id}/film?path=a.md`);
  assert.deepEqual(film.frames.map((f) => f.kind), ['original', 'round', 'round', 'applied']);
  assert.equal(film.frames[0].text, note);
  assert.equal(film.frames[1].text, '# Plan\n\nWe ship on Friday.\n\nThe end.\n');
  assert.equal(film.frames[1].hunks.length, 1);
  assert.match(film.frames[2].task, /^Red pen: anything else/);
  assert.equal(film.frames[3].text, fs.readFileSync(path.join(ws, 'a.md'), 'utf8'));
  assert.deepEqual(film.frames[3].of, [1, 1]);
  await assert.rejects(api('POST', `/api/runs/${run.id}/fork`, { n: 0, pick: 1 }), { status: 409 }); // settled
  await assert.rejects(api('GET', `/api/runs/${run.id}/film?path=nope.md`), { status: 404 });
});
