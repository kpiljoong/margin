// node --test (npm test): the margin thinks along (lib/think.js, server.js
// /api/recall/think; public/recall.js nearFor).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { recallIndex, nearFor } from '../public/recall.js';

const require = createRequire(import.meta.url);
const { requestText, foundText, parseReply, calendarOf } = require('../lib/think.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('calendarOf: the days after today by week, Monday first', () => {
  assert.equal(calendarOf('2026-10-09 (Fri)'), 'this week: Sat 2026-10-10, Sun 2026-10-11; next week: Mon 2026-10-12, Tue 2026-10-13, Wed 2026-10-14, Thu 2026-10-15, Fri 2026-10-16, Sat 2026-10-17, Sun 2026-10-18; the week after: Mon 2026-10-19, Tue 2026-10-20, Wed 2026-10-21, Thu 2026-10-22, Fri 2026-10-23, Sat 2026-10-24, Sun 2026-10-25');
  assert.match(calendarOf('2026-10-11'), /^this week: \(today is its last day\); next week: Mon 2026-10-12/);
  assert.equal(calendarOf(''), '');
});

test('requestText: today, its calendar, what comes before, the paragraph, the others numbered; foundText goes on numbering', () => {
  const found = [{ name: 'Pricing', text: 'We charge 500,000 won a person.' }, { name: 'Venue', text: 'The hall on 3rd street.' }];
  assert.equal(requestText({ text: 'What was the price again?', before: '# Plan\n\n', today: '2026-10-09 (Fri)', lang: 'en', found }),
    `Today: 2026-10-09 (Fri)\n\nCalendar: ${calendarOf('2026-10-09')}\n\nBefore:\n# Plan\n\nParagraph:\nWhat was the price again?\n\nFrom their other notes:\n[1] from "Pricing": We charge 500,000 won a person.\n[2] from "Venue": The hall on 3rd street.\n\nAnswer in English.`);
  assert.match(requestText({ text: 'x', lang: 'ko' }), /From their other notes: \(none found\)\n\nAnswer in Korean/);
  assert.match(foundText('venue', found, 1), /^Looked up "venue" in their notes:\n\n\[2\] from "Venue": The hall/);
  assert.match(foundText('venue', found, 2), /\(nothing found\)/);
});

test('parseReply: one or two things of different kinds, a date only for a to-do, the numbers each used; nothing to say is none', () => {
  assert.deepEqual(parseReply('kind: todo\ndue: 2026-10-16\nsay: Book the hall.\nfrom: 2, 9, 2', 2), { items: [{ kind: 'todo', due: '2026-10-16', say: 'Book the hall.', from: [2] }], search: '' });
  assert.deepEqual(parseReply('kind: Against\nsay: "The pricing note put it off."\nfrom: 1\n---\nkind: todo\ndue: 2026-10-16\nsay: Submit it.\nfrom:', 1).items,
    [{ kind: 'against', due: '', say: 'The pricing note put it off.', from: [1] }, { kind: 'todo', due: '2026-10-16', say: 'Submit it.', from: [] }]);
  assert.deepEqual(parseReply('kind: risk\nsay: a\n---\nkind: risk\nsay: b\n---\nkind: next\nsay: c\n---\nkind: question\nsay: d', 0).items.map((x) => x.say), ['a', 'c'], 'two at most, one of a kind');
  assert.equal(parseReply('kind: thinking\ndue: 2026-10-16\nsay: x', 0).items[0].due, '');
  assert.deepEqual(parseReply('kind: recall\nsearch: launch price', 0), { items: [], search: 'launch price' });
  assert.deepEqual(parseReply('kind: thinking\nfrom: 1', 1).items, [], 'nothing said');
  assert.deepEqual(parseReply('Sure! Here is my take.', 0).items, []);
  assert.deepEqual(parseReply('kind: none\nsay: nothing', 0).items, []);
  assert.equal(parseReply('kind: thinking\nsay: You chose the 20th [2], as did [1, 3].\nfrom: 1, 2, 3', 3).items[0].say, 'You chose the 20th, as did.', 'numbers stay out of what it says');
  assert.equal(parseReply('kind: thinking\nsay: [1]\uC5D0\uC11C \uC815\uD588\uB2E4.', 1).items[0].say, '\uC815\uD588\uB2E4.', 'and the particle after one');
});

