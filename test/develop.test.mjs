// node --test (npm test): Develop this note (lib/develop.js, server.js
// /api/recall/develop).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requestText, parseReply } = require('../lib/develop.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('requestText: the note numbered P1…, the others [1]… (linked ones marked)', () => {
  assert.equal(requestText({ paras: ['# Ideas', 'Notes should change with AI.'], today: '2026-10-09 (Fri)', lang: 'en', found: [{ name: 'PKM', text: 'PARA folders.', linked: true }, { name: 'Log', text: 'The sift agent sorts my inbox.' }] }),
    'Today: 2026-10-09 (Fri)\n\nThe note:\nP1. # Ideas\nP2. Notes should change with AI.\n\nFrom their other notes:\n[1] from "PKM" (linked): PARA folders.\n[2] from "Log": The sift agent sorts my inbox.\n\nAnswer in English.');
  assert.match(requestText({ paras: ['x'], lang: 'ko' }), /\(none found\)\n\nAnswer in Korean/);
});

test('parseReply: each kind no more than it may be, the paragraph it is about, a gather only with what it gathers', () => {
  const r = parseReply([
    'kind: sharper\nat: P2\nsay: Notes are written for an agent to act on.',
    'kind: sharper\nsay: A second one.',
    'kind: question\nat: P9\nsay: Which three things should it handle?',
    'kind: ground\nat: P2\nsay: Your sift agent [2] already sorts the inbox.\nfrom: 2, 7',
    'kind: gather\nsay: Pieces of the same idea.',
    'kind: gather\nsay: These belong here.\nfrom: 1',
    'kind: none',
  ].join('\n---\n'), 2, 2);
  assert.deepEqual(r, [
    { kind: 'sharper', at: 1, say: 'Notes are written for an agent to act on.', from: [] },
    { kind: 'question', at: 0, say: 'Which three things should it handle?', from: [] },
    { kind: 'ground', at: 1, say: 'Your sift agent already sorts the inbox.', from: [2] },
    { kind: 'gather', at: 0, say: 'These belong here.', from: [1] },
  ]);
  assert.deepEqual(parseReply('kind: none', 1, 0), []);
});

// A stand-in for the claude CLI: a sharper line on P2 and a gather of [1].
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(j.message.content) + '\\n');
    const text = 'kind: sharper\\nat: P2\\nsay: Sharper.\\n---\\nkind: gather\\nsay: Same idea.\\nfrom: 1';
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: what it sends (never a private note), what it says by paragraph line, kept', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-dev-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-dev-bin-'));
  t.after(() => { for (const d of [ws, bin]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  const note = '# Ideas\n\nNotes should change now that agents write with us.\n\nSo a new kind of note app is needed.\n';
  fs.writeFileSync(path.join(ws, 'ideas.md'), note);
  fs.writeFileSync(path.join(ws, 'log.md'), '# Log\n\nThe sift agent sorts my inbox every morning.\n');
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret plan.\n');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open', '--agent', path.join(bin, 'claude')], { env: { ...process.env, FAKE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const dev = async (body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}/api/recall/develop`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const body = { path: 'ideas.md', text: note, today: '2026-10-09 (Fri)', refs: [{ path: 'secret.md', line: 3 }, { path: 'log.md', line: 2 }] };
  const r = await dev(body);
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.items, [
    { kind: 'sharper', line: 4, say: 'Sharper.', refs: [] },
    { kind: 'gather', line: 2, say: 'Same idea.', refs: [{ path: 'log.md', line: 2, name: 'log', raw: 'The sift agent sorts my inbox every morning.' }] },
  ]);
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.match(sent()[0], /P1\. Notes should change now that agents write with us\.\nP2\. So a new kind/);
  assert.doesNotMatch(sent()[0], /secret/);
  assert.deepEqual((await dev(body)).items, r.items, 'kept');
  assert.equal(sent().length, 1);
  fs.writeFileSync(path.join(ws, 'mine.md'), '---\nprivate: true\n---\nMine.\n');
  assert.equal((await dev({ ...body, path: 'mine.md' })).status, 403);
  assert.equal((await dev({ ...body, text: ' ' })).status, 400);
});
