// node --test (npm test): the margin remembers (public/recall.js, server.js
// recallLines) — beside a line, what the other notes already say about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wordsOf, nearness, recallIndex, recall, recallText } from '../public/recall.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A note as the server gives it: its item lines.
const note = (p, text) => ({ path: p, head: text.slice(0, 1500), created: 0, lines: text.split('\n').map((l, i) => [i, l]).filter(([, l]) => /\[[ xX]\]|#(decision|question)/.test(l)) });

test('the words a line is about: no tags, owners, particles or small words', () => {
  assert.deepEqual([...wordsOf('We ship the beta on Friday @ann #decision')], ['ship', 'beta', 'friday']);
  assert.deepEqual([...wordsOf('\uBCA0\uD0C0\uB294 \uAE08\uC694\uC77C\uC5D0 \uCD9C\uC2DC')], ['\uBCA0\uD0C0', '\uAE08\uC694\uC77C', '\uCD9C\uC2DC']);
  assert.ok(nearness(wordsOf('ship the beta friday'), wordsOf('We ship the beta on Friday')) > 0);
  assert.equal(nearness(wordsOf('beta testers wanted'), wordsOf('We ship the beta on Friday')), 0);
});

test('a to-do open, ticked or still open elsewhere; a question asked or decided; a decision before', () => {
  const ix = recallIndex([
    note('m/W 2026-09-03.md', '# W\n- [ ] Draft the release notes @ann\n- [x] Fix login\n- Do we need a beta? #question\n- No beta: ship to everyone on Friday #decision\n'),
    note('m/W 2026-09-10.md', '# W\n- [ ] Draft the release notes.\n- [ ] Book the room\n- Who owns the docs? #question\n'),
  ]);
  const here = [
    '# Today',
    '- [ ] Draft the release notes @bo',
    '- [ ] Fix login',
    '- [x] Book the room',
    '- Do we ship the beta to everyone? #question',
    '- Who owns the docs? #question',
    '- Ship a beta to ten customers first #decision',
    'About the beta: we ship it to everyone friday, said Ann.',
    '- [ ] Something new',
  ].join('\n');
  const r = recall(ix, 'today.md', here);
  const at = Object.fromEntries(r.map((x) => [x.line, x]));
  assert.equal(at[1].kind, 'open');
  assert.deepEqual(at[1].refs.map((x) => x.path), ['m/W 2026-09-10.md', 'm/W 2026-09-03.md']);
  assert.equal(at[2].kind, 'done');
  assert.equal(at[3].kind, 'still');
  assert.equal(at[4].kind, 'decided');
  assert.match(at[4].refs[0].text, /No beta/);
  assert.equal(at[5].kind, 'asked');
  assert.equal(at[6].kind, 'before');
  assert.equal(at[7].kind, 'decided');
  assert.equal(at[8], undefined);
  assert.equal(at[0], undefined);
  assert.deepEqual(recallText(at[1]), { chip: 'Open elsewhere', says: 'The same to-do is open in 2 other notes.' });
  assert.equal(recallText(at[2]).says, 'Ticked in W 2026-09-03.');
  assert.deepEqual(at[2].refs.map((x) => x.done), [true]);
  // The same words decided: said so, not the words again.
  const same = recall(recallIndex([note('a.md', '- Beta? #decision')]), 'b.md', '- Beta? #question')[0];
  assert.deepEqual(recallText(same), { chip: 'Decided', says: 'Marked decided in a.' });
  // Its own lines are not remembered back to it; a cache gives the same.
  assert.deepEqual(recall(ix, 'm/W 2026-09-03.md', '- [ ] Fix login').map((x) => x.kind), []);
  const cache = new Map();
  assert.deepEqual(recall(ix, 'today.md', here, { cache }), r);
  assert.deepEqual(recall(ix, 'today.md', here, { cache }), r);
  // A decision answering a question open elsewhere.
  assert.equal(recall(ix, 'x.md', '- Who owns the docs? #decision')[0].kind, 'answers');
  // In a code block, or the front matter: nothing.
  assert.deepEqual(recall(ix, 'x.md', '---\ntitle: - [ ] Fix login\n---\n```\n- [ ] Fix login\n```'), []);
});

test('the server: every note’s item lines, with its first words', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-recall-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ws, 'a.md'), '# A 2026-09-03\n\n- [ ] One\ntext\n- Go #decision\n```\n- [ ] not this\n```\n> [!question] Why?\n');
  fs.writeFileSync(path.join(ws, 'b.md'), '# B\nnothing\n');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const r = await (await fetch(`http://127.0.0.1:${m[1]}/api/recall`, { headers: { 'x-agent-notes-token': m[2] } })).json();
  assert.deepEqual(r.notes.map((n) => [n.path, n.lines]), [['a.md', [[2, '- [ ] One'], [4, '- Go #decision'], [8, '> [!question] Why?']]]]);
  assert.match(r.notes[0].head, /^# A 2026-09-03/);
  assert.deepEqual(recallIndex(r.notes).items.map((x) => [x.kind, x.date]), [['todo', '2026-09-03'], ['decision', '2026-09-03'], ['question', '2026-09-03']]);
});
