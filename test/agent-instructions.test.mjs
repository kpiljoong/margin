// node --test (npm test): AGENTS.md at the top of the folder goes to the agent
// with every task, whatever the scope; not when it is private.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('AGENTS.md is sent with a task on one note, and listed with what is shared; private, it is not', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-instr-test-')));
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-instr-agent-'));
  t.after(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(tools, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(ws, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(ws, 'AGENTS.md'), '# Rules\n\nAlways write in Korean.\n');
  // An agent that writes down the prompt it was given.
  const agent = path.join(tools, 'agent.js');
  fs.writeFileSync(agent, "require('fs').writeFileSync('prompt.txt', process.env.AGENT_NOTES_PROMPT);\n");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', `"${process.execPath}" "${agent}"`], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  const scope = await api('GET', '/api/scope?scope=file&focus=a.md');
  assert.equal(scope.instructions, 'AGENTS.md');
  assert.deepEqual(scope.included, ['a.md']);
  let run = await api('POST', '/api/runs', { task: 'Tidy', scope: 'file', focus: 'a.md' });
  for (let i = 0; i < 100 && run.status === 'running'; i++) { await sleep(100); run = await api('GET', `/api/runs/${run.id}`); }
  const prompt = run.changes.find((c) => c.path === 'prompt.txt')?.lines.join('\n') || '';
  assert.match(prompt, /Instructions for this notes folder \(from AGENTS\.md\):\n# Rules\n\nAlways write in Korean\./);
  assert.match(prompt, /Task: Tidy/);

  fs.writeFileSync(path.join(ws, 'AGENTS.md'), '---\nprivate: true\n---\nsecret rules\n');
  assert.equal((await api('GET', '/api/scope?scope=file&focus=a.md')).instructions, null);
});
