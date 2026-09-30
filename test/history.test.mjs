// node --test (npm test): local history (server.js) — earlier versions of a
// note kept in .agent-notes/history when it is saved, changed from outside,
// restored or renamed. Runs the real server on a throwaway folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-history-test-')));
  fs.writeFileSync(path.join(ws, 'a.md'), 'one\n');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  await sleep(300); // the watcher is up
  return { ws, api, stop: () => { proc.kill(); fs.rmSync(ws, { recursive: true, force: true }); } };
}

const versions = async (api, p) => (await api('GET', `/api/history?path=${encodeURIComponent(p)}`)).versions;
const textOf = async (api, p, id) => (await api('GET', `/api/history/version?path=${encodeURIComponent(p)}&id=${id}`)).content;

test('local history keeps what saves, outside changes and restores replaced', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const { api } = s;
  let f = await api('GET', '/api/file?path=a.md');
  f = await api('PUT', '/api/file', { path: 'a.md', content: 'two\n', baseHash: f.hash });
  await api('PUT', '/api/file', { path: 'a.md', content: 'three\n', baseHash: f.hash });
  let v = await versions(api, 'a.md');
  assert.deepEqual(v.map((x) => x.reason), ['save'], 'saves close together keep one version: the text before them');
  assert.equal(await textOf(api, 'a.md', v[0].id), 'one\n');

  fs.writeFileSync(path.join(s.ws, 'a.md'), 'from another program\n');
  for (let i = 0; i < 30 && (v = await versions(api, 'a.md')).length < 2; i++) await sleep(100);
  assert.deepEqual(v.map((x) => x.reason), ['outside', 'save']);
  assert.equal(await textOf(api, 'a.md', v[0].id), 'three\n', 'what the other program replaced');

  f = await api('GET', '/api/file?path=a.md');
  await api('PUT', '/api/file', { path: 'a.md', content: 'three\n', baseHash: f.hash, reason: 'restore' });
  await sleep(400); // our own write is not "outside"
  v = await versions(api, 'a.md');
  assert.deepEqual(v.map((x) => x.reason), ['restore', 'outside', 'save']);
  assert.equal(await textOf(api, 'a.md', v[0].id), 'from another program\n');
});

test('history moves with a renamed note, and stays inside its folder', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const { api } = s;
  const f = await api('GET', '/api/file?path=a.md');
  await api('PUT', '/api/file', { path: 'a.md', content: 'two\n', baseHash: f.hash });
  await api('POST', '/api/rename', { from: 'a.md', to: 'sub/b.md' });
  await sleep(400);
  assert.equal((await versions(api, 'sub/b.md')).length, 1);
  assert.equal((await versions(api, 'a.md')).length, 0);
  await assert.rejects(api('GET', '/api/history/version?path=sub/b.md&id=../../a.md'), { status: 400 });
  await assert.rejects(api('GET', '/api/history?path=../x.md'), { status: 400 });
});
