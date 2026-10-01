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
fs.writeFileSync(path.join(ws, 'sub', 'links.md'), '# Links\n\nSee [[flow#Proposal]].\n\n> [!tip] Hint\n> Body.\n\n![[flow#Proposal]]\n');
// A picture larger than any window, for the image viewer.
fs.mkdirSync(path.join(ws, 'assets'));
fs.writeFileSync(path.join(ws, 'assets', 'big.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="#48c"/></svg>');
fs.writeFileSync(path.join(ws, 'pics.md'), '# Pics\n\n![Big picture](assets/big.svg)\n');
// Enough search hits that the results list scrolls.
fs.mkdirSync(path.join(ws, 'hits'));
for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(ws, 'hits', `h${i}.md`), Array.from({ length: 5 }, (_, j) => `needle ${i}.${j}`).join('\n\n') + '\n');
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
  // The page went away mid-run (it was still loading): say so, not "undefined".
  if (r.error) throw new Error(r.error.message);
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

// The page may still be loading (or load again) when the debugger first
// connects: wait until it has settled with the app in it.
for (let i = 0; i < 60; i++) {
  const r = await send('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#sidebar')", returnByValue: true }).catch(() => null);
  if (r?.result?.result?.value === true) break;
  await sleep(500);
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
  key('p', {}, stage);
  await until(() => $('.cap-head')?.textContent);
  key('Home', {}, stage); await sleep(300);
  const first = $('.cap-head')?.textContent;
  key(' ', {}, stage); await sleep(300);
  const second = $('.cap-head')?.textContent;
  const presenting = $('.canvas-pane').classList.contains('presenting');
  key('Escape', {}, stage); await sleep(300);
  return { first, second, presenting, after: $('.canvas-pane').classList.contains('presenting') };
`, (v) => (v.presenting && /1 \//.test(v.first || '') && /2 \//.test(v.second || '') && !v.after ? null : 'presenting did not start, step or end'));

await check('presenting zoomed in: the camera keeps each step in view, and the zoom', `
  const stage = $('.canvas-stage');
  stage.focus();
  key('p', {}, stage);
  await until(() => $('.cap-head')?.textContent);
  key('Home', {}, stage); await sleep(400);
  const width = () => $('.node-hit.walk-at')?.getBoundingClientRect().width || 0;
  const fitted = width();
  for (let i = 0; i < 4; i++) key('+', {}, stage);
  await sleep(100);
  const zoomed = width();
  // Where the step's box is, against the view above the caption.
  const inView = () => {
    const b = $('.node-hit.walk-at')?.getBoundingClientRect();
    const v = stage.getBoundingClientRect();
    const cap = $('.canvas-caption');
    const bottom = cap && !cap.hidden ? Math.min(v.bottom, cap.getBoundingClientRect().top) : v.bottom;
    return !!b && b.left >= v.left - 1 && b.right <= v.right + 1 && b.top >= v.top - 1 && b.bottom <= bottom + 1;
  };
  const seen = [];
  const go = async (k) => {
    key(k, {}, stage); await sleep(450);
    const b = $('.node-hit.walk-at')?.getBoundingClientRect();
    seen.push({ k, step: $('.cap-head')?.textContent, ok: inView(), box: b && [b.left, b.top, b.right, b.bottom].map(Math.round), view: [stage.clientWidth, stage.clientHeight, Math.round($('.canvas-caption').getBoundingClientRect().top)] });
  };
  for (let i = 0; i < 4; i++) await go(' ');
  await go('ArrowLeft');
  await go('ArrowRight');
  const kept = width(); // still in the same picture
  await go('End');
  await go('Home');
  key('Escape', {}, stage); await sleep(300);
  return { fitted, zoomed, kept, seen };
`, (v) => (v?.zoomed > v.fitted * 1.5 && v.kept > v.fitted * 1.5 && v.seen.length === 8 && v.seen.every((x) => x.ok) ? null : 'a step was off screen, or the zoom was lost'));

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

await check('a [[note#section]] link opens the note at that section', `
  await openNote('sub/links.md');
  button('Split').click();
  const a = await until(() => $$('.md a.internal').find((x) => x.offsetParent && x.dataset.target === 'flow#Proposal'));
  if (!a) return { error: 'no link' };
  a.click();
  const ta = await until(() => $('.tab.active')?.textContent.includes('flow.md') && $$('.editor-wrap textarea').find((t) => t.offsetParent));
  const at = await until(() => { const v = ta.value; const s = v.lastIndexOf('\\n', ta.selectionStart - 1) + 1; return v.slice(s, v.indexOf('\\n', s)).startsWith('## Proposal') && v.slice(s, v.indexOf('\\n', s)); }, 5000);
  return { at };
`, (v) => (v?.at === '## Proposal' ? null : 'the link did not land on the section'));

await check('a callout shows, and a link shows its section on hover', `
  await openNote('sub/links.md');
  const p = await until(() => $$('.preview').find((x) => x.offsetParent && x.querySelector('.callout')));
  const callout = p && [p.querySelector('.callout').className, p.querySelector('.callout-title').textContent];
  const a = p.querySelector('a.internal');
  a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const pop = await until(() => $('.link-preview'), 3000);
  const shown = pop && { head: pop.querySelector('.link-preview-head').textContent, text: pop.querySelector('.link-preview-body').textContent };
  key('Escape', {}, document.body);
  return { callout, shown, gone: !$('.link-preview') };
`, (v) => (v?.callout?.[0] === 'callout callout-tip' && v.callout[1] === 'Hint' && v.shown?.head === 'flow › Proposal' && /Proposal/.test(v.shown.text) && !/Waiting/.test(v.shown.text) && v.gone ? null : 'no callout, or the hover preview was wrong'));

await check('![[note#section]] shows that section in place', `
  const p = $$('.preview').find((x) => x.offsetParent && x.querySelector('.callout'));
  const box = await until(() => p.querySelector('div.note-embed'));
  const drawn = await until(() => box?.querySelector('pre.diagram img, pre.diagram svg'), 8000);
  return { head: box?.querySelector('.note-embed-head').textContent, text: box?.textContent, drawn: !!drawn, lines: box?.querySelectorAll('.note-embed-body [data-line]').length, line: box?.dataset.line };
`, (v) => (v?.head === '↳ flow › Proposal' && /Proposal/.test(v.text) && !/Waiting/.test(v.text) && v.drawn && v.lines === 0 && v.line ? null : 'the section was not shown in place'));

await check('@ in quick open finds a heading in any note', `
  const mac = navigator.platform.startsWith('Mac');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '@propos';
  input.dispatchEvent(new Event('input'));
  const item = await until(() => $$('#overlay .palette-item').find((x) => /flow/.test(x.querySelector('.hint')?.textContent || '')));
  const hint = item?.querySelector('.hint').textContent;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const ta = await until(() => $('.tab.active')?.textContent.includes('flow.md') && $$('.editor-wrap textarea').find((t) => t.offsetParent));
  const at = ta && await until(() => { const v = ta.value; const s = v.lastIndexOf('\\n', ta.selectionStart - 1) + 1; return v.slice(s, v.indexOf('\\n', s)); }, 3000);
  return { hint, at };
`, (v) => (v?.hint === 'flow · H2' && v.at === '## Proposal' ? null : 'the heading was not found or not opened'));

await check('a picture in the preview opens larger, fitted; 100%, Esc and a click beside close it', `
  await openNote('pics.md');
  const img = await until(() => $$('.preview img').find((x) => x.offsetParent && x.naturalWidth));
  if (!img) return { error: 'no picture' };
  img.click();
  const v = await until(() => $('.viewer'));
  await until(() => $('.viewer-img')?.naturalWidth);
  await sleep(100);
  const fitted = $('.viewer-zoom').textContent;
  button('100%', v).click();
  const full = $('.viewer-zoom').textContent;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const escClosed = !$('.viewer');
  img.click();
  const stage = (await until(() => $('.viewer-stage')));
  stage.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, clientX: 5, clientY: 300 }));
  stage.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, clientX: 5, clientY: 300 }));
  return { title: v.querySelector('.viewer-title').textContent, fitted, full, escClosed, besideClosed: !$('.viewer') };
