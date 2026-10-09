// node --test (npm test): Brief, Labs (public/brief.js, lib/brief.js,
// server.js /api/lab/brief).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { modeOf, meetingBrief, carriedOver, writingBrief, briefOf, dateOfName } from '../public/brief.js';

const require = createRequire(import.meta.url);
const { requestText, parseReply, systemOf } = require('../lib/brief.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('what kind of note: a meeting, a draft, a plan, or none', () => {
  assert.equal(modeOf('Weekly 2026-10-08.md', '# Weekly\n\n- notes\n'), 'meeting');
  assert.equal(modeOf('x.md', '# Sync\n\nAttendees: Ann, Bo\n'), 'meeting');
  assert.equal(modeOf('x 2026-10-08.md', '# X\n\n## Warm-up (10m)\n- fine\n'), null, 'a dated workout with minutes');
  assert.equal(modeOf('x.md', '# X\n\n## Status (5m)\n- fine\n'), null, 'minutes in headings alone: a lesson plan too');
  assert.equal(modeOf('p2p sync system.md', '# Sync\n\nHow peers sync.\n'), null, 'sync: a protocol too');
  assert.equal(modeOf('Design sync 2026-10-08.md', '# Design sync\n'), 'meeting');
  assert.equal(modeOf('x.md', '# X\n\n- We ship #decision\n- Beta? #question\n'), 'meeting');
  assert.equal(modeOf('\uC8FC\uAC04 \uD68C\uC758.md', '# a\n'), 'meeting');
  assert.equal(modeOf('blog/why notes fail.md', '# Why notes fail\n\nText.\n'), 'writing');
  assert.equal(modeOf('x.md', '---\ntype: blog post\n---\n# X\n'), 'writing');
  assert.equal(modeOf('Q4 plan.md', '# Q4\n'), 'plan');
  assert.equal(modeOf('groceries.md', '# Groceries\n\n- milk\n'), null);
  assert.equal(dateOfName('a/Weekly 2026-10-05.md'), '2026-10-05');
});

