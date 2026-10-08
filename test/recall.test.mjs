// node --test (npm test): the margin remembers (public/recall.js, server.js
// recallLines) — beside a line, what the other notes already say about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wordsOf, nearness, recallIndex, recall, recallText, knownOf, knownLine, asks, askText, withDue, withProject } from '../public/recall.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A note as the server gives it: its item lines.
const note = (p, text, project = []) => ({ path: p, head: text.slice(0, 1500), created: 0, project, lines: text.split('\n').map((l, i) => [i, l]).filter(([, l]) => /\[[ xX]\]|#(decision|question)/.test(l)) });

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

test('what you told it: KNOWN.md lines, read back', () => {
  const a = { text: 'Draft the "release" notes', name: 'W 2026-09-03' };
  const b = { text: '\uB9B4\uB9AC\uC988 \uB178\uD2B8 \uCD08\uC548 \uC791\uC131', name: '1:1 (Ann)' };
  assert.equal(knownLine('same', a, b), `- Same to-do: "Draft the 'release' notes" (W 2026-09-03) = "\uB9B4\uB9AC\uC988 \uB178\uD2B8 \uCD08\uC548 \uC791\uC131" (1:1 Ann)`);
  assert.equal(knownLine('nodate', a), `- No date: "Draft the 'release' notes" (W 2026-09-03)`);
  assert.equal(knownLine('nope', a, b), null);
  const k = knownOf(['# Known', '', knownLine('same', a, b), knownLine('replaces', { text: 'Ship on 11/3', name: 'n' }, { text: 'Ship on 10/20', name: 'o' }),
    knownLine('unrelated', a, b), knownLine('nodate', b), '- something else: "x" "y"'].join('\n'));
  assert.equal(k.same.size, 1);
  assert.equal(k.unrelated.size, 1);
  assert.equal(k.replaces.get('ship on 10 20'), 'ship on 11 3');
  assert.ok(k.noDate.has('\uB9B4\uB9AC\uC988 \uB178\uD2B8 \uCD08\uC548 \uC791\uC131'));
});

test('the questions: same to-do, replaces, by when, the project; answers change what it remembers', () => {
  const ix = recallIndex([
    note('m/W 2026-09-03.md', '# W\n- [ ] \uB9B4\uB9AC\uC2A4 \uB178\uD2B8 \uCD08\uC548 @ann\n- \uCD9C\uC2DC\uB294 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4 #decision\n', ['launch']),
    note('m/W 2026-09-17.md', '# W\n- \uCD9C\uC2DC\uB294 11\uC6D4 3\uC77C\uB85C \uBBF8\uB8EC\uB2E4 #decision\n', ['launch']),
  ]);
  const here = '# 1:1\n- [ ] \uB9B4\uB9AC\uC988 \uB178\uD2B8 \uCD08\uC548 \uC791\uC131 @ann\n- \uCD9C\uC2DC \uC77C\uC815\uC740 10\uC6D4 20\uC77C\uB85C \uAC04\uB2E4 #decision\n- [ ] \uAC00\uACA9\uD45C \uC5C5\uB370\uC774\uD2B8 @cy\n- [ ] \uC0C8 \uC77C\n';
  const q = asks(ix, 'one.md', here, { cursor: 4, projects: true });
  assert.deepEqual(q.map((x) => [x.line, x.kind]), [[3, 'due'], [2, 'replaces'], [1, 'same'], [0, 'project']]);
  assert.equal(askText(q[1]), '“Does this replace “\uCD9C\uC2DC\uB294 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4” (W 2026-09-03, 09-03)?'.slice(1));
  assert.deepEqual(q[3].pick, [{ name: 'launch', notes: 1 }]);
  // Never the line being written.
  assert.ok(!asks(ix, 'one.md', here, { cursor: 3 }).some((x) => x.line === 3));
  // Answered: not asked again, and remembered with it.
  const known = knownOf([
    knownLine('same', q[2].a, q[2].b),
    knownLine('nodate', q[0].a),
    knownLine('holds', q[1].a, q[1].b),
    '---',
  ].join('\n'));
  // (that to-do's date is next.)
  assert.deepEqual(asks(ix, 'one.md', here, { cursor: 4, known }).map((x) => [x.line, x.kind]), [[1, 'due']]);
  const r = recall(ix, 'one.md', here, { known });
  assert.equal(r.find((x) => x.line === 1).kind, 'open');
  // "Replaces": that card says so; a line near the old one meets the new one.
  const replaced = knownOf(knownLine('replaces', { text: '\uCD9C\uC2DC\uB294 11\uC6D4 3\uC77C\uB85C \uBBF8\uB8EC\uB2E4', name: 'W' }, { text: '\uCD9C\uC2DC\uB294 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4', name: 'W' }));
  const later = recall(ix, 'x.md', '- \uCD9C\uC2DC \uB0A0\uC9DC\uB294 10\uC6D4 20\uC77C\uC778\uAC00? #question', { known: replaced })[0];
  assert.equal(later.kind, 'decided');
  assert.equal(later.refs[0].text, '\uCD9C\uC2DC\uB294 11\uC6D4 3\uC77C\uB85C \uBBF8\uB8EC\uB2E4');
  assert.match(recallText(later).says, /it replaced/);
  const mineReplaces = recall(ix, 'x.md', '- \uCD9C\uC2DC \uC77C\uC815\uC740 10\uC6D4 20\uC77C\uB85C \uAC04\uB2E4 #decision', { known: knownOf(knownLine('replaces', { text: '\uCD9C\uC2DC \uC77C\uC815\uC740 10\uC6D4 20\uC77C\uB85C \uAC04\uB2E4', name: 'x' }, { text: '\uCD9C\uC2DC\uB294 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4', name: 'W' })) })[0];
  assert.equal(mineReplaces.kind, 'replaces');
  // "Not related": not near any more.
  const unrelated = knownOf(knownLine('unrelated', { text: '\uCD9C\uC2DC \uC77C\uC815\uC740 10\uC6D4 20\uC77C\uB85C \uAC04\uB2E4' }, { text: '\uCD9C\uC2DC\uB294 10\uC6D4 20\uC77C\uB85C \uD55C\uB2E4' }));
  assert.equal(recall(ix, 'x.md', '- \uCD9C\uC2DC \uC77C\uC815\uC740 10\uC6D4 20\uC77C\uB85C \uAC04\uB2E4 #decision', { known: unrelated }).length, 0);
});

test('an answer written in: the date on the to-do, the project in the front matter', () => {
  assert.equal(withDue('- [ ] Fix login @bo  ', '2026-10-16'), '- [ ] Fix login @bo \u{1F4C5} 2026-10-16');
  assert.equal(withProject('# A\n', 'launch'), '---\nproject: launch\n---\n# A\n');
  assert.equal(withProject('---\ntitle: A\n---\n# A\n', 'launch'), '---\ntitle: A\nproject: launch\n---\n# A\n');
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
  assert.equal(r.known, '');
  // An answer: a line in KNOWN.md (made the first time), read back with the rest.
  const tell = async (line) => (await fetch(`http://127.0.0.1:${m[1]}/api/recall/known`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify({ line }) })).json();
  await tell('- No date: "One" (a)');
  await tell('- Not related: "a" (a) and "b" (b)');
  assert.match(fs.readFileSync(path.join(ws, 'KNOWN.md'), 'utf8'), /^# Known\n\n.*\n\n- No date: "One" \(a\)\n- Not related: "a" \(a\) and "b" \(b\)\n$/);
  const again = await (await fetch(`http://127.0.0.1:${m[1]}/api/recall`, { headers: { 'x-agent-notes-token': m[2] } })).json();
  assert.equal(knownOf(again.known).noDate.size, 1);
  assert.deepEqual(again.notes.map((n) => n.path), ['a.md']);
  assert.match((await tell('two\nlines')).error, /one list item/);
});
