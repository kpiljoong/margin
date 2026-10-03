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
const ws = path.join(tmp, 'notes (노트)'); // settings keys hold this path: any characters
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
// A picture to draw on.
fs.writeFileSync(path.join(ws, 'assets', 'screen.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#ddd"/></svg>');
fs.writeFileSync(path.join(ws, 'shot.md'), '# Shot\n\n![Screen](assets/screen.svg)\n\nAfter.\n');
// Lines for a keyboard macro, and notes to run one at every search result.
fs.writeFileSync(path.join(ws, 'macro.md'), 'apple\nbanana\ncherry');
fs.writeFileSync(path.join(ws, 'ime.md'), 'a\nb\n');
fs.writeFileSync(path.join(ws, 'outside.md'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
fs.writeFileSync(path.join(ws, 'expand.md'), '# Expand\n\nFirst one. A **bold** word here.\n\n## Part\n\nalpha beta gamma\n');
fs.writeFileSync(path.join(ws, 'tasks.md'), '# Tasks\n\n- [ ] late one 📅 2020-01-01\n- [ ] someday\n- [x] finished\n');
fs.writeFileSync(path.join(ws, 'RECIPES.md'), '# Recipes\n\n## Shout\nkey: s\nscope: note\n\nMake the title louder.\n');
fs.writeFileSync(path.join(ws, 'buf.md'), '# Buffer\n\nfirst line\nsecond line\n');
fs.writeFileSync(path.join(ws, 'narrow.md'), '# Narrow\n\nintro\n\n## A\n\nalpha\n\n## B\n\nbeta\n');
fs.mkdirSync(path.join(ws, 'dired'));
fs.writeFileSync(path.join(ws, 'dired', 'alpha.md'), '# Alpha\n');
fs.writeFileSync(path.join(ws, 'dired', 'keep.md'), '# Keep\n');
fs.writeFileSync(path.join(ws, 'dired', 'zz-old.md'), '# Old\n');
fs.writeFileSync(path.join(ws, 'cite.md'), 'See [[alpha]].\n');
fs.writeFileSync(path.join(ws, 'board.md'), '# Board\n\n```flow\nA -> B\n```\n');
fs.mkdirSync(path.join(ws, 'todo'));
fs.writeFileSync(path.join(ws, 'todo', 'a.md'), 'TODO one\n\nTODO two\n');
fs.writeFileSync(path.join(ws, 'todo', 'b.md'), 'TODO three\n');
// A note template.
fs.mkdirSync(path.join(ws, 'templates'));
fs.writeFileSync(path.join(ws, 'templates', 'Meeting.md'), '# {{title}}\n\nDate: {{date:YYYY}}\n\n## Notes\n\n{{cursor}}\n');
// Enough search hits that the results list scrolls.
fs.mkdirSync(path.join(ws, 'hits'));
for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(ws, 'hits', `h${i}.md`), Array.from({ length: 5 }, (_, j) => `needle ${i}.${j}`).join('\n\n') + '\n');
const filler = (p) => Array.from({ length: 10 }, (_, i) => `${p} ${i}`);
fs.writeFileSync(path.join(ws, 'sub', 'proof.md'), '# Proof\n\nThis is a very good plan for the the team.\n\nWe ship on Friday.\n');
fs.writeFileSync(path.join(ws, 'sub', 'meet.md'), '# Meet\n\nWe ship on Monday.\nDocs by Friday.\n');
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
  key(' ', {}, stage); await sleep(400); // from the frame to its first box
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
    // A frame step: the section whole, no box.
    seen.push({ k, step: $('.cap-head')?.textContent, ok: $('.cap-head.cap-frame') ? !$('.node-hit.walk-at') : inView(), box: b && [b.left, b.top, b.right, b.bottom].map(Math.round), view: [stage.clientWidth, stage.clientHeight, Math.round($('.canvas-caption').getBoundingClientRect().top)] });
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

await check('drawing on a flow writes its text: add, connect, colour, delete, undo', `
  await openNote('board.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const stage = await until(() => $$('.node-hit').length === 2 && $('.canvas-stage'), 15000);
  const flow = () => { const v = $$('.editor-wrap textarea').find((t) => t.offsetParent).value; return v.slice(v.indexOf('\`\`\`flow') + 8, v.lastIndexOf('\`\`\`')).trim(); };
  const box = (name) => $$('.node-hit').find((b) => b.closest('pre').flowNodes.find((n) => n.id === b.dataset.id)?.text === name);
  const at = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const out = {};
  // The + of B, clicked: a box after it, named at once.
  const plus = box('B').querySelector('.box-handle');
  ptr('pointerdown', plus, at(plus)); ptr('pointerup', stage, at(plus));
  const input = await until(() => $('.canvas-rename'), 8000);
  input.value = 'C';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => box('C'), 8000); await sleep(300);
  out.add = flow();
  // A drag from C's + to A: an arrow.
  const from = box('C').querySelector('.box-handle');
  ptr('pointerdown', from, at(from)); ptr('pointermove', stage, at(box('B'))); ptr('pointermove', stage, at(box('A'))); ptr('pointerup', stage, at(box('A')));
  await until(() => flow().includes('C -> A'), 8000);
  out.connect = flow();
  out.wireGone = getComputedStyle($('.canvas-wire')).display === 'none';
  // Select B, colour it (C, then a number), delete it, undo that.
  await until(() => box('B'), 8000); await sleep(400);
  ptr('pointerdown', box('B'), at(box('B'))); ptr('pointerup', box('B'), at(box('B'))); box('B').click(); await sleep(200);
  stage.focus(); key('c', {}, stage); await sleep(200);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '6', bubbles: true, cancelable: true }));
  await until(() => flow().includes('color'), 8000);
  out.color = flow();
  await until(() => $('.node-hit.walk-at'), 8000); await sleep(400);
  key('Delete', {}, stage);
  await until(() => !flow().includes('B'), 8000);
  out.del = flow();
  key('z', { metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac') }, stage);
  await until(() => flow().includes('B'), 8000);
  out.undo = flow();
  return out;
`, (v) => (v?.add === 'A -> B -> C' && v.connect === 'A -> B -> C -> A' && v.wireGone && v.color === 'A -> B -> C -> A\ncolor blue: B' && v.del === 'A -> C -> A' && v.undo === v.color ? null : `got ${JSON.stringify(v)}`));

await check('an arrow on a flow: click it, make it two-way, take it out; a box’s shape', `
  const stage = $('.canvas-stage');
  const flow = () => { const v = $$('.editor-wrap textarea').find((t) => t.offsetParent).value; return v.slice(v.indexOf('\`\`\`flow') + 8, v.lastIndexOf('\`\`\`')).trim(); };
  const id = (name) => $('pre.diagram')?.flowNodes?.find((n) => n.text === name)?.id;
  const edge = (a, b) => $$('.edge').find((g) => g.dataset.from === id(a) && g.dataset.to === id(b));
  const out = {};
  const g = await until(() => edge('C', 'A'), 15000);
  if (!g) return { none: $$('.edge').length };
  g.querySelector('.edge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  out.on = !!(await until(() => $('.edge.on'), 4000));
  stage.focus(); key('b', {}, stage);
  await until(() => flow().includes('<->'), 8000);
  out.both = flow();
  await until(() => edge('C', 'A') !== g && edge('C', 'A')?.classList.contains('on'), 8000);
  key('Delete', {}, stage);
  await until(() => !flow().includes('<->'), 8000);
  out.gone = flow();
  // A box's shape: S, then a number.
  await sleep(400);
  const c = $$('.node-hit').find((x) => x.dataset.id === id('C'));
  c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); c.click(); await sleep(200);
  stage.focus(); key('s', {}, stage); await sleep(200);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true }));
  await until(() => flow().includes('(C)'), 8000);
  out.shape = flow();
  return out;
`, (v) => (v?.on && v.both === 'A -> B -> C <-> A\ncolor blue: B' && v.gone === 'A -> B -> C\ncolor blue: B' && v.shape === 'A -> B -> (C)\ncolor blue: B' ? null : `got ${JSON.stringify(v)}`));

await check('a picture on the canvas: a box drawn on it is a line of its ```ink block; the eraser takes it out, ⌘Z brings it back', `
  await openNote('shot.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const img = () => $('.canvas-stage .ink-figure img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  const stage = $('.canvas-stage');
  const text = () => $$('.editor-wrap textarea').find((t) => t.offsetParent).value;
  const pt = (fx, fy) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const out = {};
  img().dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
  stage.focus(); key('r', {}, stage);
  out.bar = !$('.ink-bar').hidden && !!$('.ink-tool.on');
  ptr('pointerdown', img(), pt(0.25, 0.25)); ptr('pointermove', stage, pt(0.5, 0.5)); ptr('pointerup', stage, pt(0.75, 0.75));
  await until(() => text().includes('\`\`\`ink'), 8000);
  out.drawn = text();
  const mark = await until(() => $('.canvas-stage .ink-figure .ink-mark .ink-hit'), 8000);
  key('e', {}, stage);
  ptr('pointerdown', mark, pt(0.25, 0.5)); ptr('pointerup', stage, pt(0.25, 0.5));
  await until(() => !text().includes('\`\`\`ink'), 8000);
  out.erased = text();
  key('z', { metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac') }, stage);
  await until(() => text().includes('\`\`\`ink'), 8000);
  out.undone = text() === out.drawn;
  key('Escape', {}, stage);
  out.off = !$('.ink-tool.on');
  return out;
`, (v) => (v?.bar && /^# Shot\n\n!\[Screen\]\(assets\/screen\.svg\)\n\n```ink\nbox red: \d+,\d+ \d+x\d+\n```\n\nAfter\.\n$/.test(v.drawn) && v.erased === '# Shot\n\n![Screen](assets/screen.svg)\n\nAfter.\n' && v.undone && v.off ? null : `got ${JSON.stringify(v)}`));

await check('presenting a picture: its frame first, the marks still to come hidden, then shown; [ goes back to the frame', `
  const stage = $('.canvas-stage');
  await sleep(1500); // the canvas drawn again after the undo before (that ends a presentation)
  stage.focus();
  key('p', {}, stage);
  await until(() => $('.cap-head')?.textContent);
  key('Home', {}, stage); await sleep(300);
  const out = { frame: !!$('.cap-head.cap-frame'), head: $('.cap-head').textContent, hidden: $$('.ink-mark.unseen').length, bar: getComputedStyle($('.ink-bar')).display };
  key(' ', {}, stage); await sleep(300);
  out.next = $('.cap-head').textContent;
  out.shown = $$('.ink-mark').length - $$('.ink-mark.unseen').length;
  key('[', {}, stage); await sleep(300);
  out.back = $('.cap-head').textContent;
  key('Escape', {}, stage); await sleep(300);
  out.after = $$('.ink-mark.unseen').length + ($('.canvas-pane').classList.contains('presenting') ? 1 : 0);
  return out;
`, (v) => (v?.frame && v.head.startsWith('Shot') && /1 \/ 2$/.test(v.head) && v.hidden === 1 && v.bar === 'none' && /2 \/ 2$/.test(v.next) && v.shown === 1 && /1 \/ 2$/.test(v.back) && v.after === 0 ? null : `got ${JSON.stringify(v)}`));

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

await check('⌘/Ctrl-click on a link in the editor follows it', `
  const ta = await openNote('sub/links.md');
  const mac = navigator.platform.startsWith('Mac');
  const at = ta.value.indexOf('[[flow#Proposal]]') + 4;
  ta.focus();
  ta.setSelectionRange(at, at);
  ta.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: mac, ctrlKey: !mac }));
  const ta2 = await until(() => $('.tab.active')?.textContent.includes('flow.md') && $$('.editor-wrap textarea').find((t) => t.offsetParent));
  const line = ta2 && await until(() => { const v = ta2.value; const s = v.lastIndexOf('\\n', ta2.selectionStart - 1) + 1; const l = v.slice(s, v.indexOf('\\n', s)); return l.startsWith('## Proposal') && l; }, 5000);
  await openNote('sub/links.md');
  return { line };
`, (v) => (v?.line === '## Proposal' ? null : 'the link was not followed'));

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
  const saved = JSON.parse((await import('/store.js')).store.getItem('an.settings')).followTab;
  await tabTo('pics.md');
  await collapse();
  await tabTo('links.md');
  const stayed = !row();
  $('.follow-tab').click(); await sleep(100);
  return { shown, on, saved, stayed, back: JSON.parse((await import('/store.js')).store.getItem('an.settings')).followTab };
`, (v) => (v?.shown && v.on === 'true' && v.saved === false && v.stayed && v.back === true ? null : 'the tree did not follow, or the toggle did not take'));

await check('a bookmarked file shows at the top of the tree, opens, and can be removed', `
  const menu = async (row, label) => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })); (await until(() => $$('.ctx-item').find((b) => b.textContent === label))).click(); await sleep(100); };
  $$('.tab').find((t) => t.textContent.includes('links.md')).click(); await sleep(150);
  await menu($$('#sidebar .tree-row').find((x) => x.dataset.path === 'pics.md'), 'Bookmark');
  await menu($$('#sidebar .tree-row').find((x) => x.dataset.path === 'sub/links.md'), 'Bookmark');
  const marks = () => $$('#sidebar .bookmark-row').map((r) => r.title);
  const first = $('#sidebar .panel-body .tree-row');
  const top = first?.classList.contains('bookmark-row') && first.title === 'pics.md';
  const both = marks().join();
  first.click();
  const opened = !!(await until(() => $('.tab.active')?.textContent.includes('pics.md')));
  const active = $('#sidebar .bookmark-row.active')?.title;
  await menu($$('#sidebar .bookmark-row').find((r) => r.title === 'sub/links.md'), 'Remove bookmark');
  return { top, both, opened, active, left: marks().join() };
