// node --test (npm test): the margin understands (lib/embed.js, the local
// model; public/recall.js with its answers). Without the model: what the
// server says and does. With it (MARGIN_TEST_MODELS=<a folder holding
// multilingual-e5-small-int8/>): paragraphs in other words or another
// language meet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recallIndex, recall, asks, semanticNeed } from '../public/recall.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serve(t, files, env = {}) {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-embed-test-')));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(ws, f), text);
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js'), ws, '--port', String(20000 + Math.floor(Math.random() * 20000)), '--no-open'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill());
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !/\?t=\w+/.test(out); i++) await sleep(100);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=(\w+)/.exec(out);
  assert.ok(m, `the server started: ${out}`);
  return async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${m[1]}${p}`, { method, headers: { 'x-agent-notes-token': m[2], 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, ...(await r.json()) };
  };
}

test('without the model: missing until downloaded, and no answers (the words still work)', { skip: process.platform === 'win32' }, async (t) => {
  const models = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-models-'));
  t.after(() => fs.rmSync(models, { recursive: true, force: true }));
  const api = await serve(t, { 'a.md': 'One paragraph about sync on mobile phones.\n' }, { MARGIN_MODELS_DIR: models });
  const st = await api('GET', '/api/embed');
  assert.equal(st.state, 'missing');
  assert.equal(st.size, 149377663);
  assert.equal((await api('POST', '/api/embed', { on: true })).state, 'missing');
  assert.deepEqual((await api('POST', '/api/embed/near', { path: 'b.md', texts: ['sync'] })).results, null);
  assert.equal((await api('POST', '/api/embed/near', { path: 'b.md', texts: 'sync' })).status, 400);
  assert.equal((await api('POST', '/api/embed', { on: false })).state, 'missing');
  assert.equal((await api('POST', '/api/embed/remove')).state, 'missing');
});

test('the model’s answers: shown when well above chance for that many paragraphs; none yet, none shown', () => {
  assert.equal(semanticNeed(12), 3.5);
  assert.ok(Math.abs(semanticNeed(353) - 3.92) < 0.01);
  assert.ok(Math.abs(semanticNeed(15000) - 4.88) < 0.01);
  const ix = recallIndex([
    { path: 'onboarding.md', v: '1', created: 0, lines: [], project: ['growth'], text: 'New people leave the app on the first screen; the tutorial is too long.\n' },
    { path: 'sync.md', v: '1', created: 0, lines: [], text: 'Mobile sync is slow on large workspaces, index only what changed.\n' },
  ]);
  const [onb, sync] = ix.paras.paras;
  const here = '# Today\n\nPeople quit right after signing up, it seems.\n\nNothing about anything in particular here today.\n';
  const answers = new Map([
    ['People quit right after signing up, it seems.', { n: 12, list: [{ x: onb, s: 0.93, z: 4.6 }, { x: sync, s: 0.86, z: 1.1 }] }],
    ['Nothing about anything in particular here today.', { n: 12, list: [{ x: sync, s: 0.85, z: 0.9 }] }],
  ]);
  const semantic = (t) => answers.get(t) || null;
  const r = recall(ix, 'today.md', here, { semantic });
  assert.deepEqual(r.map((x) => [x.line, x.kind, x.refs.map((y) => y.path)]), [[2, 'related', ['onboarding.md']]]);
  // Not words in common: the words alone say nothing.
  assert.deepEqual(recall(ix, 'today.md', here), []);
  const q = asks(ix, 'today.md', here, { cursor: 5, semantic });
  assert.deepEqual(q.map((x) => [x.kind, x.line, x.b.path]), [['related', 2, 'onboarding.md']]);
  // Few paragraphs, all about much the same: as close as other words for one thing.
  const close = (s, z) => recall(ix, 'today.md', here, { semantic: (t) => (t.startsWith('People') ? { n: 22, list: [{ x: onb, s, z }] } : null) }).length;
  assert.equal(close(0.916, 1.8), 1);
  assert.equal(close(0.89, 1.8), 0);
  assert.equal(close(0.95, 1.2), 0, 'and still above the rest');
  // Not yet answered: nothing (not the words' guess, then the model's).
  assert.deepEqual(recall(ix, 'today.md', here, { semantic: () => null }), []);
});

const MODELS = process.env.MARGIN_TEST_MODELS;
test('with the model: in other words, in another language', { skip: !MODELS || process.platform === 'win32' ? 'MARGIN_TEST_MODELS not set' : false, timeout: 120000 }, async (t) => {
  const api = await serve(t, {
    'onboarding.md': '# Onboarding\n\nNew people leave the app on the first screen; the tutorial is too long and they quit.\n\nPricing is for next quarter.\n',
    'sync.md': '# Sync\n\n\uBAA8\uBC14\uC77C \uB3D9\uAE30\uD654\uAC00 \uD070 \uC6CC\uD06C\uC2A4\uD398\uC774\uC2A4\uC5D0\uC11C \uB290\uB9AC\uB2E4. \uBC14\uB010 \uD30C\uC77C\uB9CC \uC0C9\uC778\uD574\uC57C \uD55C\uB2E4.\n',
    'walk.md': '# Weekend\n\nA walk in the park in the sun, then a novel in the evening.\n',
  }, { MARGIN_MODELS_DIR: MODELS });
  await api('POST', '/api/embed', { on: true });
  let st;
  for (let i = 0; i < 200; i++) { st = await api('GET', '/api/embed'); if ((st.state === 'ready' && st.total) || st.error) break; await sleep(200); }
  assert.equal(st.state, 'ready', st.error);
  assert.equal(st.total, 3, 'a paragraph of three words is too short to compare');
  const r = await api('POST', '/api/embed/near', { path: 'today.md', texts: ['People quit right after they sign up.', 'Syncing on the phone takes forever with big folders.'] });
  assert.equal(r.n, 3);
  assert.equal(r.results[0][0].path, 'onboarding.md');
  assert.equal(r.results[1][0].path, 'sync.md');
  assert.equal(r.results[1][0].line, 2);
});
