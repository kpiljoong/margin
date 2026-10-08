// node --test (npm test): the margin remembers (public/recall.js, server.js
// recallLines) — beside a line, what the other notes already say about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { wordsOf, nearness, recallIndex, recall, recallText, knownOf, knownLine, asks, askText, withDue, withProject, withLink, parasOf, paraIndex, nearParas, excerptOf, mustLine } from '../public/recall.js';

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

test('a note\u2019s paragraphs: between blank lines and headings, a list\u2019s items each', () => {
  const text = '---\ntitle: x\n---\n# H\nOne line\nand the next\n\n- [ ] item one\n  more of it\n- item two\n```\ncode here\n```\n> quoted words\n';
  assert.deepEqual(parasOf(text).map((p) => [p.line, p.last, p.text]), [[4, 5, 'One line and the next'], [7, 8, 'item one more of it'], [9, 9, 'item two'], [13, 13, 'quoted words']]);
  assert.equal(excerptOf('one two three four', 12), 'one two\u2026');
  assert.equal(excerptOf('short'), 'short');
});

test('paragraphs about the same, in other words (Hangul by its pieces too)', () => {
  const pi = paraIndex([
    { path: 'a.md', v: '1', text: '# A\n\nMobile sync is slow on large workspaces; we should index incrementally.\n\nThe pricing page needs a clearer free tier.\n' },
    { path: 'b.md', v: '1', text: '\uC2E0\uADDC \uAC00\uC785\uC790\uAC00 \uCCAB \uD654\uBA74\uC5D0\uC11C \uB108\uBB34 \uB9CE\uC774 \uC774\uD0C8\uD55C\uB2E4. \uD29C\uD1A0\uB9AC\uC5BC\uC744 \uC904\uC774\uC790\uB294 \uC758\uACAC\uC774 \uB9CE\uC558\uB2E4.\n' },
    { path: 'c.md', v: '1', text: 'We walked in the park today and read a novel in the evening.\n' },
  ]);
  const near = (t) => nearParas(pi, 'x.md', t).map((r) => r.x.path);
  assert.deepEqual(near('Sync on mobile is too slow for big workspaces.'), ['a.md']);
  assert.deepEqual(near('\uCCAB \uD654\uBA74 \uC774\uD0C8\uC774 \uC2EC\uD558\uB2C8 \uD29C\uD1A0\uB9AC\uC5BC\uC744 \uC9E7\uAC8C \uC904\uC774\uB294 \uAC8C \uC88B\uACA0\uB2E4.'), ['b.md']);
  assert.deepEqual(near('A new colour palette for the design system tokens.'), []);
  assert.deepEqual(nearParas(pi, 'a.md', 'Sync on mobile is too slow for big workspaces.'), [], 'not its own note');
  // A note read again only when it changed.
  const again = paraIndex([{ path: 'a.md', v: '1', text: 'changed but the same version' }], pi);
  assert.equal(again.paras[0], pi.paras[0]);
});

test('beside a paragraph, the related ones; asked once whether it is, linked when so', () => {
  const ix = recallIndex([
    { path: 'n/Sync plan.md', v: '1', created: 0, project: ['speed'], lines: [], text: '# Sync\n\nMobile sync is slow on large workspaces; we should index incrementally.\n' },
    { path: 'n/Pricing.md', v: '1', created: 0, project: ['speed'], lines: [], text: 'The pricing page needs a clearer free tier for small teams.\n' },
  ]);
  const here = '# Notes\n\nCustomers say sync on mobile is too slow for big workspaces.\n\nNothing else to say here at all today.\n\nThe free tier on the pricing page confuses small teams.\n';
  const r = recall(ix, 'today.md', here);
  assert.deepEqual(r.map((x) => [x.line, x.kind, x.refs[0].name]), [[2, 'related', 'Sync plan'], [6, 'related', 'Pricing']]);
  assert.deepEqual(recallText(r[0]), { chip: 'Related', says: 'Mobile sync is slow on large workspaces; we should index incrementally.' });
  const q = asks(ix, 'today.md', here, { cursor: 0, projects: true });
  assert.deepEqual(q.map((x) => [x.kind, x.line]), [['project', 0], ['related', 2], ['related', 6]]);
  assert.equal(askText(q[1]), 'About the same as \u201CMobile sync is slow on large workspaces; we should index incrementally.\u201D (Sync plan)?');
  assert.deepEqual(q[0].pick, [{ name: 'speed', notes: 2 }]);
  // Not while it is being written; not once linked; not once told it is not related.
  assert.deepEqual(asks(ix, 'today.md', here, { cursor: 2 }).map((x) => x.line), [6]);
  const linked = here.replace('big workspaces.', withLink('big workspaces.', 'Sync plan'));
  assert.match(linked, /big workspaces\. \[\[Sync plan\]\]/);
  assert.deepEqual(asks(ix, 'today.md', linked, { cursor: 0 }).map((x) => x.line), [6]);
  const known = knownOf(knownLine('unrelated', q[1].a, q[1].b));
  assert.deepEqual(asks(ix, 'today.md', here, { cursor: 0, known }).map((x) => x.line), [6]);
  assert.deepEqual(recall(ix, 'today.md', here, { known }).map((x) => x.line), [6]);
});