test('nearFor: more than the related ones (the model reads them); null while the local model has not answered', () => {
  const ix = recallIndex([
    { path: 'a.md', v: '1', created: 0, lines: [], text: 'The launch price is 500,000 won a person, decided with sales.\n' },
    { path: 'b.md', v: '1', created: 0, lines: [], text: 'Lunch at the usual place on Friday.\n' },
  ]);
  const [a, b] = ix.paras.paras;
  assert.deepEqual(nearFor(ix, 'here.md', 'What was the launch price again?'), [{ path: 'a.md', line: 0 }]);
  assert.deepEqual(nearFor(ix, 'here.md', 'x', { semantic: () => null }), null);
  assert.deepEqual(nearFor(ix, 'here.md', 'x', { semantic: () => ({ n: 9, list: [{ x: a, s: 0.9, z: 3 }, { x: b, s: 0.8, z: 0.6 }] }) }), [{ path: 'a.md', line: 0 }]);
});

// A stand-in for the claude CLI: a to-do and a next step, an answer from paragraph [1], a
// lookup, or nothing — by the paragraph; each message written to FAKE_LOG.
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    const c = j.message.content;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(c) + '\\n');
    const p = (/Paragraph:\\n(.*)/.exec(c) || [])[1] || '';
    const text = /milk/.test(p) ? 'kind: todo\\ndue: 2026-10-16\\nsay: Buy milk.\\n---\\nkind: next\\nsay: Check the fridge.' : /price/.test(p) && /\\[1\\]/.test(c) ? 'kind: recall\\nsay: 500,000 won a person.\\nfrom: 1' : /venue/.test(p) ? 'kind: recall\\nsearch: venue' : 'kind: none';
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: what it sends (never a private or ignored note), what it says, kept by what was sent', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-think-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-think-bin-'));
  const models = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-think-models-'));
  t.after(() => { for (const d of [ws, bin, models]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  fs.writeFileSync(path.join(ws, 'plan.md'), '# Plan\n\nWhat was the price again?\n');
  fs.writeFileSync(path.join(ws, 'pricing.md'), '# Pricing\n\nThe launch price is 500,000 won a person.\n');
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret price.\n');
  fs.writeFileSync(path.join(ws, 'hidden.md'), 'Hidden price.\n');
  fs.writeFileSync(path.join(ws, '.agentnotesignore'), 'hidden.md\n');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open', '--agent', path.join(bin, 'claude')], { env: { ...process.env, FAKE_LOG: log, MARGIN_MODELS_DIR: models }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const think = async (body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}/api/recall/think`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const body = { path: 'plan.md', text: 'What was the price again?', before: '# Plan\n', today: '2026-10-09 (Fri)', refs: [{ path: 'secret.md', line: 3 }, { path: 'pricing.md', line: 2 }, { path: 'hidden.md', line: 0 }, { path: '../x.md', line: 0 }] };
  const r = await think(body);
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r, { status: 200, items: [{ kind: 'recall', due: '', say: '500,000 won a person.', refs: [{ path: 'pricing.md', line: 2, name: 'pricing', raw: 'The launch price is 500,000 won a person.' }] }] });
  assert.equal(sent()[0], `Today: 2026-10-09 (Fri)\n\nCalendar: ${calendarOf('2026-10-09')}\n\nBefore:\n# Plan\n\nParagraph:\nWhat was the price again?\n\nFrom their other notes:\n[1] from "pricing": The launch price is 500,000 won a person.\n\nAnswer in English.`);
  // Again: kept, nothing sent.
  assert.deepEqual(await think(body), r);
  assert.equal(sent().length, 1);
  assert.ok(fs.existsSync(path.join(ws, '.agent-notes', 'thought.json')));
  // A to-do and its day; a lookup with no local model finds nothing: nothing to say.
  assert.deepEqual(await think({ ...body, text: 'Need to buy milk.', refs: [] }), { status: 200, items: [{ kind: 'todo', due: '2026-10-16', say: 'Buy milk.', refs: [] }, { kind: 'next', due: '', say: 'Check the fridge.', refs: [] }] });
  assert.deepEqual((await think({ ...body, text: 'Where was the venue?', refs: [] })).items, []);
  assert.doesNotMatch(sent().join('\n'), /secret|Hidden/);
  // Not from a private or ignored note; nonsense refused.
  fs.writeFileSync(path.join(ws, 'mine.md'), '---\nprivate: true\n---\nMine.\n');
  assert.equal((await think({ ...body, path: 'mine.md' })).status, 403);
  assert.equal((await think({ ...body, path: 'hidden.md' })).status, 403);
  assert.equal((await think({ ...body, refs: [{ path: 'a.md', line: -1 }] })).status, 400);
  assert.equal((await think({ ...body, text: '  ' })).status, 400);
});
