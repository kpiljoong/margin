// node --test (npm test): beside a note (lib/beside.js, public/beside.js) —
// the paragraphs you locked (an agent's change to one is never applied), the
// drawer of scraps kept for a note, and where a note's paragraphs came from.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { lockAt, lockSpans, placeScrap, originMarks, originSources } from '../public/beside.js';

const { lockRanges, lockedHunks, drawerText, drawerScraps, addedLines } = createRequire(import.meta.url)('../lib/beside.js');
const { buildHunks } = createRequire(import.meta.url)('../lib/diff.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('lockRanges and lockedHunks: a change in a locked paragraph, or lines put in between its own, is locked', () => {
  const base = '# T\n\nOne line.\n\nLocked first\nlocked second\n\nLast.\n';
  const ranges = lockRanges(base, ['Locked first\nlocked second', 'not there']);
  assert.deepEqual(ranges.map((r) => [r.from, r.to]), [[4, 5], [-1, -1]]);
  const changed = buildHunks(base, '# T\n\nOne line!\n\nLocked first\nlocked 2nd\n\nLast.\n');
  assert.deepEqual(lockedHunks(changed, ranges), [1]);
  // Lines put in before or after it leave it as it is; in between, not.
  assert.deepEqual(lockedHunks(buildHunks(base, '# T\n\nOne line.\n\nNew.\nLocked first\nlocked second\nAfter.\n\nLast.\n'), ranges), []);
  assert.deepEqual(lockedHunks(buildHunks(base, '# T\n\nOne line.\n\nLocked first\nmiddle\nlocked second\n\nLast.\n'), ranges), [0]);
  // Taken out.
  assert.deepEqual(lockedHunks(buildHunks(base, '# T\n\nOne line.\n\nLast.\n'), ranges), [0]);
});

test('drawerText and drawerScraps: the drawer is Markdown, each scrap after a line saying where it came from', () => {
  const scraps = [
    { text: 'From a note\n\nwith two paragraphs', from: 'a/b.md', line: 3, at: '2026-10-05T10:00' },
    { text: '\u321c\ub2e8 typed in' },
  ];
  const text = drawerText(scraps);
  assert.match(text, /^<!-- scrap from="a\/b\.md" line="3" at="2026-10-05T10:00" -->\nFrom a note\n\nwith two paragraphs\n/);
  assert.deepEqual(drawerScraps(text), [
    { text: 'From a note\n\nwith two paragraphs', from: 'a/b.md', line: 3, at: '2026-10-05T10:00' },
    { text: '\u321c\ub2e8 typed in', from: undefined, line: undefined, at: undefined },
  ]);
  // Words before the first scrap line are a scrap too; empty ones go.
  assert.deepEqual(drawerScraps('loose words\n<!-- scrap -->\n\n').map((s) => s.text), ['loose words']);
  assert.deepEqual(drawerScraps(''), []);
});

test('addedLines: the lines a run put in, of the changes applied', () => {
  const hunks = buildHunks('a\nb\nc\n', 'a\nB\nc\nd\n');
  assert.deepEqual(addedLines(hunks, [0]), ['B']);
  assert.deepEqual(addedLines(hunks, [0, 1]), ['B', 'd']);
  assert.deepEqual(addedLines(hunks, [7]), []);
});

test('lockAt and lockSpans: the paragraph at the cursor, or the selection; a locked one is found as locked', () => {
  const text = '# T\n\nFirst para\ngoes on.\n\nSecond.\n';
  assert.deepEqual(lockAt(text, 8, 8, []), { quote: 'First para\ngoes on.', on: false });
  assert.deepEqual(lockAt(text, 6, 10, []), { quote: 'irst', on: false });
  assert.deepEqual(lockAt(text, 12, 12, ['First para\ngoes on.']), { quote: 'First para\ngoes on.', on: true });
  assert.deepEqual(lockAt(text, 4, 4, []).quote, '');
  assert.deepEqual(lockSpans(text, ['Second.', 'gone']), [[26, 33]]);
});

test('placeScrap: a scrap is a paragraph of its own after the line the cursor is on', () => {
  const text = 'One.\n\nTwo.\n';
  const p = placeScrap(text, 2, ' Scrap \n');
  assert.equal(p.text, 'One.\n\nScrap\n\nTwo.\n');
  assert.equal(p.text.slice(p.at, p.at + 5), 'Scrap');
  assert.equal(placeScrap(text, text.length, 'End').text, 'One.\n\nTwo.\n\nEnd\n');
  assert.equal(placeScrap('', 0, 'Only').text, 'Only\n');
});