test('a line that must be done, by no day: by when?', () => {
  assert.ok(mustLine('We need to fix the refund flow first.'));
  assert.ok(mustLine('\uD658\uBD88 \uB85C\uC9C1\uC744 \uBA3C\uC800 \uACE0\uCCD0\uC57C \uD55C\uB2E4.'));
  assert.ok(!mustLine('\uD658\uBD88 \uB85C\uC9C1\uC744 \uAE08\uC694\uC77C\uAE4C\uC9C0 \uACE0\uCCD0\uC57C \uD55C\uB2E4.'));
  assert.ok(!mustLine('We need to fix it by Friday.'));
  assert.ok(!mustLine('\uBB58 \uD574\uC57C \uD560\uC9C0 \uBAA8\uB974\uACA0\uB2E4.'), 'not knowing what to do is not a to-do');
  assert.ok(mustLine('\uB0B4\uAC00 \uD574\uC57C \uD560 \uC77C\uC774\uB2E4.'));
  assert.ok(!mustLine('We need to fix it before 10/20.'));
  assert.ok(!mustLine('## We need to'));
  const ix = recallIndex([{ path: 'o.md', v: '1', created: 0, lines: [], text: 'Some other note entirely, with nothing alike in it whatsoever.\n' }]);
  const text = 'Talked with Bo.\nWe need to fix the refund flow first.\n- [ ] We need to ship\n';
  const q = asks(ix, 'n.md', text, { cursor: 0 });
  assert.deepEqual(q.map((x) => [x.kind, x.line, !!x.prose]), [['due', 1, true]]);
  assert.equal(askText(q[0]), 'To be done by when?');
  assert.deepEqual(asks(ix, 'n.md', text, { cursor: 1 }), []);
  assert.deepEqual(asks(ix, 'n.md', text, { cursor: 0, known: knownOf(knownLine('nodate', q[0].a)) }), []);
});

test('the server: every note’s item lines, with its first words', { skip: process.platform === 'win32' }, async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-recall-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  fs.writeFileSync(path.join(ws, 'a.md'), '# A 2026-09-03\n\n- [ ] One\ntext\n- Go #decision\n```\n- [ ] not this\n```\n> [!question] Why?\n');
  fs.writeFileSync(path.join(ws, 'b.md'), '# B\nnothing\n');
  fs.utimesSync(path.join(ws, 'b.md'), new Date(2026, 0, 1), new Date(2026, 0, 1));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  const r = await (await fetch(`http://127.0.0.1:${m[1]}/api/recall`, { headers: { 'x-agent-notes-token': m[2] } })).json();
  // Every note, the newest first, with its text.
  assert.deepEqual(r.notes.map((n) => [n.path, n.lines]), [['a.md', [[2, '- [ ] One'], [4, '- Go #decision'], [8, '> [!question] Why?']]], ['b.md', []]]);
  assert.match(r.notes[0].text, /^# A 2026-09-03/);
  assert.equal(r.notes[1].text, '# B\nnothing\n');
  // Asked with what it has: nothing again, while nothing changed.
  const get = async (q = '') => (await fetch(`http://127.0.0.1:${m[1]}/api/recall${q}`, { headers: { 'x-agent-notes-token': m[2] } })).json();
  assert.deepEqual(await get(`?sig=${r.sig}`), { sig: r.sig, same: true });
  assert.deepEqual(recallIndex(r.notes).items.map((x) => [x.kind, x.date]), [['todo', '2026-09-03'], ['decision', '2026-09-03'], ['question', '2026-09-03']]);
  assert.equal(r.known, '');
  // An answer: a line in KNOWN.md (made the first time), read back with the rest.
  const tell = async (line) => (await fetch(`http://127.0.0.1:${m[1]}/api/recall/known`, { method: 'POST', headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: JSON.stringify({ line }) })).json();
  await tell('- No date: "One" (a)');
  await tell('- Not related: "a" (a) and "b" (b)');
  assert.match(fs.readFileSync(path.join(ws, 'KNOWN.md'), 'utf8'), /^# Known\n\n.*\n\n- No date: "One" \(a\)\n- Not related: "a" \(a\) and "b" \(b\)\n$/);
  const again = await get(`?sig=${r.sig}`);
  assert.notEqual(again.sig, r.sig);
  assert.equal(knownOf(again.known).noDate.size, 1);
  assert.deepEqual(again.notes.map((n) => n.path), ['a.md', 'b.md']);
  assert.match((await tell('two\nlines')).error, /one list item/);
});
