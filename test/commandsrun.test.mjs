// node --test (npm test): "Make or change a command…" — a run whose scope is
// Margin's own notes of commands (LEADER.md, RECIPES.md, MACROS.md) alone,
// with their notation and the names of the commands in the prompt; what the
// agent writes there comes back as any run, to review.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the commands scope: only the notes of commands, and a new one comes back to review', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cmds-test-')));
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-cmds-agent-'));
  t.after(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(tools, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(ws, 'LEADER.md'), '# Leader keys\n\n- `o j` Open today’s journal note\n');
  fs.writeFileSync(path.join(ws, 'a.md'), '# A\n');
  fs.mkdirSync(path.join(ws, 'sub'));
  fs.writeFileSync(path.join(ws, 'sub', 'MACROS.md'), '# Not the one\n');
  // An agent that writes down what it was asked and could see, and adds a macro.
  const agent = path.join(tools, 'agent.js');
  fs.writeFileSync(agent, [
    "const fs = require('fs');",
    "fs.writeFileSync('seen.txt', process.env.AGENT_NOTES_PROMPT + '\\n---\\n' + fs.readdirSync('.', { recursive: true }).sort().join('\\n'));",
    "fs.writeFileSync('MACROS.md', '# Macros\\n\\n## Quote\\n\\n```macro\\nmove line-start\\ntype \"> \"\\n```\\n');",
  ].join('\n'));
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

  assert.deepEqual((await api('GET', '/api/scope?scope=commands')).included, ['LEADER.md']);
  let run = await api('POST', '/api/runs', { task: 'A macro that quotes the line', scope: 'commands', commands: ['Save', 'Open today’s journal note', 42, 'x'.repeat(500)], keymap: ['- `n` +narrow', '- `n w` Widen: show the whole note'] });
  for (let i = 0; i < 100 && run.status === 'running'; i++) { await sleep(100); run = await api('GET', `/api/runs/${run.id}`); }
  assert.equal(run.status, 'review');
  const seen = run.changes.find((c) => c.path === 'seen.txt').lines.join('\n');
  assert.match(seen, /MACROS\.md — editing steps/);
  assert.match(seen, /- Save\n- Open today’s journal note\n- x{120}\n/);
  assert.match(seen, /written as LEADER\.md would[^]*\n- `n` \+narrow\n- `n w` Widen/);
  assert.match(seen, /Task: A macro that quotes the line/);
  assert.doesNotMatch(seen, /Diagrams render|a\.md/);
  assert.match(seen, /---\nLEADER\.md$/, 'it saw LEADER.md alone');
  const macros = run.changes.find((c) => c.path === 'MACROS.md');
  assert.ok(macros, 'the new MACROS.md is a change to review');
  assert.match(macros.after, /## Quote\n/, 'with its text as it would be, for the review to check');
  assert.ok(!fs.existsSync(path.join(ws, 'MACROS.md')), 'nothing changed before the review');

  // A follow-up keeps the notation and the names.
  let r2 = await api('POST', `/api/runs/${run.id}/followup`, { task: 'On o q too' });
  for (let i = 0; i < 100 && r2.status === 'running'; i++) { await sleep(100); r2 = await api('GET', `/api/runs/${r2.id}`); }
  assert.match(r2.changes.find((c) => c.path === 'seen.txt').lines.join('\n'), /The other commands, on no key[^]*- Save\n[^]*The reviewer's follow-up: On o q too/);

  // Another task gets the notation when it is about these notes (Korean too),
  // and the ```flow one when it asks for a flow chart in Korean.
  const ask = async (task) => {
    let r = await api('POST', '/api/runs', { task, scope: 'file', focus: 'a.md' });
    for (let i = 0; i < 100 && r.status === 'running'; i++) { await sleep(100); r = await api('GET', `/api/runs/${r.id}`); }
    return r.changes.find((c) => c.path === 'seen.txt').lines.join('\n');
  };
  const macro = await ask('\uB9E4\uD06C\uB85C \uD558\uB098 \uB9CC\uB4E4\uC5B4\uC918');
  assert.match(macro, /MACROS\.md — editing steps/);
  assert.match(macro, /---\nLEADER\.md\na\.md$/, 'and it sees LEADER.md with the note');
  // A note of cooking recipes is not about Margin's.
  const cooking = await ask('\uC774 \uB808\uC2DC\uD53C \uC694\uC57D\uD574\uC918 (summarize the recipes)');
  assert.doesNotMatch(cooking, /MACROS\.md — editing steps/);
  assert.match(cooking, /---\na\.md$/, 'it sees the note alone');
  const flow = await ask('\uC774 \uACFC\uC815\uC744 \uD750\uB984\uB3C4\uB85C \uADF8\uB824\uC918');
  assert.match(flow, /The ```flow notation/);
  assert.doesNotMatch(flow, /MACROS\.md — editing steps/);
  assert.match(flow, /---\na\.md$/);
});