test('a meeting: its agenda covered as it is written, what the last one left, what still needs settling', () => {
  const text = [
    '# Weekly 2026-10-08', '', 'Attendees: Ann, Bo', '',
    '## Launch (10m)',
    '- We ship on Friday #decision',
    '- [ ] Submit to the store @bo \u{1F4C5} 2026-10-10',
    '- [ ] Write the release notes \u{1F4C5} 2026-10-12',
    '- [ ] Write release notes for the launch @ann \u{1F4C5} 2026-10-14',
    '- [ ] Book the room @ann \u{1F4C5} 2026-10-01',
    '- [ ] Call the printer @ann',
    '', '## Pricing (10m)', '',
  ].join('\n');
  const prev = '# Weekly 2026-10-01\n- Do we need a beta first? #question\n- [ ] Draft the store text @bo\n- [x] Old thing\n- The offer range #next\n';
  const others = [{ path: 'Roadmap.md', name: 'Roadmap', line: 3, raw: '- [ ] Submit app to the store \u{1F4C5} 2026-10-20', text: 'Submit app to the store', done: false }];
  const b = meetingBrief(text, { path: 'Weekly 2026-10-08.md', today: '2026-10-08', prev, others });
  assert.deepEqual(b.cover.filter((c) => c.from === 'agenda').map((c) => [c.text, c.state]), [['Launch', 'decided'], ['Pricing', 'empty']]);
  // Talked about is not settled.
  const talk = meetingBrief('# Sync 2026-10-08\n\n## Onboarding (10m)\n- Some think the form, some the empty state.\n\n## Referrals (5m)\n- Ann will compare the two offers.\n\n## Pricing (5m)\n- \uAC00\uACA9\uC740 9,900\uC6D0\uC73C\uB85C \uD558\uAE30\uB85C \uD568\n');
  assert.deepEqual(talk.cover.map((c) => [c.text, c.state, c.done]), [['Onboarding', 'discussed', true], ['Referrals', 'next', true], ['Pricing', 'decided', true]]);
  assert.deepEqual(b.cover.filter((c) => c.from === 'last').map((c) => [c.kind, c.text, c.done]), [['question', 'Do we need a beta first?', false], ['todo', 'Draft the store text', false], ['next', 'The offer range', false]]);
  const said = b.flags.map((f) => `${f.kind} ${f.line} ${f.say}`);
  assert.ok(said.includes('gap 7 Who does it? No one is on this to-do.'), said.join('\n'));
  assert.ok(said.includes('gap 10 By when? This to-do has no date.'));
  assert.ok(said.some((s) => /^conflict 9 Its date, 2026-10-01, is before the meeting/.test(s)));
  assert.ok(said.includes('conflict 6 2026-10-10 is a Saturday.'));
  assert.ok(said.some((s) => /^conflict 8 The same to-do is due 2026-10-12 a few lines up, 2026-10-14 here/.test(s)), 'one to-do, two dates');
  const there = b.flags.find((f) => f.key.startsWith('elsewhere|'));
  assert.equal(there.line, 6);
  assert.match(there.say, /In Roadmap the same to-do is due 2026-10-20/);
  assert.deepEqual(there.refs, [{ path: 'Roadmap.md', line: 3, name: 'Roadmap', raw: others[0].raw }]);
  assert.deepEqual(b.needs.map((n) => n.key), []);
  // Covered once spoken of; a to-do once it is here, ticked.
  const later = carriedOver(prev, `${text}\n- A beta first: we need one for two weeks #decision\n- [x] Draft the store text @bo\n`);
  assert.deepEqual(later.map((c) => c.done), [true, true, false]);
  // A meeting with talk and nothing settled.
  const loose = '# Sync\n\nAttendees: A, B\n\n- We talked about onboarding.\n- Some think the form, some the empty state.\n- Ann will look at the numbers.\n- Is it the form? #question\n- That was all.\n';
  assert.deepEqual(meetingBrief(loose).needs.map((n) => n.key), ['decision', 'open'], '"Ann will look at the numbers" is a next step');
  assert.deepEqual(meetingBrief(loose.replace('Ann will look at the numbers.', 'Numbers were shown.')).needs.map((n) => n.key), ['decision', 'next', 'open']);
  assert.deepEqual(meetingBrief(loose.replace('That was all.', 'We agreed: the form goes. Ann follows up next week.')).needs.map((n) => n.key), ['open'], 'decided and next, in words');
  // A checklist: many to-dos with no date, said once.
  const list = `# Launch meeting\n\n${[1, 2, 3, 4, 5, 6].map((i) => `- [ ] Step ${i}`).join('\n')}\n`;
  const lb = meetingBrief(list);
  assert.deepEqual(lb.flags, []);
  assert.deepEqual(lb.needs.map((n) => n.say), ['6 to-dos with no date', 'No decision written down']);
});

test('a draft: placeholders, a long paragraph, empty sections; a plan: dates', () => {
  const draft = `# Why\n\n## Start\n\nIt began TODO.\n\n${'word '.repeat(200)}\n\n## Middle\n\n## End\n\nDone.\n`;
  const w = writingBrief(draft);
  assert.deepEqual(w.flags.map((f) => [f.line, f.say.slice(0, 20)]), [[4, 'Still to write: a pl'], [6, 'A long paragraph (20']]);
  assert.deepEqual(w.cover.map((c) => [c.text, c.done]), [['Start', true], ['Middle', false], ['End', true]]);
  assert.deepEqual(w.needs.map((n) => n.key), []);
  const p = briefOf('plan', '# Plan\n\n## Build\n- [ ] Ship it \u{1F4C5} 2026-10-11\n- [ ] Test it\n', { today: '2026-10-08' });
  assert.deepEqual(p.flags.map((f) => f.key), ['weekend|Ship it', 'due|Test it']);
  assert.equal(briefOf(null, 'x'), null);
});

