// A quick run through the app, in Electron, to catch what unit tests and
// lint cannot: the page loads, a note opens, the canvas draws a flow, links
// and presenting work, and a review's changes can be picked and applied.
//
//   npm run smoke            (or: node scripts/smoke.mjs --keep to leave it open)
//
// It uses its own settings folder and a throwaway workspace, and never
// touches your own app, settings or notes. Any uncaught error in the page
// fails the run.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9400 + Math.floor(Math.random() * 400);
const keep = process.argv.includes('--keep');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-smoke-'));
const userData = path.join(tmp, 'user-data');
const ws = path.join(tmp, 'notes');
fs.mkdirSync(userData);
fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });

fs.writeFileSync(path.join(ws, 'flow.md'), [
  '# Deploy', '', 'Waiting for approval takes too long.', '', '## Now', '',
  '```flow', 'PR -> Review -> Waiting for approval !', 'Waiting for approval -> Pass?', '  yes -(auto)-> Deploy', '  no -> Changes -> Review', '```', '',
  '## Proposal', '', '```flow', 'PR -> Review -> Deploy', '```', '',
].join('\n'));
const filler = (p) => Array.from({ length: 10 }, (_, i) => `${p} ${i}`);
fs.writeFileSync(path.join(ws, 'sub', 'messy.md'), ['#Title', 'text', ...filler('a'), '* one', ...filler('b'), '##Sub', 'more', ...filler('c'), '+ two', ''].join('\n'));
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  workspace: ws, recent: [ws], agents: [{ name: 'Demo', command: 'demo' }], agentDefault: 'Demo', autoUpdateCheck: false, quickCapture: false,
}));

const electron = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const app = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`], {
  env: { ...process.env, AGENT_NOTES_USER_DATA: userData }, stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let failed = false;
const done = async (code) => {
  if (!keep) {
    // Wait for the app to go, or it writes its settings folder again after.
    const gone = new Promise((r) => { app.once('exit', r); setTimeout(r, 5000); });
    app.kill();
    await gone;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(code);
};

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`The app did not open a page.\n${appLog}`);
}

const page = await connect().catch((e) => { console.error(e.message); done(1); });
const sock = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
sock.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
await new Promise((r) => { sock.onopen = r; });
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); sock.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable');

// Runs `body` (an async function's source) in the page; returns its value.
async function inPage(body) {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${HELPERS}\n${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { const v = f(); if (v) return v; await sleep(100); } return null; };
  const button = (text, root = document) => $$('button', root).find((b) => b.textContent.trim().startsWith(text));
  const key = (k, opts = {}, target = document.activeElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const openNote = async (p) => {
    // Open the folders on the way (a folder row's title is its path).
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!$$('#sidebar .tree-row').some((r) => r.dataset.path?.startsWith(dir + '/'))) (await until(() => $$('#sidebar .tree-row').find((r) => r.title === dir)))?.click();
    }
    (await until(() => $$('#sidebar .tree-row').find((r) => r.dataset.path === p))).click();
    const name = p.split('/').pop();
    await until(() => $('.tab.active')?.textContent.includes(name));
    return until(() => $$('.editor-wrap textarea').find((t) => t.offsetParent));
  };
`;

async function check(name, body, expect) {
  const before = errors.length;
  let value;
  let problem = null;
  try {
    value = await inPage(body);
    const bad = expect(value);
    if (bad) problem = bad;
  } catch (e) { problem = e.message; }
  if (!problem && errors.length > before) problem = `page error: ${errors.slice(before).join(' | ')}`;
  results.push({ name, ok: !problem });
  console.log(`${problem ? '✗' : '✓'} ${name}${problem ? `\n    ${String(problem).split('\n').join('\n    ')}\n    got: ${JSON.stringify(value)}` : ''}`);
  if (problem) failed = true;
}

await check('the app loads the workspace', `
  return (await until(() => $$('#sidebar .tree-row').length)) || 0;
`, (n) => (n >= 2 ? null : 'no rows in the file tree'));

await check('a note opens in the editor', `
  const ta = await openNote('flow.md');
  return ta?.value.includes('\`\`\`flow') || false;
`, (ok) => (ok ? null : 'flow.md did not open'));

await check('the canvas draws both flows', `
  button('Canvas').click();
  await until(() => $$('.canvas-card').length === 2 && $$('.node-hit').length >= 8, 15000);
  return { cards: $$('.canvas-card').length, boxes: $$('.node-hit').length };
`, (v) => (v.cards === 2 && v.boxes >= 8 ? null : 'expected 2 pictures and their boxes'));