`, (v) => (v?.title === 'Big picture' && parseInt(v.fitted, 10) < 100 && v.full === '100%' && v.escClosed && v.besideClosed ? null : 'the picture did not open, fit or close'));

await check('the tree follows the active tab, and the toggle turns it off (and is saved)', `
  const tabTo = async (name) => { $$('.tab').find((t) => t.textContent.includes(name)).click(); await sleep(250); };
  const collapse = async () => { const r = $$('#sidebar .tree-row').find((x) => x.title === 'sub'); if ($$('#sidebar .tree-row').some((x) => x.dataset.path?.startsWith('sub/'))) { r.click(); await sleep(150); } };
  const row = () => $$('#sidebar .tree-row').find((x) => x.dataset.path === 'sub/links.md');
  await tabTo('pics.md');
  await collapse();
  await tabTo('links.md');
  const r1 = row();
  const shown = !!r1 && r1.classList.contains('active') && (() => { const b = r1.closest('.panel-body').getBoundingClientRect(); const a = r1.getBoundingClientRect(); return a.top >= b.top && a.bottom <= b.bottom; })();
  const on = $('.follow-tab').getAttribute('aria-pressed');
  $('.follow-tab').click(); await sleep(100);
  const saved = JSON.parse(localStorage.getItem('an.settings')).followTab;
  await tabTo('pics.md');
  await collapse();
  await tabTo('links.md');
  const stayed = !row();
  $('.follow-tab').click(); await sleep(100);
  return { shown, on, saved, stayed, back: JSON.parse(localStorage.getItem('an.settings')).followTab };
