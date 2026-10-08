// node --test (npm test): the margin reads them with Claude (lib/judge.js,
// server.js /api/recall/judge; public/recall.js with what it says).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { recallIndex, recall, asks } from '../public/recall.js';

const require = createRequire(import.meta.url);
const { requestText, parseReply } = require('../lib/judge.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('requestText and parseReply: numbered paragraphs, lettered refs; a line each', () => {
  const items = [{ text: 'People leave at once.', refs: [{ name: 'Onboarding', text: 'The tutorial is too long.' }, { name: 'Sync', text: 'Sync is slow.' }] }, { text: 'Ship Friday.', refs: [{ name: 'Plan', text: 'We ship Monday.' }] }];
  assert.equal(requestText(items, 'ko'), '1. People leave at once.\n  1a) from "Onboarding": The tutorial is too long.\n  1b) from "Sync": Sync is slow.\n\n2. Ship Friday.\n  2a) from "Plan": We ship Monday.\n\nAnswer in Korean (\uD55C\uAD6D\uC5B4\uB85C \uB2F5\uD558\uC138\uC694).');
  assert.deepEqual(parseReply('1a same: the long tutorial loses them\n1b) none\n2a: AGAINST: “Monday, not Friday”\n3a same: no such\nchatter', items), [
    [{ rel: 'same', why: 'the long tutorial loses them' }, { rel: 'none', why: '' }],
    [{ rel: 'against', why: 'Monday, not Friday' }],
  ]);
  assert.deepEqual(parseReply('', items), [[undefined, undefined], [undefined]]);
});

test('recall and asks with what Claude said: none left out, the others with it; not read yet, as found', () => {
  const ix = recallIndex([
    { path: 'a.md', v: '1', created: 0, lines: [], text: 'New people leave the app on the first screen; the tutorial is too long.\n' },
    { path: 'b.md', v: '1', created: 0, lines: [], text: 'Mobile sync is slow on large workspaces.\n' },
  ]);
  const [a, b] = ix.paras.paras;
  const here = '# Today\n\nPeople quit right after signing up.\n';
  const semantic = () => ({ n: 12, list: [{ x: a, s: 0.93, z: 5 }, { x: b, s: 0.93, z: 4.8 }] });
  const said = new Map([['a.md', { rel: 'same', why: 'the tutorial loses them' }], ['b.md', { rel: 'none', why: '' }]]);
  const asked = [];
  const judge = (t, refs) => { asked.push(refs.map((r) => r.path)); return refs.map((r) => said.get(r.path)); };
  const r = recall(ix, 'today.md', here, { semantic, judge });
  assert.deepEqual(r.map((x) => x.refs.map((y) => [y.path, y.rel, y.why])), [[['a.md', 'same', 'the tutorial loses them']]]);
  assert.deepEqual(asked[0], ['a.md', 'b.md']);
  said.set('a.md', { rel: 'none', why: '' });
  assert.deepEqual(recall(ix, 'today.md', here, { semantic, judge }), []);
  assert.deepEqual(asks(ix, 'today.md', here, { cursor: 0, semantic, judge }), []);
  said.clear();
  assert.deepEqual(recall(ix, 'today.md', here, { semantic, judge })[0].refs.map((y) => [y.path, y.rel]), [['a.md', undefined], ['b.md', undefined]]);
  assert.equal(asks(ix, 'today.md', here, { cursor: 0, semantic, judge })[0].b.path, 'a.md');
});

// A stand-in for the claude CLI: each ref "same" (about its note), or
// "none" when its text says unrelated; each request written to FAKE_LOG.
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(j.message.content) + '\\n');
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    const text = [...j.message.content.matchAll(/^  (\\d+[a-c])\\) from "([^"]*)": (.*)$/gm)].map((m) => m[1] + (/unrelated/.test(m[3]) ? ' none' : ' same: about ' + m[2])).join('\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: the paragraphs it sends, never of a private or ignored note; kept by what was sent', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-judge-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-judge-bin-'));
  t.after(() => { fs.rmSync(ws, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  fs.writeFileSync(path.join(ws, 'today.md'), '# Today\n\nPeople quit right after signing up.\n');
  fs.writeFileSync(path.join(ws, 'onboarding.md'), '# Onboarding\n\nThe tutorial is too long.\n\nAn unrelated paragraph on lunch.\n');
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret plan.\n');
  fs.writeFileSync(path.join(ws, 'hidden.md'), 'Hidden words.\n');
  fs.writeFileSync(path.join(ws, 'mine.md'), '---\nprivate: true\n---\nMy own paragraph.\n');
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'hidden.md\n');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open', '--agent', path.join(bin, 'claude')], { env: { ...process.env, FAKE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const judge = async (body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}/api/recall/judge`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const body = { path: 'today.md', items: [{ text: 'People quit right after signing up.', refs: [{ path: 'onboarding.md', line: 2 }, { path: 'onboarding.md', line: 4 }, { path: 'secret.md', line: 3 }] }, { text: 'And more.', refs: [{ path: 'hidden.md', line: 0 }, { path: '../x.md', line: 0 }] }] };
  const r = await judge(body);
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.results, [[{ rel: 'same', why: 'about onboarding' }, { rel: 'none', why: '' }, null], [null, null]]);
  const sent = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(sent.length, 1);
  assert.equal(sent[0], '1. People quit right after signing up.\n  1a) from "onboarding": The tutorial is too long.\n  1b) from "onboarding": An unrelated paragraph on lunch.\n\nAnswer in English.');
  // The same again: from what was kept, nothing sent.
  assert.deepEqual((await judge(body)).results, r.results);
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 1);
  assert.ok(fs.existsSync(path.join(ws, '.agent-notes', 'judged.json')));
  // A private note's paragraphs, an ignored one's, are not sent.
  assert.equal((await judge({ ...body, path: 'mine.md' })).status, 403);
  assert.equal((await judge({ ...body, path: 'hidden.md' })).status, 403);
  assert.equal((await judge({ path: 'today.md', items: [{ text: 1, refs: [] }] })).status, 400);
});
