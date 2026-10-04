// node --test (npm test): the lens (public/lens.js) — the follow-up that
// asks for a fix, the arcs and the cards' places — and a lens run on the
// server: the findings kept with the run, on quotes found in the note, the
// note untouched, a fix coming back as a red pen proposal.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LENS_KINDS, LENS_TASKS, fixRequest, arcPath, stack } from '../public/lens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('each lens asks for lens.json and to leave the note as it is', () => {
  for (const t of Object.values(LENS_TASKS)) {
    assert.match(t, /\.agent-notes\/lens\.json/);
    assert.match(t, /Do not change the note/);
    assert.doesNotMatch(t, /red pen|comments\.json/);
  }
  assert.deepEqual(Object.keys(LENS_KINDS), ['gap', 'conflict', 'open', 'decided', 'link']);
});

test('a fix is asked as a red pen proposal, with each finding and its places', () => {
  assert.equal(fixRequest([]), '');
  const one = fixRequest([{ file: 'a.md', kind: 'conflict', note: 'Friday here,\nMonday there.', quotes: ['We ship on Friday.', 'The launch is on Monday.'] }]);
  assert.equal(one, 'Fix this with the red pen: write your suggestions to .agent-notes/comments.json and leave the note itself as it is.\n'
    + '- In a.md (Disagree): Friday here, Monday there.\n  At “We ship on Friday.” and “The launch is on Monday.”\n');
  const two = fixRequest([{ file: 'a.md', kind: 'gap', note: 'No source.', quotes: [`${'x'.repeat(100)}`] }, { file: 'b.md', kind: 'odd', note: 'n', quotes: ['q'] }]);
  assert.match(two, /^Fix these with the red pen/);
  assert.match(two, /“x{79}…”/);
  assert.match(two, /In b\.md \(odd\): n/);
});

test('arcs bow out to the left; cards keep their height or go below the one before', () => {
  assert.equal(arcPath(38, 10, 90, 20), 'M38,10 C18,10 18,90 38,90');
  assert.deepEqual(stack([0, 5, 100, 104], [40, 20, 10, 10]), [0, 48, 100, 118]);
  assert.deepEqual(stack([], []), []);
});

test('a lens run: findings kept with the run on quotes of the note, nothing changed; a fix is a red pen proposal', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-lens-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const note = '# Launch\n\nWe decided to ship on Friday.\n\nEveryone obviously wants a very dark theme.\n\nWho writes the release notes?\n\nThe launch is on Monday.\n';
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

  let run = await finish(await api('POST', '/api/runs', { task: LENS_TASKS.decisions, scope: 'file', focus: 'a.md' }));
  assert.equal(run.status, 'review');
  assert.deepEqual(run.changes, []);
  assert.deepEqual(run.lens.map((f) => [f.kind, f.quotes]), [
    ['decided', ['We decided to ship on Friday.']],
    ['gap', ['Everyone obviously wants a very dark theme.']],
    ['open', ['Who writes the release notes?']],
    ['conflict', ['We decided to ship on Friday.', 'The launch is on Monday.']],
  ]);
  assert.ok(run.lens.every((f) => f.file === 'a.md' && f.note));
  assert.deepEqual(run.lensBases, { 'a.md': note });
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), note);
  const prompt = fs.readFileSync(path.join(ws, '.agent-notes', 'runs', run.id, 'prompt-1.txt'), 'utf8');
  assert.match(prompt, /"quotes"/);
  assert.doesNotMatch(prompt, /"suggest"/); // no red pen yet

  // The fix: a follow-up whose answer is red pen marks; the lens goes on with it.
  const fix = fixRequest([run.lens[1]]);
  run = await finish(await api('POST', `/api/runs/${run.id}/followup`, { task: fix }));
  assert.equal(run.status, 'review');
  assert.equal(run.lens.length, 4);
  assert.deepEqual(run.changes.map((c) => c.path), ['a.md']);
  assert.ok(run.comments.some((c) => c.quote === 'very dark' && c.suggest === 'dark'));
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), note);
  const prompt2 = fs.readFileSync(path.join(ws, '.agent-notes', 'runs', run.id, 'prompt-2.txt'), 'utf8');
  assert.match(prompt2, /"suggest"/);
});