await check('Links toggles', `
  const b = button('Links');
  const a = b.classList.contains('on');
  b.click(); await sleep(200);
  const c = b.classList.contains('on');
  b.click(); await sleep(200);
  return a !== c && b.classList.contains('on') === a;
`, (ok) => (ok ? null : 'the Links button did not toggle'));

await check('presenting steps through the flow and ends', `
  const stage = $('.canvas-stage');
  stage.focus();
  key('Home', {}, stage);
  key('p', {}, stage); await sleep(400);
  key('Home', {}, stage); await sleep(300);
  const first = $('.cap-head')?.textContent;
  key(' ', {}, stage); await sleep(300);
  const second = $('.cap-head')?.textContent;
  const presenting = $('.canvas-pane').classList.contains('presenting');
  key('Escape', {}, stage); await sleep(300);
  return { first, second, presenting, after: $('.canvas-pane').classList.contains('presenting') };
`, (v) => (v.presenting && /1 \//.test(v.first || '') && /2 \//.test(v.second || '') && !v.after ? null : 'presenting did not start, step or end'));

await check('the whole canvas saves as one image', `
  button('⤓').click(); await sleep(200);
  $$('.ctx-item').find((b) => b.textContent.startsWith('Save as PNG')).click();
  const t = await until(() => !$('#toast').hidden && /Saved .*flow-canvas/.test($('#toast').textContent) && $('#toast'), 8000);
  return t?.textContent || null;
`, (v) => (v ? null : 'no saved image'));

await check('Settings shows Labs', `
  document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const d = await until(() => $('.dialog.settings'));
  const text = d?.textContent || '';
  button('Done', d)?.click();
  return /Labs/.test(text) && /Steady live drawing/.test(text);
`, (ok) => (ok ? null : 'no Labs section in Settings'));

await check('a shortcut can be changed, and used', `
  const mac = navigator.platform.startsWith('Mac');
  const press = (code, m = {}, t = document.body) => t.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, ...m }));
  await sleep(200); // the same command twice within 150 ms runs once
  press('Comma');
  const d = await until(() => $('.dialog.settings'));
  const row = () => $$('.key-row', d).find((r) => r.querySelector('.key-name').textContent === 'Command palette');
  button('Change', row()).click(); await sleep(100);
  press('KeyY', { altKey: true }); await sleep(300);
  const shown = row().querySelector('kbd')?.textContent;
  button('Done', d).click(); await sleep(100);
  press('KeyP', { shiftKey: true }); await sleep(200);
  const oldKeys = !$('#overlay').hidden;
  press('KeyY', { altKey: true });
  const opened = !!(await until(() => !$('#overlay').hidden && $('#overlay input')?.value === '>', 2000));
  $('#overlay').hidden = true; $('#overlay').replaceChildren();
  press('Comma');
  const d2 = await until(() => $('.dialog.settings'));
  button('Reset all', d2).click(); await sleep(300);
  const back = $$('.key-row', d2).find((r) => r.querySelector('.key-name').textContent === 'Command palette').querySelector('kbd')?.textContent;
  button('Done', d2).click();
  return { shown, oldKeys, opened, back };
`, (v) => (/Y$/.test(v?.shown || '') && !v.oldKeys && v.opened && /P$/.test(v.back || '') ? null : 'the changed shortcut did not take'));

await check('a review: pick one change, the count follows, apply writes it', `
  const ta = await openNote('sub/messy.md');
  ta.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  button('Tidy', o).click(); await sleep(200);
  button('Run on staged copy', o).click();
  const apply = await until(() => button('Apply'), 20000);
  if (!apply) return { error: 'no review', page: ($('.review') || $('#overlay'))?.innerText.slice(0, 400) };
  const heads = $$('.hunk-head input');
  const all = button('Apply').textContent;
  // Each tick redraws the review, so find the boxes again every time.
  for (let i = 1; i < heads.length; i++) { $$('.hunk-head input')[i].click(); await sleep(150); }
  const one = button('Apply').textContent;
  button('Apply').click();
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  return { hunks: heads.length, all, one, applied: /Applied/.test($('.review').textContent) };
`, (v) => (v?.hunks > 1 && v.one === 'Apply 1 selected' && v.all !== v.one && v.applied ? null : 'picking or applying did not work'));

const text = fs.readFileSync(path.join(ws, 'sub', 'messy.md'), 'utf8');
const changed = text.split('\n').filter((l) => /^(#+ |- )/.test(l)).length;
console.log(`${changed === 1 ? '✓' : '✗'} exactly the picked change reached the file`);
if (changed !== 1) failed = true;

console.log(failed ? `\nSmoke test failed (${results.filter((r) => !r.ok).length} of ${results.length + 1}).` : `\nAll ${results.length + 1} checks passed.`);
done(failed ? 1 : 0);