`, (v) => (v?.shown && v.on === 'true' && v.saved === false && v.stayed && v.back === true ? null : 'the tree did not follow, or the toggle did not take'));

await check('the search results keep their scroll position when one is opened', `
  $('#activity [data-view="search"]').click();
  const input = await until(() => $('#search-input'));
  input.value = 'needle';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const box = $('#search-results');
  await until(() => box.querySelectorAll('.search-hit').length >= 60);
  box.scrollTop = box.scrollHeight;
  const before = box.scrollTop;
  const hit = [...box.querySelectorAll('.search-hit')].find((x) => x.offsetTop >= before + 20);
  const name = hit.previousElementSibling && [...box.querySelectorAll('.search-file')].filter((f) => f.offsetTop < hit.offsetTop).pop().title;
  hit.click();
  await until(() => $('.tab.active')?.textContent.includes(name.split('/').pop()));
  await sleep(300);
  const after = $('#search-results').scrollTop;
  $('#activity [data-view="files"]').click();
  return { before, after };
`, (v) => (v?.before > 0 && Math.abs(v.after - v.before) < 2 ? null : 'the results list jumped'));

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

const applied = fs.readFileSync(path.join(ws, 'sub', 'messy.md'), 'utf8');
const changed = applied.split('\n').filter((l) => /^(#+ |- )/.test(l)).length;
console.log(`${changed === 1 ? '✓' : '✗'} exactly the picked change reached the file`);
if (changed !== 1) failed = true;

await check('history shows the version from before the agent changes, and restores it', `
  const mac = navigator.platform.startsWith('Mac');
  await openNote('sub/messy.md');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>History of current note';
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const row = await until(() => $$('.history-row').find((r) => /Before agent changes/.test(r.textContent)));
  if (!row) return { error: 'no kept version', rows: $$('.history-row').map((r) => r.textContent) };
  row.click();
  const restore = await until(() => button('Restore this version'));
  restore.click();
  const ok = await until(() => button('Replace', $('.dialog.confirm')));
  ok.click();
  await until(() => /Restored/.test($('.toast')?.textContent || ''), 5000);
  return { restored: true };
`, (v) => (v?.restored ? null : 'no kept version to restore'));

const text = fs.readFileSync(path.join(ws, 'sub', 'messy.md'), 'utf8');
const original = text.startsWith('#Title\ntext');
console.log(`${original ? '✓' : '✗'} the restored file is the one from before`);
if (!original) failed = true;

console.log(failed ? `\nSmoke test failed (${results.filter((r) => !r.ok).length} of ${results.length + 2}).` : `\nAll ${results.length + 2} checks passed.`);
done(failed ? 1 : 0);