test('originMarks: each paragraph and where it came from — a run, a note, the drawer, notes it went into, a lock', () => {
  const text = '# Plan\n\nWritten by the agent.\nAnd this too.\n\nMine, with one agent line.\nAgent line.\nMy line.\n\nFrom the other note.\n\nThe drawer scrap here.\n\nLocked one.\n';
  const origin = {
    runs: [
      { id: 'r1', task: 'old', lines: ['Written by the agent.'] },
      { id: 'r2', task: 'Tidy', lines: ['Written by the agent.', 'And this too.', 'Agent line.'] },
    ],
    gathered: [{ from: 'b.md', text: 'From the other note.' }],
    drawer: [{ from: 'c.md', text: 'Before. The drawer scrap here. After.' }],
    usedIn: [{ into: 'g.md', text: 'Mine, with one agent line.\nAgent line.\nMy line.' }],
    locks: ['Locked one.'],
  };
  const blocks = originMarks(text, origin);
  const marks = blocks.map((b) => b.marks.map((m) => `${m.key}${m.all ? '!' : ''}`));
  assert.deepEqual(marks, [[], ['agent:r2!'], ['used:g.md'], ['from:b.md'], ['drawer:c.md'], ['locked']]);
  assert.deepEqual(originSources(blocks).map((s) => [s.key, s.n]), [['agent:r2', 1], ['from:b.md', 1], ['drawer:c.md', 1], ['used:g.md', 1], ['locked', 1]]);
});

test('the server: a locked paragraph is left out of applying, its note is not deleted, the agent is told; the drawer and origin are kept beside', async (t) => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-beside-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const note = '# Plan\n\nThis is a very good plan.\n\nWe want a very dark theme.\n';
  fs.writeFileSync(path.join(ws, 'a.md'), note);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(port), '--no-open', '--agent', 'demo'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  const finish = async (run) => {
    for (let i = 0; i < 100 && run.status === 'running'; i++) { await sleep(100); run = await api('GET', `/api/runs/${run.id}`); }
    return run;
  };

  assert.deepEqual((await api('PUT', '/api/locks', { path: 'a.md', locks: ['We want a very dark theme.', 'We want a very dark theme.', ' '] })).locks, ['We want a very dark theme.']);
  assert.deepEqual((await api('GET', '/api/locks?path=a.md')).locks, ['We want a very dark theme.']);
  await api('PUT', '/api/drawer', { path: 'a.md', scraps: [{ text: 'Ten testers liked it.', from: 'b.md', line: 2, at: '2026-10-05T10:00' }, { text: ' ' }] });
  assert.match(fs.readFileSync(path.join(ws, '.agent-notes', 'drawer', 'a.md.md'), 'utf8'), /^<!-- scrap from="b\.md" line="2" at="2026-10-05T10:00" -->\nTen testers liked it\.\n/);
  assert.deepEqual((await api('GET', '/api/drawer?path=a.md')).scraps.map((s) => s.text), ['Ten testers liked it.']);

  const run = await finish(await api('POST', '/api/runs', { task: 'Red pen: write your marks to .agent-notes/comments.json', scope: 'file', focus: 'a.md' }));
  assert.equal(run.status, 'review');
  const c = run.changes[0];
  assert.equal(c.hunks.length, 2);
  assert.deepEqual(c.locked, [1]);
  assert.ok(c.conflicts.includes(1));
  assert.equal(c.problems[1], 'in a paragraph you locked');
  const prompt = fs.readFileSync(path.join(ws, '.agent-notes', 'runs', run.id, 'prompt-1.txt'), 'utf8');
  assert.match(prompt, /The user locked these paragraphs[^]*We want a very dark theme\./);
  assert.match(prompt, /The user's drawer for a\.md[^]*\(from b\.md\)\nTen testers liked it\./);

  // Both asked for: only the one not locked is applied.
  await api('POST', `/api/runs/${run.id}/apply`, { decisions: { 'a.md': { hunks: [0, 1] } } });
  const now = fs.readFileSync(path.join(ws, 'a.md'), 'utf8');
  assert.equal(now, '# Plan\n\nThis is a good plan.\n\nWe want a very dark theme.\n');

  // Where its paragraphs came from: the line the run put in, and the lock.
  const origin = await api('GET', '/api/origin?path=a.md');
  assert.deepEqual(origin.runs.map((r) => [r.id, r.lines]), [[run.id, ['This is a good plan.']]]);
  assert.deepEqual(origin.locks, ['We want a very dark theme.']);
  assert.deepEqual(origin.drawer.map((s) => s.from), ['b.md']);

  // A note made of pieces: where they came from, both ways.
  await api('POST', '/api/file', { path: 'g.md', content: 'This is a good plan.\n', gathered: [{ from: 'a.md', line: 2, text: 'This is a good plan.' }] });
  assert.deepEqual((await api('GET', '/api/origin?path=g.md')).gathered.map((p) => [p.from, p.text]), [['a.md', 'This is a good plan.']]);
  assert.deepEqual((await api('GET', '/api/origin?path=a.md')).usedIn.map((u) => [u.into, u.text]), [['g.md', 'This is a good plan.']]);

  // Renamed, what is beside it goes along.
  await api('POST', '/api/rename', { from: 'a.md', to: 'b/c.md' });
  assert.deepEqual((await api('GET', '/api/locks?path=b/c.md')).locks, ['We want a very dark theme.']);
  assert.deepEqual((await api('GET', '/api/drawer?path=b/c.md')).scraps.length, 1);
  assert.deepEqual((await api('GET', '/api/locks?path=a.md')).locks, []);

  // Unlocked: no file left.
  await api('PUT', '/api/locks', { path: 'b/c.md', locks: [] });
  assert.ok(!fs.existsSync(path.join(ws, '.agent-notes', 'locks', 'b', 'c.md.json')));
});