`, (v) => (v?.top && v.both === 'pics.md,sub/links.md' && v.opened && v.active === 'pics.md' && v.left === 'pics.md' ? null : 'the bookmark was not shown, opened or removed'));

await check('a new note from a template has its title, date and caret filled in', `
  const folder = $$('#sidebar .tree-row').find((x) => x.title === 'sub' && !x.dataset.path);
  folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  (await until(() => $$('.ctx-item').find((b) => b.textContent === 'New note from template here…'))).click();
  const pick = await until(() => !$('#overlay').hidden && $$('#overlay .palette-item').find((x) => /Meeting/.test(x.textContent)) && $('#overlay input'));
  pick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const name = await until(() => $('#overlay .dialog input'));
  const asked = name?.value;
  name.value = 'sub/Standup';
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const ta = await until(() => $('.tab.active')?.textContent.includes('Standup') && $$('.editor-wrap textarea').find((t) => t.offsetParent));
  await sleep(200);
  return { asked, text: ta?.value, caret: ta && ta.value.slice(0, ta.selectionStart) };
`, (v) => (v?.asked === 'sub/' && v.text === `# Standup\n\nDate: ${new Date().getFullYear()}\n\n## Notes\n\n\n` && v.caret === v.text.slice(0, -1) ? null : 'the template was not filled in'));

