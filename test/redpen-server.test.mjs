// node --test (npm test): margin comments. The agent writes them beside the
// notes (.agent-notes/comments.json in its copy); they are kept with the run,
// never in a note, and a suggestion becomes a change to review like any other.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a red pen run: suggestions are changes to review, remarks are kept with the run, the note is untouched', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-pen-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const note = '# Plan\n\nThis is a very good plan for the the team.\n';
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

  let run = await finish(await api('POST', '/api/runs', { task: 'Red pen: write your marks to .agent-notes/comments.json', scope: 'file', focus: 'a.md' }));
  assert.equal(run.status, 'review');
  assert.deepEqual(run.comments.map((c) => [c.quote, c.suggest, !!c.made]), [['the the', 'the', true], ['very good', 'good', true]]);
  assert.deepEqual(run.changes.map((c) => c.path), ['a.md']); // not the comments file
  assert.equal(run.changes[0].hunks.length, 1);
  assert.deepEqual(run.changes[0].hunks[0].added, ['This is a good plan for the team.']);
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), note);
  const prompt = fs.readFileSync(path.join(ws, '.agent-notes', 'runs', run.id, 'prompt-1.txt'), 'utf8');
  assert.match(prompt, /"suggest"/);

  // Applied through the same path as any change.
  await api('POST', `/api/runs/${run.id}/apply`, { decisions: { 'a.md': { hunks: [0] } } });
  assert.equal(fs.readFileSync(path.join(ws, 'a.md'), 'utf8'), '# Plan\n\nThis is a good plan for the team.\n');

  // Comments only: remarks, no change at all.
  run = await finish(await api('POST', '/api/runs', { task: 'Red pen, comments only', scope: 'file', focus: 'a.md' }));
  assert.deepEqual(run.changes, []);
  assert.equal(run.comments.length, 1);
  assert.equal(run.comments[0].comment, 'Reads well.');
  assert.ok(!run.comments[0].suggest);
  // The note's text as it was shared, to show the remarks on.
  assert.deepEqual(run.commentBases, { 'a.md': '# Plan\n\nThis is a good plan for the team.\n' });
});
