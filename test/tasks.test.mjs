// node --test (npm test): the Tasks view's server side — every "- [ ]" in
// the workspace with its due date, and checking one off. Runs the real server.
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
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-tasks-test-')));
  fs.writeFileSync(path.join(ws, 'a.md'), '# A\n\n- [ ] call Alex 📅 2026-10-05\n- [x] done one\n  - [ ] nested due:2026-01-02\n\n```\n- [ ] not a task in code\n```\n');
  fs.mkdirSync(path.join(ws, 'templates'));
  fs.writeFileSync(path.join(ws, 'templates', 'T.md'), '- [ ] in a template\n');
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
  // Gone before its folder is: it may still be writing what it saw.
  const stop = async () => {
    if (proc.exitCode === null) await new Promise((r) => { proc.once('exit', r); proc.kill(); });
    fs.rmSync(ws, { recursive: true, force: true, maxRetries: 5 });
  };
  return { ws, api, stop };
}

test('tasks: every checkbox line with its due date, not in code or templates; checked off by line', async (t) => {
  const s = await startServer();
  t.after(s.stop);
  const { api } = s;
  const { tasks } = await api('GET', '/api/tasks');
  assert.deepEqual(tasks.map((x) => [x.path, x.line, x.done, x.text, x.due]), [
    ['a.md', 3, false, 'call Alex 📅 2026-10-05', '2026-10-05'],
    ['a.md', 4, true, 'done one', null],
    ['a.md', 5, false, 'nested due:2026-01-02', '2026-01-02'],
  ]);
  const r = await api('POST', '/api/tasks/toggle', { path: 'a.md', line: 3, text: 'call Alex 📅 2026-10-05' });
  assert.equal(r.done, true);
  assert.match(fs.readFileSync(path.join(s.ws, 'a.md'), 'utf8'), /- \[x\] call Alex/);
  await assert.rejects(api('POST', '/api/tasks/toggle', { path: 'a.md', line: 4, text: 'something else' }), (e) => e.status === 409);
  await api('POST', '/api/tasks/toggle', { path: 'a.md', line: 5, text: 'nested due:2026-01-02' });
  assert.match(fs.readFileSync(path.join(s.ws, 'a.md'), 'utf8'), /  - \[x\] nested/);
  assert.deepEqual((await api('GET', '/api/tasks')).tasks.map((x) => x.done), [true, true, true]);
});
