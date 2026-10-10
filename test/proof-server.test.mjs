// node --test (npm test): your suggestions and comments. Suggesting keeps the
// note as it is: the proposal is a run of yours (base / work), settled in the
// review and applied as any change; comments sit beside the note, never in
// it, and an agent asked about the note reads them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('suggesting: the note untouched until applied; comments beside it, read by the agent', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-proof-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const note = '# Meeting\n\n- ship on Monday\n- docs by Friday\n';
  fs.writeFileSync(path.join(ws, 'm.md'), note);
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
    if (!r.ok) throw Object.assign(new Error(data.error), { status: r.status, data });
    return data;
  };

  // A review's proposal: a red pen review of its own (not your suggestions), why beside the line it brings; the note untouched.
  const dp = await api('POST', '/api/desk/propose', { path: 'm.md', text: `${note}- dinner at the pier #decision\n`, task: 'From the review "Trip": m.md', comments: [{ quote: '- dinner at the pier #decision', comment: 'From the review "Trip"' }, { quote: 'not in it', comment: 'x' }] });
  const dr = await api('GET', `/api/runs/${dp.id}`);
  assert.deepEqual([dr.kind, dr.agent, dr.from, dr.status, dr.task], [undefined, 'Review', 'review', 'review', 'From the review "Trip": m.md']);
  assert.deepEqual(dr.comments.map((c) => [c.quote, c.suggest, c.comment]), [['- dinner at the pier #decision', '- dinner at the pier #decision', 'From the review "Trip"']]);
  assert.equal(dr.changes.length, 1);
  assert.equal(fs.readFileSync(path.join(ws, 'm.md'), 'utf8'), note);
  assert.deepEqual(await api('POST', '/api/desk/propose', { path: 'm.md', text: note }), { same: true });
  await api('POST', `/api/runs/${dp.id}/discard`, {}).catch(() => {});

  // One open set of suggestions per note.
  const p = await api('POST', '/api/proofs', { path: 'm.md' });
  assert.equal(p.created, true);
  assert.equal(p.base, note);
  assert.equal((await api('POST', '/api/proofs', { path: 'm.md' })).id, p.id);
  await api('PUT', `/api/proofs/${p.id}`, { text: '# Meeting\n\n- ship on Tuesday\n- docs by Friday\n' });
  assert.equal(fs.readFileSync(path.join(ws, 'm.md'), 'utf8'), note);
  assert.equal((await api('GET', '/api/runs')).runs.find((r) => r.id === p.id).kind, 'proof');

  // Comments: beside the note, cleaned, shown with the suggestions.
  const saved = await api('PUT', '/api/comments', { path: 'm.md', comments: [
    { id: 'a1', quote: 'docs by Friday', line: 3, comment: 'Who writes them?', speaker: '민수', time: '2026-10-03 14:05', replies: [{ text: 'Jin', time: '2026-10-03 14:06' }] },
    { id: 'a2', quote: 'Meeting', comment: 'Done', resolved: '2026-10-03 14:10' },
    { quote: 'x', comment: '   ' },
    // On drawings: a box of a flow, a point of a sketch; a pin that says nothing is dropped.
    { id: 'a3', quote: 'Meeting', comment: 'Split it', pin: { on: 'flow', box: 'Pay', x: 3 } },
    { id: 'a4', quote: 'Meeting', comment: 'Here', pin: { on: 'sketch', x: 120.6, y: '80' } },
    { id: 'a5', quote: 'Meeting', comment: 'Odd', pin: { on: 'wall', x: 1, y: 2 } },
  ] });
  assert.deepEqual(saved.comments.map((c) => c.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
  assert.deepEqual(saved.comments.map((c) => c.pin), [undefined, undefined, { on: 'flow', box: 'Pay' }, { on: 'sketch', x: 121, y: 80 }, undefined]);
  assert.equal(fs.readFileSync(path.join(ws, 'm.md'), 'utf8'), note);
  assert.equal((await api('GET', '/api/comments?path=m.md')).comments[0].speaker, '민수');
  let run = await api('GET', `/api/runs/${p.id}`);
  assert.deepEqual(run.comments.map((c) => [c.quote, c.comment, c.speaker]).slice(0, 1), [['docs by Friday', 'Who writes them?', '민수']]);
  assert.equal(run.changes[0].hunks.length, 1);

  // An agent asked about the note reads the open ones.
  const r = await api('POST', '/api/runs', { task: 'Tidy', scope: 'file', focus: 'm.md' });
  for (let i = 0; i < 100 && (await api('GET', `/api/runs/${r.id}`)).status === 'running'; i++) await sleep(100);
  const prompt = fs.readFileSync(path.join(ws, '.agent-notes', 'runs', r.id, 'prompt-1.txt'), 'utf8');
  assert.match(prompt, /margin comments on m\.md[\s\S]*"docs by Friday": Who writes them\? \(said by 민수 at 2026-10-03 14:05\)\n {2}- reply: Jin/);
  assert.doesNotMatch(prompt, /Done/);
  assert.match(prompt, /- on "Meeting" \(on the box "Pay" of the flow chart\): Split it\n- on "Meeting" \(on the sketch at x 121, y 80 of its pixels\): Here\n- on "Meeting": Odd/);
  await api('POST', `/api/runs/${r.id}/discard`);

  // The note changed elsewhere: the suggestions go on over it.
  fs.writeFileSync(path.join(ws, 'm.md'), `${note}- more\n`);
  const again = await api('POST', '/api/proofs', { path: 'm.md' });
  assert.equal(again.id, p.id);
  assert.equal(again.work, '# Meeting\n\n- ship on Tuesday\n- docs by Friday\n- more\n');

  // Settled as any proposal.
  await api('POST', `/api/runs/${p.id}/apply`, { decisions: { 'm.md': { hunks: [0] } } });
  assert.equal(fs.readFileSync(path.join(ws, 'm.md'), 'utf8'), '# Meeting\n\n- ship on Tuesday\n- docs by Friday\n- more\n');
  await assert.rejects(api('PUT', `/api/proofs/${p.id}`, { text: 'x' }), { status: 409 });
  assert.notEqual((await api('POST', '/api/proofs', { path: 'm.md' })).id, p.id);

  // Comments go with a renamed note.
  await api('POST', '/api/rename', { from: 'm.md', to: 'minutes.md' });
  assert.equal((await api('GET', '/api/comments?path=minutes.md')).comments.length, 5);
  await assert.rejects(api('GET', '/api/comments?path=../x.md'), { status: 400 });
});