await check('drawn diagrams are kept on disk for the next start', `
  const db = await new Promise((res, rej) => { const r = indexedDB.open('margin-diagrams'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const n = await new Promise((res) => { const q = db.transaction('pictures').objectStore('pictures').count(); q.onsuccess = () => res(q.result); });
  db.close();
  return { n };
`, (v) => (v?.n >= 2 ? null : 'nothing was kept'));

await check('⌘F in Preview finds in the preview (it stays Preview); Replace… goes to the editor', `
  const mac = navigator.platform.startsWith('Mac');
  await openNote('flow.md');
  button('Preview').click();
  await sleep(300);
  document.activeElement?.blur();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => $$('.preview-find').find((b) => !b.hidden)?.querySelector('input'));
  const wrap = input?.closest('.editor-wrap');
  input.value = 'pro'; // approval, Proposal
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  const count = input.closest('.preview-find').querySelector('.ed-find-count').textContent;
  const marks = CSS.highlights.get('preview-find')?.size;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const next = input.closest('.preview-find').querySelector('.ed-find-count').textContent;
  const stayed = wrap.classList.contains('mode-preview');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const cleared = !CSS.highlights.has('preview-find') || CSS.highlights.get('preview-find').size === 0;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const again = await until(() => $$('.preview-find').find((b) => !b.hidden));
  button('Replace…', again).click();
  const edFind = await until(() => $$('.ed-find:not(.preview-find)').find((b) => !b.hidden && b.offsetParent));
  const split = !!$$('.editor-wrap').find((w) => w.offsetParent && w.classList.contains('mode-split'));
  const replaceRow = edFind?.classList.contains('with-replace');
  const query = edFind?.querySelector('input').value;
  edFind?.querySelector('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  return { count, marks, next, stayed, cleared, split, replaceRow, query };
`, (v) => (/^1 \/ [2-9]/.test(v?.count || '') && v.marks >= 2 && /^2 \//.test(v.next) && v.stayed && v.cleared && v.split && v.replaceRow && v.query === 'pro' ? null : 'finding in the preview did not work'));

await check('the leader key (⌥X): f f finds a file, Space all commands; w h goes to the tree, j and Enter open', `
  const ta = await openNote('flow.md');
  const leaderKey = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  ta.focus();
  leaderKey('KeyX', '≈', { altKey: true });
  const menu = await until(() => $('.leader'));
  const focused = document.activeElement === menu;
  const groups = $$('.leader-item.group', menu).map((b) => b.dataset.key).join('');
  leaderKey('KeyF', 'f');
  const files = $('.leader-head', menu)?.textContent.includes('files');
  leaderKey('KeyF', 'f');
  const quick = await until(() => $$('.palette-list').find((l) => l.offsetParent));
  const quickValue = $('#overlay input')?.value;
  const typedInEditor = ta.value.includes('≈') || ta.value.startsWith('f');
  key('Escape', {}, $('#overlay input'));
  await sleep(100);
  ta.focus();
  leaderKey('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  leaderKey('Space', ' ');
  await until(() => $$('.palette-list').find((l) => l.offsetParent));
  const paletteValue = $('#overlay input')?.value;
  key('Escape', {}, $('#overlay input'));
  await sleep(100);
  ta.focus();
  leaderKey('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  leaderKey('KeyW', 'w');
  leaderKey('KeyH', 'h');
  const row = await until(() => document.activeElement?.closest?.('#sidebar .tree-row') && document.activeElement);
  const from = row?.dataset.path;
  key('j');
  const next = document.activeElement;
  const moved = next !== row && next.matches('.tree-row');
  const target = next.dataset.path;
  key('Enter');
  const opened = target ? !!(await until(() => $('.tab.active')?.textContent.includes(target.split('/').pop().replace(/\\.md$/, '')))) : true;
  key('Escape');
  const back = await until(() => !document.activeElement?.closest('#sidebar'));
  return { focused, groups, files, quick: !!quick, quickValue, typedInEditor, paletteValue, from, moved, opened, back: !!back };
`, (v) => (v?.focused && v.groups === 'fsbwmnlgartpqh' && v.files && v.quick && v.quickValue === '' && !v.typedInEditor && v.paletteValue === '>' && v.from === 'flow.md' && v.moved && v.opened && v.back ? null : 'the leader key did not work'));

await check('link hints in a focused preview: f, then a letter, follows that link', `
  await openNote('sub/links.md');
  button('Preview').click();
  await sleep(300);
  const leaderKey = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  leaderKey('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  leaderKey('KeyW', 'w');
  leaderKey('KeyP', 'p');
  const preview = await until(() => document.activeElement?.classList.contains('preview') && document.activeElement);
  leaderKey('KeyF', 'f');
  const hints = await until(() => $$('.link-hint').map((m) => m.textContent));
  leaderKey('KeyA', 'a');
  const followed = await until(() => $('.tab.active')?.textContent.includes('flow.md'));
  await openNote('sub/links.md');
  button('Split').click();
  await sleep(200);
  return { preview: !!preview, hints, followed: !!followed, left: $$('.link-hint').length };
`, (v) => (v?.preview && v.hints?.[0] === 'a' && v.followed && v.left === 0 ? null : 'link hints did not work'));

await check('back returns to the place in the note: after a jump inside it, and from another note', `
  const mac = navigator.platform.startsWith('Mac');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  const lineOf = (ta) => { const v = ta.value; const s = v.lastIndexOf('\\n', ta.selectionStart - 1) + 1; return v.slice(s, v.indexOf('\\n', s)); };
  let ta = await openNote('flow.md');
  ta.focus();
  ta.setSelectionRange(10, 10);
  await sleep(900);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyS', 's');
  press('KeyL', 'l');
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = ':14';
  input.dispatchEvent(new Event('input'));
  await until(() => $('#overlay .palette-item'));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const jumped = await until(() => lineOf(ta) === '## Proposal' && lineOf(ta));
  await sleep(100);
  press('BracketLeft', '[', { metaKey: mac, ctrlKey: !mac });
  const backInNote = await until(() => ta.selectionStart === 10 && 10);
  await openNote('sub/links.md');
  await sleep(100);
  press('BracketLeft', '[', { metaKey: mac, ctrlKey: !mac });
  await until(() => $('.tab.active')?.textContent.includes('flow.md'));
  ta = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const backFromOther = await until(() => ta?.selectionStart === 10 && 10, 3000);
  press('BracketRight', ']', { metaKey: mac, ctrlKey: !mac });
  const forward = await until(() => $('.tab.active')?.textContent.includes('links.md'));
  return { jumped, backInNote, backFromOther, forward: !!forward };
`, (v) => (v?.jumped && v.backInNote === 10 && v.backFromOther === 10 && v.forward ? null : 'back did not return to the place'));

await check('F8 / ⇧F8 step through the search results from the note; ⌥. repeats the last command', `
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  $('#activity [data-view="search"]').click();
  const input = await until(() => $('#search-input'));
  input.value = 'needle';
  input.dispatchEvent(new Event('input'));
  await until(() => $$('#search-results .search-hit').length >= 60);
  $('#activity [data-view="files"]').click();
  const ta0 = await openNote('flow.md');
  ta0.focus();
  const step = async (code, opts, n) => {
    press(code, '', opts);
    await until(() => $('#toast')?.textContent.startsWith(n + ' / 60'), 3000);
    await sleep(150);
    const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent);
    return { toast: $('#toast')?.textContent.split('  ')[0], sel: ta?.value.slice(ta.selectionStart, ta.selectionEnd), tab: $('.tab.active')?.textContent, current: $$('#search-results .search-hit').findIndex((r) => r.classList.contains('current')) };
  };
  const a = await step('F8', {}, 1);
  const b = await step('F8', {}, 2);
  const c = await step('F8', { shiftKey: true }, 1);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyS', 's');
  const d = await step('KeyN', {}, 2);
  const e = await step('Period', { altKey: true }, 3);
  $('#activity [data-view="search"]').click();
  await sleep(100);
  e.current = $$('#search-results .search-hit').findIndex((r) => r.classList.contains('current'));
  $('#activity [data-view="files"]').click();
  return { a, b, c, d, e };
`, (v) => (v?.a?.toast === '1 / 60' && v.a.sel === 'needle' && v.b.toast === '2 / 60' && v.c.toast === '1 / 60' && v.d.toast === '2 / 60' && v.e.toast === '3 / 60' && v.e.current === 2 ? null : 'stepping through the results did not work'));

// Keyboard macros, with real keys (the browser types and moves the caret).
{
  const mac = process.platform === 'darwin';
  const key = async (k, code, vk, modifiers = 0, commands) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const lineEnd = () => (mac ? key('ArrowRight', 'ArrowRight', 39, 4, ['moveToEndOfLine']) : key('End', 'End', 35));
  const lineStart = () => (mac ? key('ArrowLeft', 'ArrowLeft', 37, 4, ['moveToBeginningOfLine']) : key('Home', 'Home', 36));
  const down = () => key('ArrowDown', 'ArrowDown', 40, 0, mac ? ['moveDown'] : undefined);
  const type = (text) => send('Input.insertText', { text });
  const value = `await sleep(250); return $$('.editor-wrap textarea').find((t) => t.offsetParent)?.value;`;
  const leader = (...codes) => inPage(`
    const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
    press('KeyX', '≈', { altKey: true });
    await until(() => $('.leader'));
    for (const c of ${JSON.stringify(codes)}) press('Key' + c.toUpperCase(), c);
    await sleep(100);
  `);
  let got = {};
  let problem = null;
  try {
    await inPage(`const ta = await openNote('macro.md'); ta.focus(); ta.setSelectionRange(0, 0);`);
    await key('F3', 'F3', 114);
    got.rec = await inPage(`return !!$('#status .rec');`);
    await type('- ');
    await lineEnd();
    await type('!');
    await down();
    await lineStart();
    await key('F4', 'F4', 115);
    got.recorded = await inPage(value);
    await key('F4', 'F4', 115);
    got.once = await inPage(value);
    await leader('q', 'e');
    got.all = await inPage(value);
    // Typed with an IME (Korean): the composed text is what's kept.
    await inPage(`const ta = await openNote('ime.md'); ta.focus(); ta.setSelectionRange(0, 0);`);
    await key('F3', 'F3', 114);
    for (const t of ['ㅎ', '하', '한']) await send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
    await type('한');
    for (const t of ['ㄱ', '글']) await send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
    await type('글');
    await type(' ');
    await down();
    await lineStart();
    await key('F4', 'F4', 115);
    got.imeMacro = await inPage(`await sleep(250); return $('#toast')?.textContent;`);
    await key('F4', 'F4', 115);
    got.ime = await inPage(value);
    await inPage(`await openNote('macro.md');`);
    if (!got.rec || got.recorded !== '- apple!\nbanana\ncherry' || got.once !== '- apple!\n- banana!\ncherry' || got.all !== '- apple!\n- banana!\n- cherry!' || got.ime !== '한글 a\n한글 b\n' || !got.imeMacro?.startsWith('Macro: “한글 ” · ↓ · ⇤')) problem = 'the macro did not record or play';

    await inPage(`
      $('#activity [data-view="search"]').click();
      const input = await until(() => $('#search-input'));
      input.value = 'TODO';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await until(() => $$('#search-results .search-hit').length === 3);
      $('#activity [data-view="files"]').click();
      const ta = await openNote('todo/a.md');
      ta.focus();
      ta.setSelectionRange(0, 0);
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8', key: 'F8', bubbles: true, cancelable: true }));
      await until(() => ta.value.slice(ta.selectionStart, ta.selectionEnd) === 'TODO');
    `);
    await key('F3', 'F3', 114);
    await type('DONE');
    await key('F4', 'F4', 115);
    await leader('q', 's');
    got.results = await inPage(`
      await until(() => $('#toast')?.textContent.startsWith('The macro ran at'), 5000);
      const toastText = $('#toast')?.textContent;
      await openNote('todo/b.md');
      const b = $$('.editor-wrap textarea').find((t) => t.offsetParent).value;
      const a = (await openNote('todo/a.md')).value;
      return { toastText, a, b };
    `);
    if (!problem && (got.results?.a !== 'DONE one\n\nDONE two\n' || got.results.b !== 'DONE three\n' || got.results.toastText !== 'The macro ran at 2 of 2 results')) problem = 'the macro did not run at every search result';
  } catch (e) { problem = e.message; }
  const name = 'a keyboard macro (F3 … F4) records typing and moves, plays once, until the end, and at every search result';
  results.push({ name, ok: !problem });
  console.log(`${problem ? '✗' : '✓'} ${name}${problem ? `\n    ${problem}\n    got: ${JSON.stringify(got)}` : ''}`);
  if (problem) failed = true;
}

await check('undo survives switching tabs and modes; one ⌘Z takes back a run of typing, and a change from outside', `
  const mac = navigator.platform.startsWith('Mac');
  let ta = await openNote('ime.md');
  const start = ta.value;
  ta.focus();
  ta.setSelectionRange(start.length, start.length);
  for (const c of 'xyz') document.execCommand('insertText', false, c);
  await openNote('flow.md');
  await sleep(100);
  button('Split').click();
  ta = await openNote('ime.md');
  ta.focus();
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const undone = ta.value;
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, shiftKey: true, metaKey: mac, ctrlKey: !mac }));
  const redone = ta.value;
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  await until(() => $('#status')?.textContent.includes('saved'));
  return { undone, redone, start };
`, (v) => (v?.undone === v?.start && v.redone === v.start + 'xyz' ? null : 'undo did not survive'));

await check('buffers: a closed note comes back with its cursor and undo; ⌥X ` goes to the note before; the list is most recent first; messages are kept', `
  const mac = navigator.platform.startsWith('Mac');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  let ta = await openNote('buf.md');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  document.execCommand('insertText', false, 'third line\\n');
  press('KeyS', 's', { metaKey: mac, ctrlKey: !mac });
  await until(() => $('#status')?.textContent.includes('saved'));
  ta.setSelectionRange(12, 12);
  await sleep(100);
  press('KeyW', 'w', { metaKey: mac, ctrlKey: !mac });
  await until(() => !$$('.tab').some((t) => t.textContent.includes('buf.md')));
  ta = await openNote('buf.md');
  await sleep(150);
  const caret = ta.selectionStart;
  ta.focus();
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const undone = ta.value;
  ta.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, shiftKey: true, metaKey: mac, ctrlKey: !mac }));
  await openNote('flow.md');
  await sleep(50);
  await openNote('sub/links.md');
  await sleep(50);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('Backquote', '\`');
  const other = await until(() => $('.tab.active')?.textContent.includes('flow.md'));
  press('Digit6', '6', { ctrlKey: true });
  const back = await until(() => $('.tab.active')?.textContent.includes('links.md'));
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyB', 'b');
  press('KeyB', 'b');
  const first = await until(() => !$('#overlay').hidden && $('#overlay .palette-item')?.textContent);
  key('Escape', {}, $('#overlay input'));
  await sleep(100);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyB', 'b');
  press('KeyM', 'm');
  const msgs = await until(() => document.activeElement?.dataset.tab === 'messages' && $$('.message-row').map((x) => x.textContent));
  key('q');
  await until(() => !$('.messages-buffer'));
  return { caret, undone, other: !!other, back: !!back, first, saved: msgs?.some((m) => m.includes('Link copied') || m.length > 0) };
`, (v) => (v?.caret === 12 && v.undone === '# Buffer\n\nfirst line\nsecond line\n' && v.other && v.back && /^●?flow\.md/.test(v.first || '') && v.saved ? null : 'buffers did not work'));

// The settings went to the app's config, not just this port's browser storage.
{
  await sleep(600);
  let page = null;
  try { page = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8')).page; } catch { /* none */ }
  const marks = Object.entries(page || {}).find(([k]) => k.startsWith('an.bookmarks.'))?.[1];
  const ok = JSON.parse(page?.['an.settings'] || '{}').followTab === true && marks === '["pics.md"]';
  results.push({ name: 'settings and bookmarks are kept in the app config', ok });
  console.log(`${ok ? '✓' : '✗'} settings and bookmarks are kept in the app config${ok ? '' : `\n    got: ${JSON.stringify(page)?.slice(0, 300)}`}`);
  if (!ok) failed = true;
}

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
  if (!hit) return { error: 'no hit below', hits: box.querySelectorAll('.search-hit').length, view: $('#sidebar').dataset.view, app: $('#app').className, active: document.activeElement.className, overlay: !$('#overlay').hidden, layer: !!$('.link-hints'), leader: !!$('.leader'), text: box.textContent.slice(0, 200) };
  const name = hit.previousElementSibling && [...box.querySelectorAll('.search-file')].filter((f) => f.offsetTop < hit.offsetTop).pop().title;
  hit.click();
  await until(() => $('.tab.active')?.textContent.includes(name.split('/').pop()));
  await sleep(300);
  const after = $('#search-results').scrollTop;
  $('#activity [data-view="files"]').click();
  return { before, after };
`, (v) => (v?.before > 0 && Math.abs(v.after - v.before) < 2 ? null : 'the results list jumped'));

// Another program (an agent in a terminal) changes a note: two changes.
fs.writeFileSync(path.join(ws, 'agent-new.md'), '# Made by an agent\n');
await sleep(300);
fs.writeFileSync(path.join(ws, 'outside.md'), Array.from({ length: 20 }, (_, i) => (i === 1 ? 'LINE 2 by agent' : i === 17 ? 'LINE 18 by agent' : `line ${i + 1}`)).join('\n') + '\n');
await check('a change from outside shows in the status bar; undo one of its changes by keys, keep the other', `
  const item = await until(() => $$('#status .outside-count').find((x) => /changed outside/.test(x.textContent)), 10000);
  if (!item) return { error: 'no status item', status: $('#status').textContent };
  item.click();
  // Drawn with the red pen first; v shows the diff (and stays so for the next reviews).
  const pen = await until(() => $('.review .pen-card'));
  key('v');
  const wrap = await until(() => $('.review .hunk') && $('.review'));
  const focused = document.activeElement === wrap;
  // The newest first (a test before may have changed a note from outside too).
  const hunks = $$('.review .file-card')[0]?.dataset.path === 'outside.md' && $$('.review .file-card')[0].querySelectorAll('.hunk').length;
  const made = $$('.review .file-card').some((c) => c.dataset.path === 'agent-new.md' && /added/.test(c.querySelector('.badge').textContent));
  key('j'); key('x'); await sleep(150);
  const label = button('Undo')?.textContent;
  key('a');
  const ok = await until(() => /Nothing changed outside/.test($('.review')?.textContent || ''), 5000);
  await sleep(200);
  return { pen: !!pen, focused, hunks, made, label, ok: !!ok, gone: !$('#status .outside-count') };
`, (v) => (v?.pen && v.focused && v.hunks === 2 && v.made && /^Undo 1, keep \d+$/.test(v.label) && v.ok && v.gone ? null : 'reviewing the outside change did not work'));
{
  const t = fs.readFileSync(path.join(ws, 'outside.md'), 'utf8').split('\n');
  const good = t[1] === 'line 2' && t[17] === 'LINE 18 by agent' && fs.existsSync(path.join(ws, 'agent-new.md'));
  console.log(`${good ? '✓' : '✗'} the undone change is gone from the file, the kept one stays`);
  if (!good) failed = true;
}

await check('a review by keys: U none, j/k to a change, x picks it, a click too, a applies', `
  const ta = await openNote('sub/messy.md');
  ta.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  button('Tidy', o).click(); await sleep(200);
  button('Run on staged copy', o).click();
  const apply = await until(() => button('Apply', $('#main')), 20000);
  if (!apply) return { error: 'no review', page: ($('.review') || $('#overlay'))?.innerText.slice(0, 400) };
  const focused = document.activeElement === $('.review');
  const hunks = $$('.hunk-head input').length;
  const all = button('Apply', $('#main')).textContent;
  key('U'); await sleep(100);
  const none = button('Apply', $('#main')).textContent;
  key('j'); key('j'); key('k'); await sleep(50);
  const cur = $('.kb-cur')?.dataset.hunk;
  key('x'); await sleep(150);
  const one = button('Apply', $('#main')).textContent;
  const kept = document.activeElement === $('.review') && $('.kb-cur')?.dataset.hunk === '0';
  // A click picks too (the box is redrawn), and the keys go on working after it.
  $$('.hunk-head input')[1].click(); await sleep(150);
  const two = button('Apply', $('#main')).textContent;
  key('j'); key('x'); await sleep(150);
  const back = button('Apply', $('#main')).textContent;
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  return { focused, hunks, all, none, cur, one, kept, two, back, applied: /Applied/.test($('.review').textContent) };
`, (v) => (v?.focused && v.hunks > 1 && v.none === 'Apply 0 selected' && v.cur === '0' && v.one === 'Apply 1 selected' && v.kept
  && v.two === 'Apply 2 selected' && v.back === 'Apply 1 selected' && v.all !== v.one && v.applied ? null : 'picking or applying did not work'));

const applied = fs.readFileSync(path.join(ws, 'sub', 'messy.md'), 'utf8');
const changed = applied.split('\n').filter((l) => /^(#+ |- )/.test(l)).length;
console.log(`${changed === 1 ? '✓' : '✗'} exactly the picked change reached the file`);
if (changed !== 1) failed = true;

await check('red pen: the marks on the note, the reasons in the margin; y takes one, a applies it', `
  const ta = await openNote('sub/proof.md');
  ta.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  button('Red pen', o).click(); await sleep(200);
  button('Run on staged copy', o).click();
  await until(() => button('Apply', $('#main')), 20000);
  // The reviews before this one switched to the diff: back to the red pen,
  // where U leaves every mark open again.
  if (!$('.pen-card')) { key('v'); await until(() => $('.pen-card')); }
  key('U'); await sleep(150);
  const card = $('.pen-card');
  if (!card) return { error: 'no red pen', page: $('.review')?.innerText.slice(0, 400) };
  const struck = $$('.pen-doc .pen-del').map((x) => x.textContent.trim());
  const notes = $$('.pen-card .pen-note').map((x) => x.textContent);
  const none = button('Apply', $('#main')).textContent;
  key('j'); await sleep(50); key('y'); await sleep(200);
  const one = button('Apply', $('#main')).textContent;
  const taken = $('.pen-card').classList.contains('pen-y') && $$('.pen-doc .pen-del.pen-y').length === struck.length;
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  return { struck, notes, none, one, taken, applied: /Applied/.test($('.review').textContent) };
`, (v) => (v?.struck?.join() === 'very,the' && v.notes.includes('Repeated word.') && v.none === 'Apply 0 accepted' && v.one === 'Apply 1 accepted' && v.taken && v.applied ? null : 'the red pen did not work'));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'proof.md'), 'utf8');
  const good = t === '# Proof\n\nThis is a good plan for the team.\n\nWe ship on Friday.\n';
  console.log(`${good ? '✓' : '✗'} the accepted marks reached the note, nothing else`);
  if (!good) failed = true;
}

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

await check('expand / shrink the selection, jump to a word by its letters, paste from the copy history', `
  const mac = navigator.platform.startsWith('Mac');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  const ta = await openNote('expand.md');
  ta.focus();
  const at = ta.value.indexOf('old');
  ta.setSelectionRange(at, at);
  const sel = () => ta.value.slice(ta.selectionStart, ta.selectionEnd);
  const grew = [];
  for (let i = 0; i < 3; i++) { press('ArrowUp', 'ArrowUp', { altKey: true, shiftKey: true }); grew.push(sel()); }
  press('ArrowDown', 'ArrowDown', { altKey: true, shiftKey: true });
  const shrunk = sel();
  // Jump: letters on the words in view; the one on "gamma" puts the caret there.
  const want = ta.value.indexOf('gamma');
  let n = 0;
  let jumped = false;
  const tries = [];
  for (let i = 0; i < 26 && !jumped; i++) {
    await sleep(200); // the same command twice within 150 ms runs once
    ta.focus();
    ta.setSelectionRange(0, 0);
    press('Semicolon', ';', { ctrlKey: true });
    const hints = await until(() => $$('.link-hint').length && $$('.link-hint'));
    if (!hints) break;
    n = hints.length;
    const l = hints[i]?.textContent;
    press(l ? 'Key' + l.toUpperCase() : 'Escape', l || 'Escape');
    if (!l) break;
    await sleep(50);
    tries.push([l, ta.selectionStart, document.activeElement === ta]);
    jumped = ta.selectionStart === want && document.activeElement === ta;
  }
  // Copy a word, then paste it from the history.
  ta.setSelectionRange(want, want + 5);
  document.dispatchEvent(new Event('copy', { bubbles: true }));
  ta.setSelectionRange(ta.value.length, ta.value.length);
  press('KeyV', 'v', { metaKey: mac, ctrlKey: !mac, shiftKey: true });
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  const item = $('.palette-item.sel')?.textContent;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await sleep(100);
  return { grew, shrunk, n, jumped, tries: jumped ? null : tries, item, end: ta.value.slice(-6), focused: document.activeElement === ta };
`, (v) => (v?.grew?.join('|') === 'bold|**bold**|A **bold** word here.' && v.shrunk === '**bold**' && v.n > 5 && v.jumped
  && /gamma/.test(v.item) && v.end === '\ngamma' && v.focused ? null : 'expanding, jumping or pasting from history did not work'));

await check('the tasks of all notes: overdue first; x checks one off in its note, h shows the done ones', `
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyF', 'f');
  press('KeyX', 'x');
  const wrap = await until(() => $('.tasks .task-row') && $('.tasks'));
  const groups = $$('.tasks .task-group h3').map((x) => x.textContent);
  const rows = $$('.tasks .task-row').map((x) => x.querySelector('.task-text').textContent);
  const focused = document.activeElement === wrap;
  key('j'); key('x');
  await until(() => !$$('.tasks .task-row').some((x) => /late one/.test(x.textContent)), 5000);
  const left = $$('.tasks .task-row').map((x) => x.querySelector('.task-text').textContent);
  key('h'); await sleep(100);
  const all = $$('.tasks .task-row').length;
  return { groups, rows, focused, left, all };
`, (v) => (v?.focused && v.groups[0] === 'Overdue' && v.rows.join('|').startsWith('late one|someday') && v.left.join('|') === 'someday' && v.all >= 3 ? null : 'the tasks view did not work'));
{
  const t = fs.readFileSync(path.join(ws, 'tasks.md'), 'utf8');
  const ok = t.includes('- [x] late one');
  console.log(`${ok ? '✓' : '✗'} the task was checked off in its note`);
  if (!ok) failed = true;
}

await check('a run that ends while another note is open says so; its Review button opens it', `
  const mac = navigator.platform.startsWith('Mac');
  const ta = await openNote('expand.md');
  ta.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: mac, ctrlKey: !mac, bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  button('Proofread', o).click(); await sleep(200);
  button('Run on staged copy', o).click();
  await until(() => $('.tab.active')?.textContent.includes('Review'));
  await openNote('macro.md');
  const t = await until(() => !$('#toast').hidden && /Agent is done/.test($('#toast').textContent) && $('#toast'), 20000);
  if (!t) return { error: 'no toast', toast: $('#toast').textContent };
  t.querySelector('.toast-action').click();
  const back = await until(() => $('.tab.active')?.textContent.includes('Review') && document.activeElement === $('.review'));
  key('d');
  const ok = await until(() => button('Discard', $('.dialog.confirm')));
  ok?.click();
  await until(() => /Discarded/.test($('.review')?.textContent || ''), 5000);
  return { toast: t.textContent, back: !!back };
`, (v) => (v?.back && /Review$/.test(v.toast) ? null : 'no word when the run ended'));

await check('M-x (⌥X :) runs a recipe from RECIPES.md by name; the runs, the review and the messages are buffers with the same keys', `
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  const ta = await openNote('buf.md');
  ta.focus();
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('Semicolon', ':', { shiftKey: true });
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>shout';
  input.dispatchEvent(new Event('input'));
  const item = await until(() => $('#overlay .palette-item'));
  const label = item.textContent;
  item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const done = await until(() => !$('#toast').hidden && /done.*Shout/.test($('#toast').textContent), 20000);
  await sleep(200);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('KeyB', 'b');
  press('KeyR', 'r');
  const row = await until(() => document.activeElement?.dataset.tab === 'runs' && $('.runs-buffer .run-row'));
  const runText = row?.textContent;
  key('j'); key('o');
  const review = await until(() => document.activeElement?.classList.contains('review') && /Review: Shout/.test($('.tab.active')?.textContent || ''));
  // In M-x now: the review's own keys first (the same command twice within 150ms runs once).
  await sleep(200);
  press('KeyX', '≈', { altKey: true });
  await until(() => $('.leader'));
  press('Space', ' ');
  const first = await until(() => !$('#overlay').hidden && $('#overlay .palette-item')?.textContent);
  key('Escape', {}, $('#overlay input'));
  await sleep(100);
  $('.review').focus();
  key('q');
  const closed = await until(() => !$$('.tab').some((t) => /Review: Shout/.test(t.textContent)));
  const runsTabs = $$('.tab').filter((t) => /Agent runs/.test(t.textContent)).length;
  return { label, done: !!done, runText, review: !!review, first, closed: !!closed, runsTabs };
`, (v) => (v && /^✦Recipe: Shout.*(⌥X|Alt\+X) r s/.test(v.label) && v.done && /^Shout · /.test(v.runText || '') && v.review && /^◆Review: /.test(v.first || '') && v.closed && v.runsTabs === 1 ? null : 'M-x, recipes or buffers did not work'));

// Suggesting in a meeting, with real keys: the note stays as it is, what is
// typed is pen, a struck line stays in view; a comment beside it; settled
// in the review.
{
  const mac = process.platform === 'darwin';
  const MOD = mac ? 4 : 2;
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
    await sleep(150);
  };
  const letter = (c, modifiers) => key(c, `Key${c.toUpperCase()}`, c.toUpperCase().charCodeAt(0), modifiers);
  const type = (text) => send('Input.insertText', { text });
  const note = path.join(ws, 'sub', 'meet.md');
  const before = fs.readFileSync(note, 'utf8');
  let got = {};
  let problem = null;
  try {
    await inPage(`const ta = await openNote('sub/meet.md'); ta.focus(); const i = ta.value.indexOf('ship') + 4; ta.setSelectionRange(i, i);`);
    await letter('t', MOD | 8);
    got.on = await inPage(`return await until(() => $('.editor-wrap .ed.tracking')) ? $('#status').textContent : null;`);
    await type(' soon');
    await inPage(`const ta = $('.editor-wrap .ed.tracking textarea'); const i = ta.value.indexOf('Docs'); ta.setSelectionRange(i + 2, i + 2);`);
    await letter('x', MOD | 8);
    await inPage(`const ta = $('.editor-wrap .ed.tracking textarea'); const i = ta.value.indexOf('Monday'); ta.setSelectionRange(i, i + 6);`);
    await letter('m', MOD | 1);
    await inPage(`await until(() => $('.mnote input'));`);
    await type('@Mina check the date');
    await key('Enter', 'Enter', 13);
    got.marks = await inPage(`
      await until(() => $('.mnote .mnote-text'));
      const ed = $('.editor-wrap .ed.tracking');
      return { d: $$('.tr-d', ed).map((x) => x.textContent).join(''), i: $$('.tr-i', ed).map((x) => x.textContent).join(''), note: $('.mnote', ed)?.textContent };
    `);
    got.untouched = fs.readFileSync(note, 'utf8') === before;
    let comments = null;
    for (let i = 0; i < 20 && !comments; i++) { await sleep(150); try { comments = JSON.parse(fs.readFileSync(path.join(ws, '.agent-notes', 'comments', 'sub', 'meet.md.json'), 'utf8')); } catch { /* not yet */ } }
    got.comment = comments?.[0] && `${comments[0].speaker}: ${comments[0].comment} on ${comments[0].quote}`;
    await letter('m', MOD | 8);
    got.meeting = await inPage(`await sleep(200); return document.documentElement.classList.contains('meeting') && !$('#sidebar').offsetParent && $('.ed-curline') && !$('.ed-curline').hidden;`);
    await letter('m', MOD | 8);
    await inPage(`
      const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
      press('KeyX', '≈', { altKey: true });
      await until(() => $('.leader'));
      press('KeyP', 'p'); press('KeyV', 'v');
      await until(() => $('.review.mine .pen-card'));
      key('A'); await sleep(200); key('a');
      await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
    `);
    got.after = fs.readFileSync(note, 'utf8');
    got.off = await inPage(`await openNote('sub/meet.md'); await sleep(300); return !$('.editor-wrap .ed.tracking') && $$('.editor-wrap textarea').find((t) => t.offsetParent).value;`);
    if (!/Suggesting/.test(got.on || '')) problem = 'suggesting did not start';
    else if (got.marks?.i !== ' soon' || !got.marks.d.includes('Docs by Friday.') || !got.untouched) problem = 'the marks were not drawn, or the note changed';
    else if (got.comment !== 'Mina: check the date on Monday' || !/@Mina/.test(got.marks.note || '')) problem = 'the comment was not kept beside the note';
    else if (!got.meeting) problem = 'meeting mode did not show';
    else if (got.after !== '# Meet\n\nWe ship soon on Monday.\n' || got.off !== got.after) problem = 'the suggestions were not applied';
  } catch (e) { problem = e.message; }
  const name = 'suggesting: typing in pen and striking a line leave the note as it is; a comment beside it; meeting mode; applied from the review';
  results.push({ name, ok: !problem });
  console.log(`${problem ? '✗' : '✓'} ${name}${problem ? `\n    ${problem}\n    got: ${JSON.stringify(got)}` : ''}`);
  if (problem) failed = true;
}

// Emacs, the second part: narrowing to a section, a folder edited as text
// (the plan reviewed first), describe-key, every command described, and
// keys of your own in LEADER.md.
await check('narrow to a section: only it is edited and found; saved whole; widen', `
  const ta = await openNote('narrow.md');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  ta.focus();
  const at = ta.value.indexOf('alpha');
  ta.setSelectionRange(at, at);
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyN', 'n'); press('KeyN', 'n');
  const part = await until(() => (ta.value.startsWith('## A') ? ta.value : null));
  const chip = $('#status')?.textContent.includes('Narrowed');
  ta.setSelectionRange(ta.value.length, ta.value.length);
  document.execCommand('insertText', false, 'more\\n');
  const mac = navigator.platform.startsWith('Mac');
  press('KeyS', 's', mac ? { metaKey: true } : { ctrlKey: true });
  await sleep(600);
  ta.focus();
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyN', 'n'); press('KeyW', 'w');
  const whole = await until(() => (ta.value.startsWith('# Narrow') ? ta.value : null));
  return { part, chip, whole, after: !$('#status')?.textContent.includes('Narrowed') };
`, (v) => (v?.part === '## A\n\nalpha\n' && v.chip && v.after && v.whole === '# Narrow\n\nintro\n\n## A\n\nalpha\nmore\n\n## B\n\nbeta\n'
  && fs.readFileSync(path.join(ws, 'narrow.md'), 'utf8') === v.whole ? null : 'narrowing did not work'));

await check('dired: a folder edited as text is a plan to review; applied, links follow, a gone line is in the trash', `
  await openNote('dired/keep.md');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyD', 'd');
  const rows = await until(() => ($$('.dired-row').length >= 3 ? $$('.dired-row').map((r) => r.textContent.trim()) : null));
  press('KeyE', 'e');
  const ta = await until(() => document.activeElement?.closest?.('.dired-ed') && document.activeElement);
  const text = ta.value;
  ta.select();
  document.execCommand('insertText', false, 'fresh\\nalpha-2.md\\nkeep.md\\n');
  press('KeyC', 'c', { ctrlKey: true }); press('KeyC', 'c', { ctrlKey: true });
  const plan = await until(() => $('.review.dired .file-card'));
  const says = $$('.hunk-says, .pen-card').map((x) => x.textContent).join(' | ');
  key('A'); await sleep(200); key('a');
  const back = await until(() => ($$('.dired-row').some((r) => r.textContent.includes('alpha-2.md')) ? $$('.dired-row').map((r) => r.textContent.trim()) : null), 8000);
  return { rows, text, plan: !!plan, says, back };
`, (v) => {
  if (!v?.plan || v.text !== 'alpha.md\nkeep.md\nzz-old.md\n') return 'the folder did not open as text';
  if (!/Rename alpha\.md → alpha-2\.md/.test(v.says) || !/zz-old\.md to the trash/.test(v.says) || !/New note/.test(v.says)) return 'the plan did not say what it does';
  if (!v.back || !fs.existsSync(path.join(ws, 'dired', 'alpha-2.md')) || !fs.existsSync(path.join(ws, 'dired', 'fresh.md')) || fs.existsSync(path.join(ws, 'dired', 'zz-old.md'))) return 'the plan was not applied';
  if (fs.readFileSync(path.join(ws, 'cite.md'), 'utf8') !== 'See [[alpha-2]].\n') return 'the link did not follow the rename';
  const trash = path.join(ws, '.agent-notes', 'trash');
  if (!fs.readdirSync(trash).some((d) => fs.existsSync(path.join(trash, d, 'dired', 'zz-old.md')))) return 'the gone note is not in the trash';
  return null;
});

await check('describe a key (⌥X h k): a shortcut and a leader path; every command has a line on what it does', `
  const ta = await openNote('buf.md');
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  const mac = navigator.platform.startsWith('Mac');
  ta.focus();
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyH', 'h'); press('KeyK', 'k');
  await sleep(100);
  press('KeyS', 's', mac ? { metaKey: true } : { ctrlKey: true });
  const save = await until(() => $('.help') && $('.review-head .task', $('.help'))?.textContent === 'Save' && $('.help').textContent);
  (await openNote('buf.md')).focus();
  await sleep(200); // the same command again within 150 ms is taken as one
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyH', 'h'); press('KeyK', 'k');
  await sleep(150);
  press('KeyX', '≈', { altKey: true });
  const head = await until(() => /Describe/.test($('.leader-head')?.textContent || '') && $('.leader-head').textContent);
  press('KeyN', 'n'); press('KeyN', 'n');
  const narrow = await until(() => /Narrow to this section/.test($('.help .review-head .task')?.textContent || '') && $('.help').textContent);
  (await openNote('buf.md')).focus();
  await sleep(200);
  press('KeyX', '≈', { altKey: true }); await until(() => $('.leader'));
  press('KeyH', 'h'); press('KeyC', 'c');
  await until(() => $$('#overlay .palette-item').length);
  const bare = $$('#overlay .palette-item').filter((x) => !$('.hint', x)).map((x) => x.textContent);
  key('Escape', {}, $('#overlay input'));
  return { save: (save || '').slice(0, 300), head, narrow: (narrow || '').slice(0, 800) || $('.help .review-head .task')?.textContent, bare };
`, (v) => (/Writes the note to disk/.test(v?.save) && /(⌘S|Ctrl\+S)/.test(v.save) && /(⌥X|Alt\+X) n n/.test(v.narrow) && /Shows only the section/.test(v.narrow)
  ? (v.bare.length ? `commands without a line on what they do: ${v.bare.join(', ')}` : null) : 'describe-key did not work'));

{
  // LEADER.md: a group of yours, a key moved, one taken away; a line that
  // can't be followed is left out with a warning.
  fs.writeFileSync(path.join(ws, 'LEADER.md'), '# Leader keys\n\n- `o` +mine\n- `o w` Widen: show the whole note\n- `z` No such command\n- `k` off\n');
  await check('keys of your own (LEADER.md): in the menu and in describe-key; a bad line is left out with a warning', `
    await openNote('buf.md');
    const warned = await until(() => !$('#toast').hidden && /LEADER\\.md line 5/.test($('#toast').textContent) && $('#toast').textContent, 8000);
    const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
    press('KeyX', '≈', { altKey: true });
    const menu = await until(() => $('.leader'));
    const top = $$('.leader-item', menu).map((b) => b.dataset.key);
    press('KeyO', 'o');
    await sleep(50);
    const mine = $$('.leader-item', menu).map((b) => b.textContent).join(' | ');
    press('Escape', 'Escape');
    return { warned, hasO: top.includes('o'), hasK: top.includes('k'), hasZ: top.includes('z'), mine };
  `, (v) => (v?.warned && v.hasO && !v.hasK && !v.hasZ && /w.*Widen/.test(v.mine) ? null : 'the leader keys of LEADER.md were not followed'));
}

console.log(failed ? `\nSmoke test failed (${results.filter((r) => !r.ok).length} of ${results.length + 4}).` : `\nAll ${results.length + 4} checks passed.`);
done(failed ? 1 : 0);