test('what goes to Claude, and what comes back', () => {
  const msg = requestText({ mode: 'meeting', paras: ['We ship Friday.', 'Price 9,900.'], today: '2026-10-08 (Thu)', lang: 'ko', last: { name: 'Weekly 2026-10-01', text: '- Beta? #question' }, noted: ['No summary'], found: [{ name: 'Pricing', date: '2026-09-20', text: 'Annual only.' }] });
  assert.match(msg, /^Today: 2026-10-08 \(Thu\)\n\nCalendar: this week: Fri 2026-10-09/);
  assert.match(msg, /The meeting note:\nP1\. We ship Friday\.\nP2\. Price 9,900\./);
  assert.match(msg, /The last meeting's note \(L\), "Weekly 2026-10-01":\n- Beta\? #question/);
  assert.match(msg, /\[1\] from "Pricing" \(2026-09-20\): Annual only\./);
  assert.match(msg, /Already noted \(don't repeat\):\n- No summary/);
  assert.match(msg, /Korean/);
  assert.doesNotMatch(requestText({ mode: 'writing', paras: ['x'], today: '2026-10-08' }), /Calendar|L\)/);
  assert.match(systemOf('plan'), /premise the plan rests on/);
  const items = parseReply([
    'kind: conflict', 'at: P2', 'say: P2\uB294 [1]\uC5D0\uC11C \uC815\uD55C \uAC83\uACFC \uB2E4\uB984', 'from: 1, 7', '---',
    'kind: conflict', 'say: "Quoted whole."', '---',
    'kind: conflict', 'say: "One" and "two" differ.', '---',
    'kind: conflict', 'say: A fourth.', '---',
    'kind: point', 'say: Not a meeting kind.', '---',
    'kind: ask', 'at: P9', 'say: Why Friday?',
  ].join('\n'), 'meeting', 2, 1);
  assert.deepEqual(items, [
    { kind: 'conflict', at: 1, say: '\uC815\uD55C \uAC83\uACFC \uB2E4\uB984', from: [1] },
    { kind: 'conflict', at: 0, say: 'Quoted whole.', from: [] },
    { kind: 'conflict', at: 0, say: '"One" and "two" differ.', from: [] },
    { kind: 'ask', at: 0, say: 'Why Friday?', from: [] },
  ]);
  assert.deepEqual(parseReply('kind: none'), []);
});

// A stand-in for the claude CLI: a conflict on P2 from [1] and an ask.
const FAKE = `#!/usr/bin/env node
const fs = require('fs');
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  for (let i; (i = buf.indexOf('\\n')) >= 0;) {
    const j = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (j.type !== 'user') continue;
    fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(j.message.content) + '\\n');
    const text = /^The title:/.test(j.message.content) ? '[1] supports: Again.\\n[2] counters: Otherwise.\\nmaybe: Narrower.\\ncheck: Ask.' : 'kind: conflict\\nat: P2\\nsay: Decided otherwise before.\\nfrom: 1\\n---\\nkind: ask\\nat: P2\\nsay: Why Friday?';
    const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { text } } });
    out({ type: 'result', subtype: 'success', total_cost_usd: 0.001, usage: { input_tokens: 10, output_tokens: 3 } });
  }
});
`;

test('the server: the note, its last meeting and the notes near it (never a private one), kept', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-brief-test-')));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-brief-bin-'));
  t.after(() => { for (const d of [ws, bin]) fs.rmSync(d, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(bin, 'claude'), FAKE, { mode: 0o755 });
  const log = path.join(bin, 'log');
  const note = '# Weekly 2026-10-08\n\nPrevious meeting: [[Weekly 2026-10-01]]\n\n- We ship on Friday #decision\n';
  fs.writeFileSync(path.join(ws, 'Weekly 2026-10-08.md'), note);
  fs.writeFileSync(path.join(ws, 'Weekly 2026-10-01.md'), '# Weekly 2026-10-01\n\n- Beta first? #question\n');
  fs.writeFileSync(path.join(ws, 'Roadmap 2026-09-28.md'), '# Roadmap\n\nWe ship on the 24th, after the beta.\n');
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret plan.\n');
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open', '--agent', path.join(bin, 'claude')], { env: { ...process.env, FAKE_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const brief = async (body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}/api/lab/brief`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, ...(await r.json()) };
  };
  const body = { path: 'Weekly 2026-10-08.md', text: note, mode: 'meeting', today: '2026-10-08 (Thu)', noted: ['No summary'], prev: { path: 'Weekly 2026-10-01.md' }, refs: [{ path: 'Roadmap 2026-09-28.md', line: 2 }, { path: 'secret.md', line: 3 }] };
  const r = await brief(body);
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.items, [
    { kind: 'conflict', line: 4, say: 'Decided otherwise before.', refs: [{ path: 'Roadmap 2026-09-28.md', line: 2, name: 'Roadmap 2026-09-28', raw: 'We ship on the 24th, after the beta.' }] },
    { kind: 'ask', line: 4, say: 'Why Friday?', refs: [] },
  ]);
  const sent = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.match(sent()[0], /The last meeting's note \(L\), "Weekly 2026-10-01":\n# Weekly 2026-10-01/);
  assert.match(sent()[0], /\[1\] from "Roadmap 2026-09-28" \(2026-09-28\): We ship on the 24th/);
  assert.doesNotMatch(sent()[0], /secret/);
  assert.deepEqual((await brief(body)).items, r.items, 'kept');
  assert.equal(sent().length, 1);
  // The last meeting's note when it is private: not sent.
  const r2 = await brief({ ...body, prev: { path: 'secret.md' } });
  assert.equal(r2.status, 200);
  assert.doesNotMatch(sent()[1], /secret|last meeting/);
  assert.equal((await brief({ ...body, mode: 'novel' })).status, 400);
  assert.equal((await brief({ ...body, path: 'secret.md' })).status, 403);
  // Themes: the recent notes' paragraphs, never a private one.
  fs.writeFileSync(path.join(ws, 'secret.md'), '---\nprivate: true\n---\nThe secret plan is long enough to be a paragraph of its own.\n');
  const th = await fetch(`http://127.0.0.1:${m[1]}/api/lab/themes`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: '{}' });
  const tj = await th.json();
  assert.equal(th.status, 200, tj.error);
  assert.deepEqual(tj.themes, []);
  const asked = sent().at(-1);
  assert.match(asked, /from "Roadmap 2026-09-28" \(2026-09-28\): We ship on the 24th/);
  assert.doesNotMatch(asked, /secret/);
  fs.writeFileSync(path.join(ws, 'Roadmap copy.md'), '# Roadmap (copy)\n\nWe ship on the 24th,  after the beta!\n');
  await fetch(`http://127.0.0.1:${m[1]}/api/lab/themes`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: '{}' });
  assert.equal(sent().at(-1).match(/We ship on the 24th/g).length, 1, 'a copy is one paragraph');
  // A theme checked: what came since it was made (not before, not its own, never private).
  fs.writeFileSync(path.join(ws, 'Demo 2026-10-12.md'), '# Demo\n\nPeople stopped at the template list for a long while.\n');
  fs.writeFileSync(path.join(ws, 'Call 2026-10-13.md'), '# Call\n\nShe picked a template at once, having used Notion.\n');
  fs.writeFileSync(path.join(ws, 'Old 2026-09-01.md'), '# Old\n\nSomeone stalled at the first screen back then.\n');
  const check = async (body) => { const r = await fetch(`http://127.0.0.1:${m[1]}/api/lab/themes/check`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const theme = { title: 'New users stall', reading: 'Too many choices.', made: '2026-10-09', scenes: [{ text: 'Someone stalled at the first screen back then.', name: 'Old 2026-09-01' }] };
  fs.writeFileSync(path.join(ws, 'Themes.md'), '# t\n');
  // Twelve older ones nearer than the new ones: they don't take their places.
  const older = [...Array(12)].map((_, i) => { const f = `Before ${i} 2026-09-${String(i + 10).padStart(2, '0')}.md`; fs.writeFileSync(path.join(ws, f), `# B\n\nAn older paragraph near it, number ${i}.\n`); return { path: f, line: 2 }; });
  const c = await check({ path: 'Themes.md', theme, refs: [{ path: 'Old 2026-09-01.md', line: 2 }, { path: 'secret.md', line: 3 }, ...older, { path: 'Demo 2026-10-12.md', line: 2 }, { path: 'Call 2026-10-13.md', line: 2 }] });
  assert.equal(c.read, 2);
  assert.equal(c.status, 200, c.error);
  assert.deepEqual(c.items.map((x) => [x.verdict, x.why, x.ref.name, x.ref.date]), [['supports', 'Again.', 'Demo 2026-10-12', '2026-10-12'], ['counters', 'Otherwise.', 'Call 2026-10-13', '2026-10-13']]);
  assert.deepEqual(c.maybe, { reading: 'Narrower.', check: 'Ask.' });
  assert.doesNotMatch(sent().at(-1), /secret|back then\.\n\[|^\[\d\] from "Old/m);
  assert.match(sent().at(-1), /New paragraphs:\n\[1\] from "Demo 2026-10-12" \(2026-10-12\): People stopped/);
  assert.equal((await check({ path: 'Themes.md', theme: { ...theme, title: '' }, refs: [] })).status, 400);
  // Another theme note (in Themes/, or marked "theme:") is no new case: never sent.
  fs.mkdirSync(path.join(ws, 'Themes'));
  fs.writeFileSync(path.join(ws, 'Themes', 'Other 2026-10-12.md'), '# Other\n\nA reading of another theme, new enough to count.\n');
  fs.writeFileSync(path.join(ws, 'Marked 2026-10-12.md'), '---\ntheme: 2026-10-11\n---\n# Marked\n\nA reading kept outside Themes, new enough to count.\n');
  const c2 = await check({ path: 'Themes.md', theme, refs: [{ path: 'Themes/Other 2026-10-12.md', line: 2 }, { path: 'Marked 2026-10-12.md', line: 5 }, { path: 'Demo 2026-10-12.md', line: 2 }] });
  assert.equal(c2.status, 200, c2.error);
  assert.equal(c2.read, 1);
  assert.doesNotMatch(sent().at(-1), /A reading of another theme|A reading kept outside/);
});

const themes = require('../lib/themes.js');

test('themes: what goes, what comes back (three paragraphs, two notes at least), the note made of one', () => {
  const found = [
    { path: 'a.md', name: 'Interview 2026-08-21', date: '2026-08-21', text: 'Did not know what to do first.' },
    { path: 'b.md', name: 'Support', date: '2026-09-03', text: 'Where do I start? five tickets.' },
    { path: 'c.md', name: 'Demo', date: '2026-09-17', text: 'Stuck in front of the templates.' },
    { path: 'a.md', name: 'Interview 2026-08-21', date: '2026-08-21', text: 'What do I click now?' },
  ];
  assert.match(themes.requestText({ found, lang: 'ko' }), /^\[1\] from "Interview 2026-08-21" \(2026-08-21\): Did not know/);
  const got = themes.parseReply([
    'title: "New users can\'t pick a first step"', 'from: 1, 2, 3, 9', 'reading: Many [2] places.', 'open: Whether examples help.', '---',
    'title: Only one note', 'from: 1, 4, 1', '---',
    'title: Two only', 'from: 1, 2',
  ].join('\n'), found);
  assert.deepEqual(got, [{ title: 'New users can\'t pick a first step', from: [1, 2, 3], reading: 'Many places.', open: 'Whether examples help.' }]);
  assert.deepEqual(themes.parseReply('none', found), []);
  const md = themes.themeNote(got[0], got[0].from.map((n) => found[n - 1]));
  assert.match(md, /^# New users can't pick a first step\n\n> \[!note\] Margin's reading — a suggestion/);
  assert.match(md, /- Did not know what to do first\. — \[\[Interview 2026-08-21\]\]\n- Where do I start\? five tickets\. — \[\[Support\]\] \(2026-09-03\)/);
  assert.match(md, /## Not checked yet\n\n- Whether examples help\./);
});

test('since the last meeting, elsewhere: later notes about what it left', () => {
  const prev = '# Weekly 2026-10-01\n- Do we need a beta first? #question\n- [ ] Draft the store text @bo\n';
  const others = [
    { path: 'Beta plan 2026-10-03.md', name: 'Beta plan 2026-10-03', date: '2026-10-03', line: 4, raw: '- We need a beta first, two weeks #decision', kind: 'decision', done: false, text: 'We need a beta first, two weeks' },
    { path: 'Old 2026-09-20.md', name: 'Old', date: '2026-09-20', line: 1, raw: '- Beta first? #question', kind: 'question', done: false, text: 'Do we need a beta first?' },
    { path: 'Store 2026-10-05.md', name: 'Store', date: '2026-10-05', line: 2, raw: '- [x] Draft the store text', kind: 'todo', done: true, text: 'Draft the store text' },
    { path: 'Lunch 2026-10-06.md', name: 'Lunch', date: '2026-10-06', line: 2, raw: '- [ ] Book lunch', kind: 'todo', done: false, text: 'Book lunch' },
  ];
  const b = meetingBrief('# Weekly 2026-10-08\n', { path: 'Weekly 2026-10-08.md', prev, prevPath: 'Weekly 2026-10-01.md', others });
  assert.deepEqual(b.since.map((c) => [c.ref.name, c.kind, c.done, c.about]), [['Store', 'todo', true, 'Draft the store text'], ['Beta plan 2026-10-03', 'decision', false, 'Do we need a beta first?']]);
});

test('what the last meeting left, settled since in another note: covered, and where', () => {
  const prev = '# Weekly 2026-10-01\n- Do we need a beta first? #question\n- [ ] Draft the store text @bo\n';
  const others = [{ path: 'Store 2026-10-05.md', name: 'Store', date: '2026-10-05', line: 2, raw: '- [x] Draft the store text, shared', kind: 'todo', done: true, text: 'Draft the store text, shared' }];
  const b = meetingBrief('# Weekly 2026-10-08\n', { path: 'Weekly 2026-10-08.md', prev, prevPath: 'Weekly 2026-10-01.md', others });
  assert.deepEqual(b.cover.map((c) => [c.text, c.done, c.where]), [['Do we need a beta first?', false, undefined], ['Draft the store text', true, 'Store']]);
});

import { themeOf, addScene, addUnfit, withReading, inTheme, themeSig } from '../public/theme.js';

test('a theme note read back, and grown: another case, one that does not fit, the reading in other words', () => {
  const note = themes.themeNote({ title: 'New users stall at the first step', reading: 'Too many choices, nothing picked.', open: 'Whether examples help.' },
    [{ text: 'Did not know what to do first.', name: 'Interview 2026-08-21', date: '2026-08-21' }, { text: 'Where do I start? five tickets.', name: 'Support', date: '2026-09-03' }], '2026-10-09');
  assert.match(note, /^---\ntheme: 2026-10-09\n---\n# New users stall/);
  const t = themeOf(note, 'Themes/New users.md');
  assert.equal(t.title, 'New users stall at the first step');
  assert.equal(t.made, '2026-10-09');
  assert.equal(t.reading, 'Too many choices, nothing picked.');
  assert.deepEqual(t.scenes.map((s) => [s.text, s.name, s.date]), [['Did not know what to do first.', 'Interview 2026-08-21', ''], ['Where do I start? five tickets.', 'Support', '2026-09-03']]);
  assert.deepEqual(t.open, ['Whether examples help.']);
  assert.equal(themeOf('# Groceries\n\n- milk\n', 'Groceries.md'), null);
  assert.ok(inTheme(t, 'did not know what to do first'));
  const more = addScene(note, { text: 'Stuck at the template list.', name: 'Demo 2026-10-12', date: '2026-10-12' });
  assert.match(more, /- Where do I start\? five tickets\. — \[\[Support\]\] \(2026-09-03\)\n- Stuck at the template list\. — \[\[Demo 2026-10-12\]\]\n\n## Not checked yet/);
  const unfit = addUnfit(more, { text: 'Picked a template at once: had used Notion.', name: 'Interview 2026-10-10', date: '2026-10-10' });
  assert.match(unfit, /\n## Doesn't fit \(yet\)\n\n- Picked a template at once: had used Notion\. — \[\[Interview 2026-10-10\]\]\n\n## Not checked yet/);
  const again = addUnfit(unfit, { text: 'Knew at once.', name: 'Call', date: '' });
  assert.match(again, /had used Notion\. — \[\[Interview 2026-10-10\]\]\n- Knew at once\. — \[\[Call\]\]\n/);
  assert.deepEqual(themeOf(again).unfit.map((s) => s.name), ['Interview 2026-10-10', 'Call']);
  // Another reading: tried only if the reading is still the one checked; the
  // one before stays, what would tell goes under Not checked yet; no case moves.
  assert.equal(withReading(again, 'X.', { expected: 'Something else.' }), null, 'changed since the check');
  const re = withReading(again, 'New users with no notes app before stall.', { expected: 'Too many  choices, nothing picked.', check: 'Ask the next three interviewees which app they used before.', day: '2026-10-15' });
  assert.match(re, /> \[!note\] Margin's reading — a suggestion; change it or delete it\n> New users with no notes app before stall\.\n> Before \(2026-10-15\): Too many choices, nothing picked\.\n\n## Where/);
  assert.match(re, /## Not checked yet\n\n- Whether examples help\.\n- Ask the next three interviewees which app they used before\.\n/);
  const t2 = themeOf(re);
  assert.equal(t2.reading, 'New users with no notes app before stall.');
  assert.deepEqual([t2.scenes.length, t2.unfit.length], [3, 2], 'no case moved or taken out');
  const re2 = withReading(re, 'Third.', { expected: t2.reading, day: '2026-10-20' });
  assert.match(re2, /> Third\.\n> Before \(2026-10-20\): New users with no notes app before stall\.\n> Before \(2026-10-15\): Too many choices/);
  assert.equal(themeOf(re2).reading, 'Third.');
  assert.notEqual(themeSig(t), themeSig(t2));
  assert.equal(themeSig(themeOf(addScene(re, { text: 'One more.', name: 'N' }))), themeSig(t2), 'a case added: the check still holds');
});

test('a theme checked against what came since: the message and the verdicts', () => {
  const msg = themes.checkText({ theme: { title: 'Stall', reading: 'Too many choices.', scenes: [{ text: 'Did not know.', name: 'Interview' }], unfit: [{ text: 'Picked at once.', name: 'Call' }] }, found: [{ name: 'Demo', date: '2026-10-12', text: 'Stuck.' }], lang: 'ko' });
  assert.match(msg, /^The title: Stall\n\nThe reading now: Too many choices\.\n\nCases it came up in:\n- Did not know\. \(from "Interview"\)\n\nCases that did not fit so far:\n- Picked at once\. \(from "Call"\)\n\nNew paragraphs:\n\[1\] from "Demo" \(2026-10-12\): Stuck\./);
  assert.match(themes.CHECK_SYSTEM, /against the reading as it is now/);
  assert.deepEqual(themes.parseCheck('[1] supports: Stuck again [2].\n[2] counters: Picked at once.\n[3] outside: an expert\n[4] none: lunch\n[9] supports: x\nmaybe: Those new to notes apps stall.\ncheck: Ask which app they used before.', 4),
    { verdicts: [{ n: 1, verdict: 'supports', why: 'Stuck again.' }, { n: 2, verdict: 'counters', why: 'Picked at once.' }, { n: 3, verdict: 'outside', why: 'an expert' }, { n: 4, verdict: 'none', why: 'lunch' }], maybe: { reading: 'Those new to notes apps stall.', check: 'Ask which app they used before.' } });
  assert.equal(themes.parseCheck('1. supports: yes\nmaybe: narrower', 1).maybe, null, 'no hypothesis when nothing goes against it');
});

test('what would show a reading wrong: search words, at most two', () => {
  assert.match(themes.counterText({ title: 'Stall', reading: 'New users stall.', lang: 'ko' }), /^The title: Stall\n\nThe reading: New users stall\.\n\nAnswer in Korean/);
  assert.deepEqual(themes.parseCounter('1. A new user started writing at once.\n- "Two of three began without help."\n- A third line.\nok'), ['A new user started writing at once.', 'Two of three began without help.']);
  assert.match(themes.COUNTER_SYSTEM, /went otherwise/);
});
