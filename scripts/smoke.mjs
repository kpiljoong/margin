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
fs.writeFileSync(path.join(ws, 'dots.md'), '# Dots\n\n![Screen](assets/screen.svg)\n\n1. First thing\n2. Second thing\n');
fs.writeFileSync(path.join(ws, 'shot.md'), '# Shot\n\n![Screen](assets/screen.svg)\n\nAfter.\n');
fs.writeFileSync(path.join(ws, 'sketch.md'), '# Sketch\n\nTalk.\n');
fs.writeFileSync(path.join(ws, 'elbow.md'), '# Route\n\n```ink\nboard: 1600x900\nbox: 100,300 300x150\ntext: 150,350 Start\nbox: 600,280 200x190\ntext: 640,350 Middle\nbox: 1100,300 300x150\ntext: 1150,350 End\narrow elbow: 400,375 -> 1100,375\n```\n');
fs.writeFileSync(path.join(ws, 'looks.md'), '# Looks\n\n```ink\nboard: 1600x900\nbox: 100,100 400x200\ntext: 130,140 A long line of words that wraps in its box\narrow: 500,200 -> 900,200\n```\n\nAfter.\n');
fs.writeFileSync(path.join(ws, 'sketchflow.md'), '# Board\n\n```ink\nboard: 1600x900\nbox: 100,100 300x120\ntext: 130,140 Idea\nbox: 100,500 300x120\ntext: 130,540 Try it\narrow: 250,230 -> 250,490\n```\n\nAfter.\n');
// Lines for a keyboard macro, and notes to run one at every search result.
fs.writeFileSync(path.join(ws, 'macro.md'), 'apple\nbanana\ncherry');
fs.writeFileSync(path.join(ws, 'emacs.md'), 'one two three\nfour five\nsix\n');
fs.writeFileSync(path.join(ws, 'kept.md'), 'one\ntwo\n');
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
fs.writeFileSync(path.join(ws, 'sub', 'lens.md'), '# Lens\n\nWe ship on Friday.\n\nEveryone obviously wants a very dark theme.\n\nThe launch is on Monday.\n');
fs.writeFileSync(path.join(ws, 'sub', 'locked.md'), '# Locked\n\nThe team is very ready.\n\nWe want a very dark theme.\n');
fs.writeFileSync(path.join(ws, 'sub', 'fork.md'), '# Fork\n\nWe ship on Friday. The team is ready.\n\nThe end.\n');
fs.writeFileSync(path.join(ws, 'sub', 'drawn.md'), '# Drawn\n\n```flow\nOrder -> Pay -> Ship\n```\n\n![Screen](../assets/screen.svg)\n\n```ink\nbox blue: 10,10 50x40\n```\n');
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

await check('groups on a flow: Shift-click two boxes, \u2318G names them a group; a double-click on its title renames it, a right-click ungroups it', `
  const stage = $('.canvas-stage');
  const flow = () => { const v = $$('.editor-wrap textarea').find((t) => t.offsetParent).value; return v.slice(v.indexOf('\`\`\`flow') + 8, v.lastIndexOf('\`\`\`')).trim(); };
  const box = (name) => $$('.node-hit').find((b) => b.closest('pre').flowNodes?.find((n) => n.id === b.dataset.id)?.text === name);
  const at = (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }; };
  const mod = navigator.platform.startsWith('Mac') ? { metaKey: true } : { ctrlKey: true };
  const out = {};
  await until(() => box('A') && box('B'), 15000); await sleep(400);
  box('A').click(); await sleep(200);
  box('B').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, shiftKey: true, ...at(box('B')) }));
  out.picked = $$('.node-hit.picked').length;
  stage.focus(); key('g', mod, stage);
  const name = await until(() => $('#overlay:not([hidden]) input'), 4000);
  if (!name) return { ...out, dialog: false };
  name.value = 'Start';
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => flow().startsWith('Start:'), 8000);
  out.grouped = flow();
  const title = await until(() => $('.group-hit'), 15000);
  if (!title) return { ...out, title: false };
  title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...at(title) }));
  const input = await until(() => $('.canvas-rename'), 4000);
  if (!input) return { ...out, rename: false };
  input.value = 'First';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => flow().startsWith('First:'), 8000);
  out.renamed = flow();
  const again = await until(() => $('.group-hit') !== title && $('.group-hit'), 15000);
  again.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at(again) }));
  (await until(() => button('Ungroup'), 3000))?.click();
  await until(() => !flow().startsWith('First:'), 8000);
  out.ungrouped = flow();
  return out;
`, (v) => (v?.picked === 2 && v.grouped === 'Start:\n  A\n  B\nA -> B -> (C)\ncolor blue: B' && v.renamed === 'First:\n  A\n  B\nA -> B -> (C)\ncolor blue: B' && v.ungrouped === 'A -> B -> (C)\ncolor blue: B' ? null : `got ${JSON.stringify(v)}`));

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

await check('numbered dots on a picture: N puts the next number; its list item at the cursor lights it; in the preview the item and the dot light each other', `
  await openNote('dots.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const img = () => $('.canvas-stage .ink-figure img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  const stage = $('.canvas-stage');
  const ed = () => $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const pt = (fx, fy) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const out = {};
  img().dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
  stage.focus(); key('n', {}, stage);
  ptr('pointerdown', img(), pt(0.3, 0.3)); ptr('pointerup', stage, pt(0.3, 0.3));
  await until(() => ed().value.includes('num red: 120,90 1'), 8000);
  await until(() => $('.canvas-stage .ink-mark[data-num="1"]'), 8000);
  ptr('pointerdown', img(), pt(0.6, 0.6)); ptr('pointerup', stage, pt(0.6, 0.6));
  await until(() => ed().value.includes('num red: 240,180 2'), 8000);
  out.text = ed().value;
  key('Escape', {}, stage);
  await until(() => $('.canvas-stage .ink-mark[data-num="2"]'), 8000);
  const t = ed();
  const at = t.value.indexOf('2. Second');
  t.focus(); t.setSelectionRange(at + 3, at + 3);
  t.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowRight' }));
  out.lit = (await until(() => $('.canvas-stage .ink-mark.ink-at'), 4000))?.dataset.num;
  button('Preview').click();
  const li = await until(() => $$('.ink-mark[data-num="1"]').some((m) => !m.closest('.canvas-stage')) && $('.preview li[data-callout="1"], .md li[data-callout="1"]'), 8000);
  li?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  await sleep(100);
  out.hot = $$('.ink-mark.ink-hot').map((g) => g.dataset.num).join();
  li?.closest('.md')?.querySelector('h1')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
  out.cold = !$('.ink-mark.ink-hot');
  button('Canvas').click();
  return out;
`, (v) => (v?.text?.endsWith('```ink\nnum red: 120,90 1\nnum red: 240,180 2\n```\n\n1. First thing\n2. Second thing\n') && v.lit === '2' && v.hot === '1' && v.cold ? null : `got ${JSON.stringify(v)}`));

await check('hiding a part of a picture: H covers it, and the task dialog says the picture goes with it covered', `
  const ed = () => $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const img = () => $('.canvas-stage .ink-figure img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  const stage = $('.canvas-stage');
  const pt = (fx, fy) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  img().dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
  stage.focus(); key('h', {}, stage);
  ptr('pointerdown', img(), pt(0.1, 0.1)); ptr('pointermove', stage, pt(0.2, 0.15)); ptr('pointerup', stage, pt(0.3, 0.2));
  await until(() => ed().value.includes('hide gray:'), 8000);
  const out = { line: /hide gray: .*/.exec(ed().value)?.[0] };
  key('Escape', {}, stage);
  out.drawn = !!(await until(() => $('.canvas-stage .ink-mark[data-hide]'), 8000));
  await sleep(1200); // saved, so the dialog's scope reads it
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  const task = $('textarea', o);
  task.value = 'Mark up the picture'; task.dispatchEvent(new Event('input'));
  out.list = (await until(() => /picture/.test($('.scope-files', o)?.innerText || '') && $('.scope-files', o).innerText, 5000)) || '';
  key('Escape', {}, task);
  return out;
`, (v) => (v?.line === 'hide gray: 40,30 40x15' && v.drawn && v.list.includes('assets/screen.svg (picture, parts hidden)') ? null : `got ${JSON.stringify(v)}`));

await check('an arrow: clicks draw it point by point (a double-click ends it), a drag draws it straight; A again changes its kind (with a Korean input source on too)', `
  const ed = () => $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const img = () => $('.canvas-stage .ink-figure img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  const stage = $('.canvas-stage');
  const pt = (fx, fy) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const click = (fx, fy) => { ptr('pointerdown', img(), pt(fx, fy)); ptr('pointerup', stage, pt(fx, fy)); };
  img().dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(300);
  stage.focus(); key('a', {}, stage);
  click(0.5, 0.5); click(0.8, 0.5);
  ptr('pointermove', stage, pt(0.7, 0.7));
  const following = !!$('.canvas-stage .ink-draft');
  click(0.8, 0.8); click(0.8, 0.8);
  await until(() => ed().value.includes('arrow red: 200,150 ->'), 8000);
  const sharp = await until(() => $$('.canvas-stage .ink-mark:not(.ink-draft) path').some((p) => p.getAttribute('d') === 'M200,150 L320,150 L320,240'), 8000);
  await sleep(500); // drawn again
  ptr('pointerdown', img(), pt(0.1, 0.9));
  for (let i = 1; i <= 10; i++) ptr('pointermove', stage, pt(0.1 + 0.02 * i, 0.9 - (i < 6 ? 0 : 0.04 * (i - 5))));
  ptr('pointerup', stage, pt(0.3, 0.7));
  await until(() => ed().value.includes('arrow red: 40,270 ->'), 8000);
  await sleep(300);
  const kinds = [];
  // The second A typed with a Korean input source on: the key's letter is \u3141.
  for (let i = 0; i < 3; i++) { key(i === 1 ? '\u3141' : 'a', { code: 'KeyA' }, stage); kinds.push($('.ink-bar .ink-tool.on')?.title.split(':')[0]); }
  key('Escape', {}, stage);
  return { lines: ed().value.split('\\n').filter((l) => l.startsWith('arrow')), following, sharp: !!sharp, kinds, off: !$('.ink-bar .ink-tool.on') };
`, (v) => (v?.lines?.join('|') === 'arrow red: 200,150 -> 320,150 -> 320,240|arrow red: 40,270 -> 120,210' && v.following && v.sharp && v.kinds.join('|') === 'Arrow, curved|Arrow, elbow|Arrow, straight' && v.off ? null : `got ${JSON.stringify(v)}`));

await check('changing marks with no tool on: a drag moves one, a corner reshapes it, Delete takes the picked one out', `
  const ed = () => $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const img = () => $('.canvas-stage .ink-figure img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  const stage = $('.canvas-stage');
  const at = (x, y) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * x / 400, clientY: r.top + r.height * y / 300 }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const under = (x, y) => { const p = at(x, y); return document.elementFromPoint(p.clientX, p.clientY); };
  const drag = async (x, y, dx, dy, want) => {
    const el = under(x, y);
    ptr('pointerdown', el, at(x, y));
    for (let i = 1; i <= 5; i++) ptr('pointermove', stage, at(x + dx * i / 5, y + dy * i / 5));
    ptr('pointerup', stage, at(x + dx, y + dy));
    await until(() => ed().value.includes(want), 8000);
    await until(() => $('.canvas-stage .ink-mark.ink-picked'), 8000);
    return el?.getAttribute('class');
  };
  img().dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(500);
  const out = {};
  out.dot = await drag(120, 90, 40, 30, 'num red: 160,120 1');
  const hide = under(60, 37);
  ptr('pointerdown', hide, at(60, 37)); ptr('pointerup', hide, at(60, 37)); hide.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.grips = (await until(() => $$('.canvas-stage .ink-grip').length === 4 && 4, 4000)) || $$('.canvas-stage .ink-grip').length;
  out.corner = await drag(80, 45, 40, 30, 'hide gray: 40,30 80x45');
  stage.focus(); key('Delete', {}, stage);
  await until(() => !ed().value.includes('hide gray'), 8000);
  out.lines = ed().value.split('\\n').filter((l) => /^(num|hide|arrow)/.test(l));
  return out;
`, (v) => (v?.dot === 'ink-hit' && v.grips === 4 && v.corner === 'ink-grip' && v.lines.join('|') === 'num red: 160,120 1|num red: 240,180 2|arrow red: 200,150 -> 320,150 -> 320,240|arrow red: 40,270 -> 120,210' ? null : `got ${JSON.stringify(v)}`));

await check('a sketch: + Sketch adds a blank board with the pen up; a line drawn past its edge is a line of the block, and the board grows', `
  const ed = await openNote('sketch.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  ed.setSelectionRange(ed.value.length, ed.value.length);
  (await until(() => button('+ Sketch'), 8000)).click();
  const img = () => $('.canvas-stage .ink-board img');
  if (!(await until(() => img()?.naturalWidth, 15000))) return { none: true };
  await sleep(500);
  const stage = $('.canvas-stage');
  const text = () => $$('.editor-wrap textarea').find((t) => t.offsetParent).value;
  const pt = (fx, fy) => { const r = img().getBoundingClientRect(); return { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }; };
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const out = { pen: $('.ink-tool.on')?.title, keys: document.activeElement === stage };
  ptr('pointerdown', img(), pt(0.1, 0.1));
  for (let i = 1; i <= 6; i++) ptr('pointermove', stage, pt(0.1 + i * 0.05, 0.1 + i * 0.2));
  ptr('pointerup', stage, pt(0.4, 1.3));
  await until(() => text().includes('pen black'), 8000);
  out.text = text();
  out.tall = (await until(() => img()?.naturalHeight > 900 && img().naturalHeight, 8000)) || img()?.naturalHeight;
  out.still = document.activeElement === stage;
  key('Escape', {}, stage);
  return out;
`, (v) => (v?.pen?.startsWith('Pen') && v.keys && v.still && /^# Sketch\n\nTalk\.\n\n```ink\nboard: 1600x(1[0-9]00)\npen black: [\d, ]+\n```\n$/.test(v.text) && v.tall > 900 ? null : `got ${JSON.stringify(v)}`));

await check('a comment on the sketch: M, a click, the words; a bubble on it and a card in the margin', `
  const stage = $('.canvas-stage');
  const img = () => $('.canvas-stage .ink-board img');
  if (!img()?.naturalWidth) return { none: true };
  stage.focus();
  key('m', {}, stage);
  const tool = $('.ink-tool.on')?.title;
  const r = img().getBoundingClientRect();
  const p = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 4 };
  const ptr = (type, el) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  ptr('pointerdown', img());
  ptr('pointerup', stage);
  const input = await until(() => $('.canvas-rename'), 4000);
  if (!input) return { tool, input: false };
  input.value = '@Mina \uC5EC\uAE30 \uB2E4\uC2DC';
  key('Enter', {}, input);
  const pin = await until(() => $('.canvas-stage .ink-board .cpin'), 4000);
  const card = await until(() => $$('.mnote').find((c) => c.textContent.includes('on the sketch')), 4000);
  return { tool, pin: pin?.textContent, left: pin?.style.left, card: !!card };
`, (v) => (v?.tool?.startsWith('Comment') && v.pin === '@Mina\uC5EC\uAE30 \uB2E4\uC2DC' && Math.abs(parseFloat(v.left) - 50) < 1 && v.card ? null : `got ${JSON.stringify(v)}`));

await check('a sketch read as a flow: its boxes, words and arrows as a ```flow block below it, drawn on the canvas', `
  const ed = await openNote('sketchflow.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const board = await until(() => $('.canvas-stage .ink-board img')?.naturalWidth && $('.canvas-stage .ink-board'), 15000);
  if (!board) return { none: true };
  board.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
  (await until(() => button('Read it as a flow'), 3000))?.click();
  await until(() => ed.value.includes('\\x60\\x60\\x60flow'), 5000);
  const boxes = await until(() => $$('.canvas-stage pre[data-lang="flow"] .node-hit').length, 15000);
  return { text: ed.value, boxes, toast: $('#toast')?.textContent };
`, (v) => (v?.text === '# Board\n\n```ink\nboard: 1600x900\nbox: 100,100 300x120\ntext: 130,140 Idea\nbox: 100,500 300x120\ntext: 130,540 Try it\narrow: 250,230 -> 250,490\n```\n\n```flow\nIdea -> Try it\n```\n\nAfter.\n' && v.boxes === 2 && /A flow of 2 steps and 1 arrow/.test(v.toast) ? null : `got ${JSON.stringify(v)}`));

await check('on a sketch: a double-click in a box changes its words; an arrow drawn between boxes ends on their sides, made elbow by a right-click', `
  const ed = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const pic = () => $('.canvas-stage .ink-board img');
  const img = pic();
  if (!img?.naturalWidth) return { none: true };
  const at = (x, y) => { const img = pic(); const r = img.getBoundingClientRect(); return { clientX: r.left + x * r.width / img.naturalWidth, clientY: r.top + y * r.height / img.naturalHeight }; };
  img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...at(300, 200) }));
  const input = await until(() => $('.canvas-rename'), 3000);
  const was = input?.value;
  if (!input) return { input: false };
  input.value = 'Big idea';
  key('Enter', {}, input);
  // The sketch drawn again with them.
  await until(() => $('.canvas-stage .ink-board')?.dataset.source.includes('Big idea') && pic()?.naturalWidth, 5000);
  await sleep(300);
  $$('.ink-bar .ink-tool').find((b) => b.title.startsWith('Arrow')).click();
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const stage = $('.canvas-stage');
  const board = pic();
  ptr('pointerdown', board, at(300, 240));
  for (let i = 1; i <= 6; i++) ptr('pointermove', stage, at(300, 240 + i * 40));
  ptr('pointerup', stage, at(300, 480));
  await until(() => ed.value.includes('250,220 -> 250,500'), 5000);
  key('Escape', {}, stage);
  // Right-click the arrow: elbow.
  const drawn = await until(() => { const f = $('.canvas-stage .ink-board'); return f?.dataset.source.includes('250,220 -> 250,500') && f.inkMarks?.find((m) => m.kind === 'arrow' && m.from[1] === 220) && f; }, 5000);
  const line = drawn?.inkMarks.find((m) => m.kind === 'arrow' && m.from[1] === 220).line;
  drawn?.querySelector(\`.ink-mark[data-line="\${line}"] .ink-hit\`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(250, 360) }));
  const kinds = $$('.ctx-menu .ctx-item').map((b) => b.textContent);
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.startsWith('Elbow'))?.click();
  await until(() => / elbow: 250,220 -> 250,500/.test(ed.value), 5000);
  return { was, kinds, text: ed.value.split('\x60\x60\x60')[1] };
`, (v) => (v?.was === 'Idea' && /text: 130,140 Big idea\n/.test(v.text) && /\narrow[^\n]* elbow: 250,220 -> 250,500\n/.test(v.text) && v.kinds.join('|') === 'Straight ✓|Curved|Elbow|Words on it…|Colour…C|Delete' ? null : `got ${JSON.stringify(v)}`));

await check('on a sketch: Shift and a drag picks marks; a drag moves them all (an arrow on a box goes along); copied, pasted aside, and taken out', `
  const ed = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const pic = () => $('.canvas-stage .ink-board img');
  if (!pic()?.naturalWidth) return { none: true };
  const at = (x, y) => { const img = pic(); const r = img.getBoundingClientRect(); return { clientX: r.left + x * r.width / img.naturalWidth, clientY: r.top + y * r.height / img.naturalHeight }; };
  const stage = $('.canvas-stage');
  const ptr = (type, el, p, more = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p, ...more }));
  const picked = () => $$('.canvas-stage .ink-board .ink-mark.ink-picked').length;
  // The sketch drawn again since the last change; nothing picked.
  await until(() => $('.canvas-stage .ink-board')?.dataset.source.includes(' elbow: ') && pic()?.naturalWidth, 5000);
  await sleep(300);
  key('Escape', {}, stage);
  ptr('pointerdown', pic(), at(50, 450), { shiftKey: true });
  for (let i = 1; i <= 5; i++) ptr('pointermove', stage, at(50 + 80 * i, 450 + 50 * i), { shiftKey: true });
  ptr('pointerup', stage, at(450, 700), { shiftKey: true });
  const out = { picked: picked(), frame: !!$('.canvas-stage .ink-selbox') };
  const f = $('.canvas-stage .ink-board');
  const box = f.inkMarks.find((m) => m.kind === 'box' && m.y === 500);
  const hit = f.querySelector(\`.ink-mark[data-line="\${box.line}"] .ink-hit\`);
  ptr('pointerdown', hit, at(100, 560));
  for (let i = 1; i <= 5; i++) ptr('pointermove', stage, at(100 + 20 * i, 560));
  ptr('pointerup', stage, at(200, 560));
  await until(() => ed.value.includes('box: 200,500 300x120'), 5000);
  out.moved = ed.value.split('\x60\x60\x60')[1];
  out.still = await until(() => $('.canvas-stage .ink-board')?.dataset.source.includes('box: 200,500') && picked() === 2, 5000);
  const dt = new DataTransfer();
  stage.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  out.copied = dt.getData('text/plain');
  const dt2 = new DataTransfer();
  dt2.setData('text/plain', out.copied);
  stage.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt2, bubbles: true, cancelable: true }));
  await until(() => ed.value.includes('box red: 220,520 300x120'), 5000);
  out.pasted = await until(() => $('.canvas-stage .ink-board')?.dataset.source.includes('box red: 220,520') && picked() === 2, 5000);
  key('Delete', {}, stage);
  await until(() => !ed.value.includes('box red: 220,520'), 5000);
  out.after = ed.value.split('\x60\x60\x60')[1];
  return out;
`, (v) => (v?.picked === 2 && v.frame && /\nbox: 200,500 300x120\ntext: 230,540 Try it\n/.test(v.moved) && / elbow: 250,220 -> 350,500\n/.test(v.moved) && /\narrow: 250,230 -> 250,490\n/.test(v.moved)
  && v.still && v.copied === 'box: 200,500 300x120\ntext: 230,540 Try it' && v.pasted && v.after === v.moved ? null : `got ${JSON.stringify(v)}`));

await check('on a sketch: the arrow tool shows the anchor a press takes; an elbow arrow goes round a box, a part of it dragged, routed again; a box moved takes its words', `
  const ed = await openNote('elbow.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const pic = () => $('.canvas-stage .ink-board img');
  const fig = () => $('.canvas-stage .ink-board');
  await until(() => pic()?.naturalWidth, 15000);
  pic().dispatchEvent(new MouseEvent('click', { bubbles: true, ...(() => { const r = pic().getBoundingClientRect(); return { clientX: r.left + 5, clientY: r.top + 5 }; })() }));
  await until(() => $('.canvas-stage .ink-figure.ink-editable'), 5000);
  await sleep(500);
  const at = (x, y) => { const img = pic(); const r = img.getBoundingClientRect(); return { clientX: r.left + x * r.width / img.naturalWidth, clientY: r.top + y * r.height / img.naturalHeight }; };
  const stage = $('.canvas-stage');
  const ptr = (type, el, p, more = {}) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p, ...more }));
  const ink = () => ed.value.split('\x60\x60\x60')[1];
  const out = {};
  // The arrow tool over a box: its anchors, the top one taken.
  $$('.ink-bar .ink-tool').find((b) => b.title.startsWith('Arrow')).click();
  ptr('pointermove', pic(), at(700, 260));
  const on = $('.canvas-stage .ink-hover .ink-anchor.on');
  out.hover = on ? [Number(on.getAttribute('cx')), Number(on.getAttribute('cy'))] : null;
  key('Escape', {}, stage);
  out.gone = !$('.canvas-stage .ink-hover');
  // The arrow picked: a dot on each of its parts (round the box: five).
  const arrow = fig().inkMarks.find((m) => m.kind === 'arrow');
  const hit = fig().querySelector(\`.ink-mark[data-line="\${arrow.line}"] .ink-hit\`);
  ptr('pointerdown', hit, at(700, 490)); ptr('pointerup', stage, at(700, 490));
  const parts = await until(() => $$('.canvas-stage .ink-part').length, 3000);
  out.parts = parts;
  const below = $('.canvas-stage .ink-part[data-part="2"]');
  if (!below) return out;
  ptr('pointerdown', below, at(700, 490));
  for (let i = 1; i <= 5; i++) ptr('pointermove', stage, at(700, 490 + 42 * i));
  ptr('pointerup', stage, at(700, 700));
  await until(() => ed.value.includes('560,700'), 5000);
  out.own = ink();
  // Right-click: routed again.
  await until(() => fig()?.dataset.source.includes('560,700'), 5000);
  await sleep(300);
  const line = fig().inkMarks.find((m) => m.kind === 'arrow').line;
  fig().querySelector(\`.ink-mark[data-line="\${line}"] .ink-hit\`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(700, 700) }));
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.startsWith('Route it again'))?.click();
  await until(() => ed.value.includes('elbow: 400,375 -> 1100,375'), 5000);
  out.again = ink();
  // The middle box moved up: its words go along.
  await until(() => !fig()?.dataset.source.includes('560,700'), 5000);
  await sleep(300);
  key('Escape', {}, stage);
  const box = fig().inkMarks.find((m) => m.kind === 'box' && m.x === 600);
  const edge = fig().querySelector(\`.ink-mark[data-line="\${box.line}"] .ink-hit\`);
  ptr('pointerdown', edge, at(700, 280));
  for (let i = 1; i <= 5; i++) ptr('pointermove', stage, at(700, 280 - 30 * i));
  ptr('pointerup', stage, at(700, 130));
  await until(() => ed.value.includes('box: 600,130 200x190'), 5000);
  out.moved = ink();
  return out;
`, (v) => (v?.hover?.join() === '700,280' && v.gone && v.parts === 5
  && / elbow: 400,375 -> 560,375 -> 560,700 -> 840,700 -> 840,375 -> 1100,375\n/.test(v.own)
  && / elbow: 400,375 -> 1100,375\n/.test(v.again)
  && /\nbox: 600,130 200x190\ntext: 640,200 Middle\n/.test(v.moved) ? null : `got ${JSON.stringify(v)}`));

await check('on a sketch: words in a box wrap to it; C recolours the marks picked; a box made an ellipse, filled; an arrow given words; the sketch picked whole, deleted, back with \u2318Z', `
  const ed = await openNote('looks.md');
  if (!$('.canvas-pane')?.offsetParent) button('Canvas').click();
  const pic = () => $('.canvas-stage .ink-board img');
  const fig = () => $('.canvas-stage .ink-board');
  await until(() => pic()?.naturalWidth, 15000);
  const at = (x, y) => { const img = pic(); const r = img.getBoundingClientRect(); return { clientX: r.left + x * r.width / img.naturalWidth, clientY: r.top + y * r.height / img.naturalHeight }; };
  const stage = $('.canvas-stage');
  const ptr = (type, el, p) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1, ...p }));
  const hitOf = (kind) => { const m = fig().inkMarks.find((x) => x.kind === kind); return fig().querySelector(\`.ink-mark[data-line="\${m.line}"] .ink-hit\`); };
  const ink = () => ed.value.split('\x60\x60\x60')[1];
  const drawn = (s) => until(() => fig()?.dataset.source.includes(s) && pic()?.naturalWidth, 5000).then(() => sleep(300));
  const out = {};
  // A click beside the marks: looked at, and picked whole.
  pic().dispatchEvent(new MouseEvent('click', { bubbles: true, ...at(1300, 700) }));
  await until(() => $('.canvas-stage .ink-figure.ink-editable'), 5000);
  await sleep(500);
  out.whole = !!$('.canvas-stage .ink-board.ink-whole');
  out.lines = fig().querySelectorAll('text tspan').length;
  key('Escape', {}, stage);
  out.unpicked = !$('.canvas-stage .ink-whole');
  // The box picked, C: green.
  ptr('pointerdown', hitOf('box'), at(100, 200)); ptr('pointerup', stage, at(100, 200));
  key('\u314A', { code: 'KeyC' }, stage);
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.startsWith('Green'))?.click();
  await until(() => ed.value.includes('box green: 100,100'), 5000);
  // A right-click on it: an ellipse (its words moved into it), then filled.
  await drawn('box green');
  hitOf('box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(100, 200) }));
  out.menu = $$('.ctx-menu .ctx-item').map((b) => b.textContent).join('|');
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.startsWith('Ellipse'))?.click();
  await until(() => ed.value.includes('box green round:'), 5000);
  await drawn('round');
  hitOf('box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ...at(100, 200) }));
  $$('.ctx-menu .ctx-item').find((b) => b.textContent.startsWith('Filled'))?.click();
  await until(() => ed.value.includes('box green round filled:'), 5000);
  await drawn('filled');
  out.ellipse = !!fig().querySelector('.ink-mark ellipse');
  // A double-click on the arrow: its words.
  hitOf('arrow').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, ...at(700, 200) }));
  const input = await until(() => $('.canvas-rename'), 3000);
  if (!input) return out;
  input.value = 'sends';
  key('Enter', {}, input);
  await until(() => ed.value.includes('"sends"'), 5000);
  out.looks = ink();
  await drawn('"sends"');
  out.label = [...fig().querySelectorAll('.ink-mark text')].some((t) => t.textContent === 'sends');
  // Picked whole: Backspace takes the block out; \u2318Z brings it back.
  pic().dispatchEvent(new MouseEvent('click', { bubbles: true, ...at(1300, 700) }));
  await until(() => $('.canvas-stage .ink-whole'), 3000);
  key('Backspace', {}, stage);
  out.gone = await until(() => ed.value === '# Looks\\n\\nAfter.\\n', 5000) && $('#toast')?.textContent;
  key('z', { metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac') }, $('.canvas-stage'));
  out.back = await until(() => ed.value.includes('"sends"'), 5000);
  return out;
`, (v) => (v?.whole && v.lines >= 3 && v.unpicked && v.menu === 'Rectangle ✓|Ellipse|Filled|Colour…C|Delete' && v.ellipse
  && /\nbox green round filled: 100,100 400x200\ntext: 180,157 A long line/.test(v.looks) && /\narrow: 500,200 -> 900,200 "sends"\n/.test(v.looks)
  && v.label && /^Sketch deleted\./.test(v.gone || '') && v.back ? null : `got ${JSON.stringify(v)}`));

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
`, (v) => (v?.focused && v.groups === 'fsbwmnexlgartpqh' && v.files && v.quick && v.quickValue === '' && !v.typedInEditor && v.paletteValue === '>' && v.from === 'flow.md' && v.moved && v.opened && v.back ? null : 'the leader key did not work'));

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

// Emacs keys (Settings), with real keys: on Windows and Linux too, where
// Ctrl+W, Ctrl+X and Ctrl+S are the app's menu keys when the setting is off.
{
  const CODE = { ' ': ['Space', 32], '%': ['Digit5', 53], '<': ['Comma', 188], '>': ['Period', 190], '/': ['Slash', 191], '=': ['Equal', 187], '@': ['Digit2', 50] };
  // "C-x", "M-%", "C-SPC", "RET", "ESC", a letter.
  const press = async (combo) => {
    let mods = 0;
    let k = combo;
    for (let m; (m = /^([CMS])-(.+)$/.exec(k)); k = m[2]) mods |= { C: 2, M: 1, S: 8 }[m[1]];
    k = { SPC: ' ', RET: 'Enter', ESC: 'Escape', TAB: 'Tab' }[k] || k;
    if ('%<>@'.includes(k)) mods |= 8;
    const [code, vk] = CODE[k] || (k.length === 1 ? [`Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0)] : [k, { Enter: 13, Escape: 27, Tab: 9, ArrowRight: 39 }[k]]);
    const text = !(mods & 7) && k.length === 1 ? k : undefined;
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await sleep(40);
  };
  const keys = async (seq) => { for (const k of seq.split(' ')) await press(k); await sleep(150); };
  const state = () => inPage(`const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent); return { v: ta?.value, s: ta?.selectionStart, e: ta?.selectionEnd, tab: $('.tab.active')?.textContent, echo: $('#status .echo')?.textContent || '' };`);
  const setting = (on) => inPage(`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
    const d = await until(() => $('.dialog.settings'));
    const box = $$('.set-toggle', d).find((l) => l.textContent.includes('Emacs keys'))?.querySelector('input');
    if (box && box.checked !== ${on}) box.click();
    button('Done', d)?.click();
    return box?.checked;
  `);
  const got = {};
  let problem = null;
  try {
    if (!(await setting(true))) throw new Error('no Emacs keys setting');
    await inPage(`const ta = await openNote('emacs.md'); ta.focus(); ta.setSelectionRange(0, 0);`);
    // Kills in a row are one; C-y puts it back; C-w kills the region (and not the tab), M-y the kill before.
    await keys('C-k C-k C-e C-y');
    got.yank = await state();
    await keys('M-< C-SPC M-f C-x C-x C-x C-x C-w');
    got.region = await state();
    await keys('C-y M-y');
    got.yankPop = await state();
    // C-u 3 then a letter: three of it; ESC f is M-f.
    await inPage(`const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent); ta.focus(); ta.select(); document.execCommand('insertText', false, 'cat dog cat\\nbird cat\\n'); ta.setSelectionRange(0, 0);`);
    await keys('C-u 3 x ESC f');
    got.arg = await state();
    // Query replace: y, n, then ! for the rest.
    await keys('M-< M-%');
    await inPage(`const i = await until(() => document.activeElement.matches?.('.ed-find-input') && document.activeElement); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));`);
    await send('Input.insertText', { text: 'cat' });
    await keys('RET');
    await send('Input.insertText', { text: 'CAT' });
    await keys('RET');
    await sleep(200);
    await keys('y n');
    got.query = await state();
    await keys('!');
    got.queryAll = await state();
    // C-x and a pause: the keys after it show; C-g hides them.
    await keys('C-x');
    await sleep(1100);
    got.help = await inPage(`return $('#prefix-keys')?.textContent || '';`);
    await keys('C-g');
    got.helpGone = await inPage(`return !$('#prefix-keys');`);
    // C-x C-s saves.
    await keys('C-x C-s');
    await sleep(400);
    got.saved = fs.readFileSync(path.join(ws, 'emacs.md'), 'utf8');
    // Occur (M-s o): its lines in a buffer; Enter on one goes there.
    await keys('M-s o');
    await inPage(`const i = await until(() => $('.dialog input')); i.value = 'cat';`);
    await keys('RET');
    got.occur = await inPage(`await until(() => $$('.occur-row').length); return $$('.occur-row').map((r) => r.textContent);`);
    await keys('j j RET');
    got.occurAt = await inPage(`await sleep(300); const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent); return ta && document.activeElement === ta ? ta.value.slice(0, ta.selectionStart).split('\\n').length : null;`);
    // M-x knows Emacs's names: its own commands (kill-line) and Margin's (save-buffer is Save).
    got.mx = await inPage(`
      const ask = async (q) => {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyX', key: '\u2248', altKey: true, bubbles: true, cancelable: true }));
        await until(() => $('.leader'));
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }));
        const input = await until(() => $('.dialog.palette input'));
        input.value = '>' + q;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const first = $('.palette-item')?.textContent;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await sleep(100);
        return first;
      };
      return [await ask('kill-line'), await ask('save-buffer')];
    `);
    // Sentences (M-e, M-a, M-k), M-=, M-@, C-x TAB, C-x =, and the search again (C-s C-s) and C-w in it.
    const text = (t) => inPage(`const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent); ta.focus(); ta.select(); document.execCommand('insertText', false, ${JSON.stringify(t)}); ta.setSelectionRange(0, 0);`);
    await text('One two. Three four? Five.\n- a two\n- b\n');
    await keys('M-e M-e');
    got.sentEnd = (await state()).s;
    await keys('M-a');
    got.sentStart = (await state()).s;
    await keys('M-k');
    got.killSent = (await state()).v;
    await keys('M-=');
    got.count = (await state()).echo;
    await keys('M-< M-@ M-@');
    got.markWord = await state();
    await keys('C-g C-n C-a C-x TAB ArrowRight ArrowRight C-g');
    got.indent = (await state()).v;
    await keys('C-x =');
    got.where = (await state()).echo;
    await keys('M-< C-s');
    await send('Input.insertText', { text: 'two' });
    await keys('RET');
    got.search1 = (await state()).s;
    await keys('C-s C-s RET');
    got.search2 = (await state()).s;
    await keys('M-< C-s C-w C-w RET');
    got.yankWord = (await state()).s;
    if (got.yank?.v !== 'four fiveone two three\n\nsix\n') problem = 'C-k C-k then C-y did not kill and yank the line';
    else if (got.region?.v !== ' fiveone two three\n\nsix\n' || !got.region.tab?.includes('emacs.md')) problem = 'C-SPC … C-w did not kill the region (or closed the tab)';
    else if (got.yankPop?.v !== 'one two three\n fiveone two three\n\nsix\n') problem = 'M-y did not swap in the kill before';
    else if (got.arg?.v !== 'xxxcat dog cat\nbird cat\n' || got.arg.s !== 6) problem = 'C-u 3 x or ESC f did not work';
    else if (got.query?.v !== 'xxxCAT dog cat\nbird cat\n' || got.queryAll?.v !== 'xxxCAT dog cat\nbird CAT\n') problem = 'query replace did not work';
    else if (!got.help.startsWith('C-x-') || !got.help.includes('C-sSave') || !got.helpGone) problem = `C-x and a pause did not show the keys after it (or C-g did not hide them): ${JSON.stringify(got.help)}`;
    else if (got.saved !== got.queryAll.v) problem = 'C-x C-s did not save';
    else if (got.occur?.length !== 2 || got.occurAt !== 2) problem = 'occur did not list the lines or go to one';
    else if (!got.mx?.[0]?.startsWith('kill-lineC-k') || !got.mx[1]?.startsWith('save-bufferSave')) problem = 'M-x did not find the commands by their Emacs names';
    else if (got.sentEnd !== 20 || got.sentStart !== 9 || got.killSent !== 'One two.  Five.\n- a two\n- b\n') problem = 'M-e, M-a or M-k did not go by sentences';
    else if (!got.count?.startsWith('Note has 3 lines, 6 words')) problem = 'M-= did not count the note';
    else if (got.markWord?.s !== 0 || got.markWord.e !== 7) problem = 'M-@ M-@ did not select two words';
    else if (got.indent !== 'One two.  Five.\n  - a two\n- b\n') problem = 'C-x TAB and the arrows did not indent the line';
    else if (!got.where?.startsWith('Char: SPC (32')) problem = 'C-x = did not tell the character at the caret';
    else if (got.search1 !== 7 || got.search2 !== 25 || got.yankWord !== 7) problem = 'C-s C-s did not search for the last again, or C-w did not add the word after';
  } catch (e) { problem = e.message; }
  await setting(false).catch(() => {});
  const name = 'Emacs keys: kill and yank, the region, C-u, ESC, query replace, C-x and a pause shows its keys, C-x C-s, occur, M-x by Emacs names, sentences, M-=, M-@, C-x TAB, C-x =, C-s C-s, C-w in a search';
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

await check('Labs: the experimental views are out of the palette and the review until turned on; then there', `
  const mac = navigator.platform.startsWith('Mac');
  const palette = async (q) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + q;
    input.dispatchEvent(new Event('input'));
    await sleep(150);
    return input;
  };
  const found = async (q) => {
    const input = await palette(q);
    const names = $$('#overlay .palette-item').map((i) => i.textContent);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await until(() => $('#overlay').hidden);
    return names.some((n) => n.toLowerCase().includes(q.toLowerCase()));
  };
  const off = { stage: await found('depth stage'), orbit: await found('decision orbit'), gather: await found('Gather: pieces') };
  const input = await palette('Labs: experimental views');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => $('#overlay').hidden);
  const said = (await until(() => !$('#toast').hidden && /Labs on/.test($('#toast').textContent) && $('#toast')))?.textContent;
  const on = { stage: await found('depth stage'), orbit: await found('decision orbit'), gather: await found('Gather: pieces') };
  return { off, on, said };
`, (v) => (v && !v.off.stage && !v.off.orbit && !v.off.gather && v.on.stage && v.on.orbit && v.on.gather && /Space .*Gather/.test(v.said) ? null : `got ${JSON.stringify(v)}`));

await check('red pen: the marks on the note, the reasons in the margin; y takes one, s shows it in depth with a comment for the follow-up, a applies it', `
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
  // How far each reaches into the note's words (lib/tiers.js): written over.
  const tiers = $$('.pen-card .tier').map((x) => x.textContent);
  const summary = $('.tier-summary')?.textContent || '';
  const none = button('Apply', $('#main')).textContent;
  key('j'); await sleep(50); key('y'); await sleep(200);
  const one = button('Apply', $('#main')).textContent;
  const taken = $('.pen-card').classList.contains('pen-y') && $$('.pen-doc .pen-del.pen-y').length === struck.length;
  // s: the same proposal as cards in depth; a comment there starts a follow-up.
  key('s');
  const space = await until(() => $('.space .space-card.cur'));
  const count = $('.space-count').textContent;
  const marks = $$('.space-card [data-mark]').length;
  key('c', {}, space.closest('.space'));
  const input = await until(() => $('.space-input'));
  input.value = 'Keep the tone';
  key('Enter', {}, input); await sleep(100);
  const mine = $$('.space-comment').map((x) => x.textContent);
  key('Escape', {}, $('.space')); await sleep(200);
  const back = !$('.space') && !!$('.pen-card') && !!document.activeElement.closest('.review');
  const followUp = button('Follow up', $('#main'));
  followUp.click();
  const asked = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  const said = asked.value;
  key('Escape', {}, asked); await sleep(150);
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  return { struck, notes, tiers, summary, none, one, taken, count, marks, mine, back, said, applied: /Applied/.test($('.review').textContent) };
`, (v) => (v?.struck?.join() === 'very,the' && v.notes.includes('Repeated word.') && v.none === 'Apply 0 accepted' && v.one === 'Apply 1 accepted' && v.taken && v.applied ? null : 'the red pen did not work')
  || (v.tiers.length && v.tiers.every((t) => /^T2(rewritten|deleted)$/.test(t)) && /T2\d+ changes? to your words/.test(v.summary) ? null : `the tiers did not show: ${JSON.stringify([v.tiers, v.summary])}`)
  || (v.count === '1 of 1 decided' && v.marks >= 2 && v.mine.join() === 'Keep the tone' && v.back && /proof\.md, at .+: Keep the tone/.test(v.said) ? null : `the space did not work: ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'proof.md'), 'utf8');
  const good = t === '# Proof\n\nThis is a good plan for the team.\n\nWe ship on Friday.\n';
  console.log(`${good ? '✓' : '✗'} the accepted marks reached the note, nothing else`);
  if (!good) failed = true;
}

await check('red pen on pictures: a flow step and an ink callout drawn on them; y takes the step, n leaves the callout', `
  const ta = await openNote('sub/drawn.md');
  ta.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: navigator.platform.startsWith('Mac'), ctrlKey: !navigator.platform.startsWith('Mac'), bubbles: true }));
  const o = await until(() => !$('#overlay').hidden && $('#overlay'));
  const task = o.querySelector('textarea');
  task.value = 'draw on the pictures';
  task.dispatchEvent(new Event('input', { bubbles: true }));
  button('Run on staged copy', o).click();
  await until(() => button('Apply', $('#main')), 20000);
  if (!$('.pen-card')) { key('v'); await until(() => $('.pen-card')); }
  await until(() => $('.pen-doc .pen-pic g.pen-pic-add[data-mark] .pen-ring') && $('.pen-doc .ink-figure g.ink-mark.pen-pic-add[data-mark]'));
  const says = $$('.pen-card .pen-pic-what').map((x) => x.textContent);
  key('U'); await sleep(150);
  // A click on the new step picks its card; y goes on to the callout's.
  $('.pen-doc .pen-pic g.pen-pic-add[data-mark] .pen-hit').dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(50);
  key('y'); await sleep(200); key('n'); await sleep(200);
  // Drawn again for the decisions: the marks as they are now.
  const step = await until(() => $('.pen-doc .pen-pic g.pen-pic-add[data-mark] .pen-ring'));
  const callout = await until(() => $('.pen-doc .ink-figure g.ink-mark.pen-pic-add[data-mark]'));
  const states = [step.closest('g').getAttribute('class'), callout.getAttribute('class')];
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  return { says, states, text: !!$('.pen-doc .pen-del, .pen-doc .pen-insl, .pen-doc .pen-ins') };
`, (v) => (v?.says?.join(' | ') === '+ Double-check · arrows +1 | + box, “Look here”' && /pen-y/.test(v.states[0]) && /pen-n/.test(v.states[1]) && !v.text ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'drawn.md'), 'utf8');
  const good = t === '# Drawn\n\n```flow\nOrder -> Pay -> Ship\nShip -> Double-check\n```\n\n![Screen](../assets/screen.svg)\n\n```ink\nbox blue: 10,10 50x40\n```\n';
  console.log(`${good ? '✓' : '✗'} the step reached the flow, the callout stayed out`);
  if (!good) failed = true;
}

await check('the lens (experimental): a command asks where the note disagrees; the places are joined on it, nothing changes; x picks one, f asks for its fix, back as a red pen', `
  const mac = navigator.platform.startsWith('Mac');
  await openNote('sub/lens.md');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>Lens: places that disagree';
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const task = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  const asked = task.value;
  button('Run on staged copy', $('#overlay')).click();
  await until(() => $('.review .lens-card'), 20000);
  await sleep(300);
  $('.review').focus();
  const kinds = $$('.lens-card').map((c) => c.querySelector('.lens-kind').textContent);
  const arcs = $$('.lens-arc').length;
  const changes = $('.review-note')?.textContent || '';
  key('j'); await sleep(100);
  const lit = $$('.lens-q.lens-on').map((x) => x.textContent);
  key('x'); await sleep(50);
  const picked = !!$('.lens-card.kb-cur.lens-pick');
  key('f');
  const fix = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  const said = fix.value;
  button('Run follow-up', $('#overlay')).click();
  await until(() => $('.review .pen-card') && $('.review .lens-card'), 20000);
  await sleep(300);
  const pen = $$('.pen-card').map((c) => c.textContent);
  const still = $$('.lens-card').length;
  // One note, the proposal and the lens on it as layers: the lens hidden, its cards are no stops.
  const chips = $$('.layer-chip').map((x) => x.textContent.replace(/ \\d+$/, ''));
  const pages = $$('.review .pen-page').length;
  $('.layer-chip.layer-lens').click();
  await sleep(100);
  const hidden = $$('.lens-card').every((c) => c.hidden && !c.classList.contains('kb-item')) && !$('.lens-arc');
  $('.layer-chip.layer-lens').click();
  button('Discard', $('#main')).click();
  button('Discard', await until(() => $('.dialog.confirm'))).click();
  await until(() => /Discarded/.test($('.review')?.textContent || ''), 5000);
  return { asked, kinds, arcs, changes, lit, picked, said, pen, still, chips, hidden, pages };
`, (v) => (/lens\.json/.test(v?.asked) && v.kinds.join() === 'Disagree,No support' && v.arcs === 1 && /no changes/.test(v.changes)
  && v.lit.join('|') === 'We ship on Friday.|The launch is on Monday.' && v.picked && /^Fix this with the red pen/.test(v.said) && /Friday here, Monday there/.test(v.said)
  && v.pen.some((t) => /very/.test(t)) && v.still === 2 && v.chips.join() === 'Proposal,Lens' && v.hidden && v.pages === 1 ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'lens.md'), 'utf8');
  const good = t === '# Lens\n\nWe ship on Friday.\n\nEveryone obviously wants a very dark theme.\n\nThe launch is on Monday.\n';
  console.log(`${good ? '✓' : '✗'} the lens left the note as it was`);
  if (!good) failed = true;
}

await check('forks (experimental): the paragraph at the cursor other ways, switched in its place on the note (= side by side); Enter takes it, accepted; applied, the film (F) shows the note through it', `
  const mac = navigator.platform.startsWith('Mac');
  const ta = await openNote('sub/fork.md');
  ta.focus();
  ta.setSelectionRange(12, 12);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>Forks: this paragraph';
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const task = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  const asked = task.value;
  button('Run on staged copy', $('#overlay')).click();
  const card = await until(() => $('.review .fork-card'), 20000);
  await sleep(300);
  card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  $('.review').focus();
  const ways = [];
  for (let k = 0; k < 4; k++) { ways.push($('.fork-tab-label').textContent); key('ArrowRight'); await sleep(50); }
  key('ArrowRight'); key('ArrowRight');
  await sleep(100);
  const shown = $$('.layered .fork-swap li').map((x) => x.textContent);
  key('=');
  await until(() => $$('.fork-col').length === 4);
  const titles = $$('.fork-title').map((x) => x.textContent);
  key('=');
  await until(() => !$('.fork-col'));
  key('Enter');
  await until(() => /taken/.test($('.fork-tab-label')?.textContent) && $('.review .pen-card'), 10000);
  await sleep(200);
  const taken = $('.fork-tab-label').textContent;
  const marks = $$('.pen-card').map((c) => c.classList.contains('pen-y'));
  const apply = button('Apply', $('#main')).textContent;
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  await sleep(200);
  key('F');
  const film = await until(() => $('.film'));
  const frames = $$('.film-frame').map((x) => x.textContent);
  const bars = $$('.film-bar').map((x) => x.style.height);
  key('h'); await sleep(100);
  const round = { on: $('.film-frame.on')?.textContent, ins: $$('.film-doc .pen-insl').length, del: $$('.film-doc .pen-del').length, said: $('.film-caption').textContent };
  key('Escape'); await sleep(100);
  return { asked, ways, titles, shown, taken, marks, apply, frames, bars, round, closed: !$('.film') && !!document.activeElement.closest('.review') };
`, (v) => (/forks\.json/.test(v?.asked) && /<<<\nWe ship on Friday\. The team is ready\.\n>>>/.test(v.asked) && v.titles.join() === 'As it is,Option 1,Option 2,Option 3'
  && v.ways.join('|') === '1/4 \u00b7 As it is \u00b7 in the note|2/4 \u00b7 Option 1 \u00b7 preview|3/4 \u00b7 Option 2 \u00b7 preview|4/4 \u00b7 Option 3 \u00b7 preview'
  && v.shown.join('|') === 'We ship on Friday.|The team is ready.' && v.taken === '3/4 \u00b7 Option 2 \u00b7 taken' && v.bars.length === 3 && v.bars[1] === '100%' && v.marks.length && v.marks.every(Boolean) && v.apply === `Apply ${v.marks.length} accepted`
  && v.frames.join() === 'As it was,Round 1,Applied' && v.round.on === 'Round 1' && v.round.ins === 2 && v.round.del === 1 && v.round.said === 'The agent\u2019s proposal' && v.closed ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'fork.md'), 'utf8');
  const good = t === '# Fork\n\n- We ship on Friday.\n- The team is ready.\n\nThe end.\n';
  console.log(`${good ? '✓' : '✗'} the fork taken reached the note, nothing else`);
  if (!good) failed = true;
}

await check('gather (experimental): blocks of two notes pulled down into the tray, moved in it, made a new note; the notes they come from as they were', `
  const mac = navigator.platform.startsWith('Mac');
  await openNote('sub/lens.md');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>Gather';
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const g = await until(() => $('.gather'));
  await sleep(200);
  const cards = $$('.gather-card').map((c) => c.textContent.replace('gathered', ''));
  key('ArrowRight', {}, g); await sleep(50);
  key('ArrowDown', {}, g); await sleep(300);
  const got = $$('.gather-card.got').length;
  key('+', {}, g);
  const pick = await until(() => !$('#overlay').hidden && $('#overlay input'));
  pick.value = 'sub/fork';
  pick.dispatchEvent(new Event('input'));
  await sleep(100);
  pick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => $('.gather-source.on')?.textContent === 'fork');
  await sleep(100);
  key('End', {}, g); await sleep(50);
  key('ArrowDown', {}, g); await sleep(100);
  key('<', {}, g); await sleep(50);
  const tray = $$('.gather-piece').map((p) => p.textContent);
  key('Enter', {}, g);
  const name = await until(() => !$('#overlay').hidden && $('#overlay input'));
  const asked = name.value;
  name.value = 'sub/gathered';
  button('Create', $('#overlay')).click();
  await until(() => !$('.gather') && $('.tab.active')?.textContent.includes('gathered.md'), 5000);
  return { cards, got, tray, asked, closed: !$('.gather') };
`, (v) => (v?.cards?.join('|') === 'Lens|We ship on Friday.|Everyone obviously wants a very dark theme.|The launch is on Monday.' && v.got === 1
  && v.tray.join('|') === 'forkThe end.|lensWe ship on Friday.' && v.asked === 'sub/Gathered' && v.closed ? null : `got ${JSON.stringify(v)}`));
{
  const made = fs.readFileSync(path.join(ws, 'sub', 'gathered.md'), 'utf8');
  const kept = fs.readFileSync(path.join(ws, 'sub', 'lens.md'), 'utf8') === '# Lens\n\nWe ship on Friday.\n\nEveryone obviously wants a very dark theme.\n\nThe launch is on Monday.\n'
    && fs.readFileSync(path.join(ws, 'sub', 'fork.md'), 'utf8') === '# Fork\n\n- We ship on Friday.\n- The team is ready.\n\nThe end.\n';
  const good = kept && made === '# gathered\n\nThe end.\n\nWe ship on Friday.\n\n---\nGathered from [[fork]], [[lens]].\n';
  console.log(`${good ? '✓' : '✗'} the gathered note is the pieces in the tray's order, the notes as they were`);
  if (!good) { console.log(JSON.stringify(made)); failed = true; }
}

await check('beside a note (experimental): a paragraph locked, a scrap set aside in the drawer; the red pen’s change to the locked one can’t be applied, the other is; origin shows where each came from', `
  const mac = navigator.platform.startsWith('Mac');
  const command = async (name) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + name;
    input.dispatchEvent(new Event('input'));
    await sleep(100);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  const ta = await openNote('sub/locked.md');
  ta.focus();
  const dark = ta.value.indexOf('dark');
  ta.setSelectionRange(dark, dark);
  await command('Lock this paragraph');
  const band = await until(() => $('.ed-lock-layer mark.locked'));
  const locked = band?.textContent;
  const ready = ta.value.indexOf('The team');
  ta.setSelectionRange(ready, ready + 'The team is very ready.'.length);
  await command('Drawer: set the selection aside');
  const scrap = await until(() => $('.drawer .drawer-scrap'));
  const scraps = $$('.drawer .drawer-scrap').map((x) => x.textContent);
  $$('#main button').find((b) => b.textContent.includes('Ask agent')).click();
  const task = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  task.value = 'Red pen: proofread';
  task.dispatchEvent(new Event('input'));
  button('Run on staged copy', $('#overlay')).click();
  await until(() => $$('.review .pen-card').length === 2, 20000);
  await sleep(300);
  $('.review').focus();
  const why = $$('.pen-card').map((c) => c.textContent.includes('in a paragraph you locked'));
  key('A'); await sleep(200);
  const apply = button('Apply', $('#main')).textContent;
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  await sleep(200);
  await openNote('sub/locked.md');
  await sleep(300);
  await command('Origin:');
  const o = await until(() => $('.origin'));
  await sleep(300);
  const chips = $$('.origin-chip').map((c) => c.firstChild.textContent);
  const blocks = $$('.origin-block').map((b) => $$('.origin-bar', b).map((x) => x.className.replace('origin-bar ', '')).join('+'));
  key('Escape', {}, o); await sleep(100);
  return { locked, scraps, why, apply, chips, blocks, closed: !$('.origin') };
`, (v) => (v?.locked === 'We want a very dark theme.' && v.scraps.length === 1 && /The team is very ready\./.test(v.scraps[0]) && v.why.join() === 'false,true' && v.apply === 'Apply 1 accepted'
  && v.chips.join('|') === 'Agent \u00b7 Red pen: proofread|Locked' && v.blocks.join('|') === '|o-agent|o-locked' && v.closed ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'locked.md'), 'utf8');
  const beside = path.join(ws, '.agent-notes');
  const locks = JSON.parse(fs.readFileSync(path.join(beside, 'locks', 'sub', 'locked.md.json'), 'utf8'));
  const drawer = fs.readFileSync(path.join(beside, 'drawer', 'sub', 'locked.md.md'), 'utf8');
  const good = t === '# Locked\n\nThe team is ready.\n\nWe want a very dark theme.\n' && locks.join() === 'We want a very dark theme.'
    && /^<!-- scrap from="sub\/locked\.md" line="2" at="[^"]+" -->\nThe team is very ready\.\n$/.test(drawer);
  console.log(`${good ? '✓' : '✗'} the locked paragraph as it was, the other changed; the lock and the drawer kept beside the note`);
  if (!good) { console.log(JSON.stringify({ t, locks, drawer })); failed = true; }
}

fs.writeFileSync(path.join(ws, 'sub', 'weekly 2026-10-05.md'), '# Weekly\n\n## Status (5m)\n\nBeta is out.\n\nWe ship on Friday\n\n## Hiring (10m)\n\n- [ ] Post the role @ann\n');
await check('meetings (experimental): the rail gathers a decision (a key) and a question (typed "? "), wrap up writes the next meeting, its card says what was handed out; a card dragged on the wall is a proposal', `
  const mac = navigator.platform.startsWith('Mac');
  const command = async (name) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + name;
    input.dispatchEvent(new Event('input'));
    await sleep(100);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  let ta = await openNote('sub/weekly 2026-10-05.md');
  await command('Meeting rail:');
  await until(() => $('.mrail .mrail-item'));
  ta = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  ta.focus();
  const at = ta.value.indexOf('We ship') + 3;
  ta.setSelectionRange(at, at);
  await command('Meeting: mark the line a decision');
  await sleep(100);
  const end = ta.value.indexOf('Beta is out.') + 12;
  ta.setSelectionRange(end, end);
  document.execCommand('insertText', false, '\\n? Do we need a beta');
  ta.dispatchEvent(new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true }));
  await sleep(100);
  ta.setRangeText('\\n', ta.selectionStart, ta.selectionStart, 'end');
  ta.dispatchEvent(new InputEvent('input', { inputType: 'insertLineBreak', bubbles: true }));
  await until(() => $$('.mrail-card').length === 3, 3000);
  const cards = $$('.mrail-card').map((c) => c.className.match(/m-(\\w+)/)[1] + ':' + c.querySelector('.m-text').textContent);
  const agenda = $$('.mrail-item .mrail-title').map((x) => x.textContent);
  const text = ta.value;
  await sleep(1200);
  button('Wrap up', $('.mrail')).click();
  const task = await until(() => !$('#overlay').hidden && $('#overlay textarea'));
  const asked = /^Wrap up this meeting/.test(task.value) && task.value.includes('sub/weekly 2026-10-12.md');
  button('Run on staged copy', $('#overlay')).click();
  await until(() => /2 files changed/.test($('.review')?.textContent || ''), 20000);
  await sleep(300);
  $('.review').focus();
  key('A'); await sleep(200);
  key('a');
  await until(() => /Applied/.test($('.review')?.textContent || ''), 10000);
  await sleep(300);
  await openNote('sub/weekly 2026-10-12.md');
  const since = (await until(() => $('.since')))?.innerText.replace(/\\s+/g, ' ');
  await openNote('sub/weekly 2026-10-05.md');
  await sleep(300);
  await command('Meeting: decision wall');
  const wall = await until(() => $('.wall .wall-card'));
  await sleep(700);
  const cols = $$('.wall-col').map((c) => c.dataset.col + ':' + c.querySelectorAll('.wall-card').length).join(' ');
  const card = $$('.wall-card').find((c) => c.textContent.includes('Post the role'));
  const r = card.getBoundingClientRect();
  const to = $('.wall-col[data-col="decided"]').getBoundingClientRect();
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + 20, clientY: r.top + 20 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 40, clientY: r.top + 40 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: to.left + 30, clientY: to.top + 40 }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: to.left + 30, clientY: to.top + 40 }));
  await sleep(500);
  const moved = $('.wall-count').textContent;
  button('Propose to the note', $('.wall')).click();
  await until(() => !$('.wall') && /Your suggestions/.test($('.review')?.textContent || ''), 8000);
  const proposed = $$('.pen-card').length;
  button('Discard', $('#main')).click();
  await sleep(300);
  if (!$('#overlay').hidden) button('Discard', $('#overlay'))?.click();
  await sleep(300);
  await command('Meeting rail:');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', shiftKey: true, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  await sleep(200);
  return { cards, agenda, text, asked, since, cols, moved, proposed, rail: !!$('.mrail'), meeting: !!$('.meeting') };
`, (v) => (v?.cards?.join('|') === 'decision:We ship on Friday|todo:Post the role|question:Do we need a beta' && v.agenda.join() === 'Status,Hiring'
  && v.text.includes('Beta is out.\nDo we need a beta #question\n') && v.text.includes('\nWe ship on Friday #decision\n') && v.asked
  && /Since last time weekly 2026-10-05 · 0 of 1 to-do done · 1 open question/.test(v.since) && v.cols === 'decided:1 open:1 @ann:1 nobody:0'
  && v.moved === '1 change to propose' && v.proposed >= 1 && !v.rail && !v.meeting ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'weekly 2026-10-05.md'), 'utf8');
  const next = fs.readFileSync(path.join(ws, 'sub', 'weekly 2026-10-12.md'), 'utf8');
  const good = /\n## Wrap-up\n/.test(t) && /\*\*@ann\*\*\n\n- \[ \] Post the role @ann\n/.test(t) && /Next meeting: \[\[weekly 2026-10-12\]\]\n$/.test(t)
    && next === '# weekly 2026-10-12\n\nPrevious meeting: [[weekly 2026-10-05]]\n\n## Status (5m)\n\n- Do we need a beta #question\n\n## Hiring (10m)\n';
  console.log(`${good ? '✓' : '✗'} the wrap-up at the end of the meeting's note (the to-do under its owner), the next meeting with the open question carried over; the wall's proposal discarded`);
  if (!good) { console.log(JSON.stringify({ t, next })); failed = true; }
  // Out of the way of the checks after (the tasks of all notes).
  for (const f of ['weekly 2026-10-05.md', 'weekly 2026-10-12.md']) fs.rmSync(path.join(ws, 'sub', f), { force: true });
  await sleep(800);
}

fs.writeFileSync(path.join(ws, 'sub', 'kinds 2026-10-05.md'), '# kinds\n\n## Launch (5m)\n\nreview may slip\n\nfree first month\n\n- pricing\n  - offer range\n');
await check('meetings: a line marked a risk, an idea, for next time (\u2318\u23254/5/6) \u2014 its own lane on the rail, a tag at the end of the line, where it is', `
  const mac = navigator.platform.startsWith('Mac');
  const command = async (name) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + name;
    input.dispatchEvent(new Event('input'));
    await sleep(100);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  await openNote('sub/kinds 2026-10-05.md');
  await command('Meeting rail:');
  await until(() => $('.mrail .mrail-item'));
  const ta = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const empty = $('.mrail-lane.m-more').hidden;
  for (const [words, kind] of [['review may slip', 'a risk'], ['free first month', 'an idea'], ['offer range', 'for next time']]) {
    ta.focus();
    const at = ta.value.indexOf(words) + 2;
    ta.setSelectionRange(at, at);
    await command('Meeting: mark the line ' + kind);
    await sleep(150);
  }
  await until(() => $$('.mrail-lane.m-more .mrail-card').length === 3, 3000);
  const cards = $$('.mrail-lane.m-more .mrail-card').map((c) => c.className.match(/m-(\\w+)/)[1] + ':' + c.querySelector('.m-kind').textContent + ':' + c.querySelector('.m-text').textContent);
  const text = ta.value;
  await command('Meeting rail:');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', shiftKey: true, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  await sleep(200);
  return { empty, cards, text, rail: !!$('.mrail'), meeting: !!$('.meeting') };
`, (v) => (v?.empty && v.cards?.join('|') === 'risk:Risk:review may slip|idea:Idea:free first month|next:Next time:offer range'
  && v.text === '# kinds\n\n## Launch (5m)\n\nreview may slip #risk\n\nfree first month #idea\n\n- pricing\n  - offer range #next\n' && !v.rail && !v.meeting ? null : `got ${JSON.stringify(v)}`));
fs.rmSync(path.join(ws, 'sub', 'kinds 2026-10-05.md'), { force: true });
await sleep(500);

fs.writeFileSync(path.join(ws, 'sub', 'fold 2026-10-05.md'), '# fold 2026-10-05\n\n## Launch (5m)\n\n> [!decision] We launch on Oct 10.\n\n- [ ] Ship the tool @bob\n?? who books the hall\n\n> [!question] A press kit?\n');
await check('meetings: fold (the rail\u2019s Fold) \u2014 to-dos under their owners in a Wrap-up, proposed for review, and the next meeting\u2019s note made', `
  const mac = navigator.platform.startsWith('Mac');
  const command = async (name) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + name;
    input.dispatchEvent(new Event('input'));
    await sleep(100);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  await openNote('sub/fold 2026-10-05.md');
  await command('Meeting rail:');
  await until(() => $('.mrail .mrail-item'));
  button('Fold', $('.mrail')).click();
  const review = await until(() => /Wrap-up/.test($('.review')?.textContent || '') && $('.review'), 8000);
  const toast = $('#toast').textContent;
  await sleep(300);
  button('Discard', $('#main')).click();
  button('Discard', await until(() => $('.dialog.confirm'))).click();
  await until(() => /Discarded/.test($('.review')?.textContent || ''), 5000);
  await command('Meeting rail:');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', shiftKey: true, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  await sleep(200);
  return { review: !!review, toast, owner: /@bob/.test(review?.textContent || '') };
`, (v) => {
  const next = (() => { try { return fs.readFileSync(path.join(ws, 'sub', 'fold 2026-10-12.md'), 'utf8'); } catch { return null; } })();
  return v?.review && v.owner && /^Folded/.test(v.toast) && /made fold 2026-10-12/.test(v.toast)
    && next === '# fold 2026-10-12\n\nPrevious meeting: [[fold 2026-10-05]]\n\n## Launch (5m)\n\n- A press kit? #question\n' ? null : `got ${JSON.stringify({ v, next })}`;
});
for (const f of ['fold 2026-10-05.md', 'fold 2026-10-12.md']) fs.rmSync(path.join(ws, 'sub', f), { force: true });
await sleep(500);

fs.writeFileSync(path.join(ws, 'desk.canvas'), JSON.stringify({ nodes: [
  { id: 'a', type: 'text', text: 'First card', x: 0, y: 0, width: 260, height: 140, keep: 'me' },
  { id: 'b', type: 'text', text: 'Second card', x: 500, y: 0, width: 260, height: 140 },
  { id: 'f', type: 'file', file: 'flow.md', x: 0, y: 400, width: 400, height: 300 },
], edges: [{ id: 'e', fromNode: 'a', toNode: 'f', label: 'see' }] }, null, '\t'));
await check('the desk: a .canvas opens as cards; a card dropped on another makes a pile in a group, saved with what Obsidian wrote', `
  (await until(() => $$('#sidebar .tree-row').find((r) => r.dataset.path === 'desk.canvas'), 15000)).click();
  await until(() => $$('.desk-card').length === 3);
  const note = await until(() => $('.desk-card[data-id="f"] .desk-body')?.textContent.includes('Proposal') && 1, 5000);
  const at = (id) => { const r = $(\`.desk-card[data-id="\${id}"]\`).getBoundingClientRect(); return { x: r.x + 20, y: r.y + 10 }; };
  const p = (type, { x, y }) => $('.desk').dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, pointerId: 1 }));
  const from = at('b');
  const to = at('a');
  $(\`.desk-card[data-id="b"] .desk-head\`).dispatchEvent(new PointerEvent('pointerdown', { clientX: from.x, clientY: from.y, bubbles: true, button: 0, pointerId: 1 }));
  for (let i = 1; i <= 5; i++) p('pointermove', { x: from.x + (to.x - from.x) * i / 5, y: from.y + (to.y - from.y) * i / 5 + 10 });
  p('pointerup', { x: to.x, y: to.y + 10 });
  await until(() => $('.desk-card.t-group'));
  await sleep(1500); // autosave
  return { note: !!note, group: $('.desk-card.t-group')?.textContent, edges: $$('.desk-edges path:not([d^="M0,0"])').length };
`, (v) => {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(ws, 'desk.canvas'), 'utf8')); } catch { /* not yet */ }
  const g = d?.nodes.find((n) => n.type === 'group');
  const b = d?.nodes.find((n) => n.id === 'b');
  return v?.note && v.group === 'Stack' && v.edges >= 1 && g && b.x < 100 && b.y > 0 && d.nodes.find((n) => n.id === 'a').keep === 'me' && d.edges[0].label === 'see'
    ? null : `the desk did not pile the cards: ${JSON.stringify(v)} ${JSON.stringify(d)}`;
});

fs.writeFileSync(path.join(ws, 'standup.md'), '# standup\n\n> [!question] Who reviews the launch post?\n\n- [ ] Draft the post @ann\n- [x] Pick a date\n\nSee [[flow]].\n');
await check('a note on a desk: its open questions and to-dos as cards that link back, the notes it links to; Space reads a card; a to-do ticked in the note says so on the desk', `
  await openNote('standup.md');
  const mac = navigator.platform.startsWith('Mac');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = '>Open on a desk';
  input.dispatchEvent(new Event('input'));
  await sleep(100);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => $('.tab.active')?.textContent.includes('standup desk.canvas') && $$('.desk-card').length >= 6);
  const D = $('.desk');
  const d = D.desk;
  const q = d.d.nodes.find((n) => n.from?.kind === 'question');
  d.sel = new Set([q.id]);
  D.focus();
  D.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  D.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
  const read = (await until(() => $('.desk-focus')))?.textContent;
  D.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const closed = !$('.desk-focus');
  await until(() => $$('.desk-from:not([hidden])').length === 2);
  return { read, closed, from: $$('.desk-from:not([hidden])').map((f) => f.textContent) };
`, (v) => {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(path.join(ws, 'standup desk.canvas'), 'utf8')); } catch { /* not yet */ }
  const groups = d?.nodes.filter((n) => n.type === 'group').map((n) => n.label).join();
  const files = d?.nodes.filter((n) => n.type === 'file').map((n) => n.file).sort().join();
  return v?.read?.includes('Who reviews the launch post?') && v.read.includes('Open questions') && v.closed && v.from.length === 2
    && groups === 'Open questions,To do,Linked notes' && files === 'flow.md,standup.md' && d.nodes.find((n) => n.from?.kind === 'todo')?.text === 'Draft the post @ann'
    ? null : `got ${JSON.stringify({ v, groups, files })}`;
});
fs.writeFileSync(path.join(ws, 'standup.md'), '# standup\n\n> [!question] Who reviews the launch post?\n\n- [x] Draft the post @ann\n- [x] Pick a date\n\nSee [[flow]].\n');
await check('…and when the note ticks the to-do, its card on the desk says so', `
  return (await until(() => $$('.desk-from-state').map((s) => s.textContent).join(), 10000)) || '';
`, (v) => (v === 'done in the note' ? null : `got ${JSON.stringify(v)}`));
await check('…a question decided on the desk is proposed to the note in red pen; Enter in a card read large writes in the note', `
  const D = $('.desk');
  const d = D.desk;
  const press = (k, o = {}) => D.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  D.focus();
  d.sel = new Set([d.d.nodes.find((n) => n.from?.kind === 'question').id]);
  press('d');
  const input = await until(() => $('.desk-from-input'));
  input.value = 'Ann reviews it';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const asks = (await until(() => $('.desk-from-asks')))?.textContent;
  const propose = await until(() => $$('.desk-asks button').find((b) => b.textContent.includes('standup')));
  propose.click();
  const review = !!(await until(() => $('.tab.active')?.textContent.includes('Review'), 8000));
  $$('.tab').find((t) => t.textContent.includes('standup desk.canvas')).click();
  await until(() => $('.desk-from-sent'));
  const sent = $('.desk-from-sent').textContent;
  D.focus();
  d.sel = new Set([d.d.nodes.find((n) => n.file === 'standup.md').id]);
  press(' ');
  D.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
  await until(() => $('.desk-focus'));
  press('Enter');
  const box = await until(() => $('.desk-focus-edit'));
  box.value += 'Written on the desk.\\n';
  box.dispatchEvent(new Event('input'));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await until(() => !$('.desk-focus-edit') && $('.desk-focus-body')?.textContent.includes('Written on the desk.'));
  press('Escape');
  await sleep(1500); // autosave
  return { asks, review, sent };
`, (v) => {
  const runs = path.join(ws, '.agent-notes', 'runs');
  let proposed = '';
  try { for (const r of fs.readdirSync(runs)) { const f = path.join(runs, r, 'work', 'standup.md'); if (fs.existsSync(f)) proposed = fs.readFileSync(f, 'utf8'); } } catch { /* none */ }
  const note = fs.readFileSync(path.join(ws, 'standup.md'), 'utf8');
  return v?.asks === '\u2192 decided: \u201cAnn reviews it\u201d' && v.review && v.sent === 'proposed' && proposed.includes('> [!decision] Ann reviews it') && !proposed.includes('[!question]')
    && note.includes('Written on the desk.') && note.includes('[!question] Who reviews')
    ? null : `got ${JSON.stringify({ v, proposed, note })}`;
});

await check('a picture pasted on the desk is a card; a part of it marked (r, a drag) and made a note shows that part, with a link back', `
  $$('.tab').find((t) => t.textContent.includes('standup desk.canvas')).click();
  const D = await until(() => $('.desk'));
  const d = D.desk;
  const press = (k, o = {}) => D.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 200;
  c.getContext('2d').fillRect(0, 0, 400, 200);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
  D.focus();
  D.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  const pic = await until(() => d.d.nodes.find((n) => n.type === 'file' && /\\.png$/.test(n.file)), 5000);
  const img = await until(() => { const i = d.els.get(pic.id)?.body.querySelector('img'); return i?.naturalWidth ? i : null; }, 5000);
  d.fit(false, [pic]);
  await sleep(300);
  d.sel = new Set([pic.id]);
  press('r');
  const r = img.getBoundingClientRect();
  const at = (t, fx, fy) => new PointerEvent(t, { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
  img.dispatchEvent(at('pointerdown', 0.25, 0.25));
  D.dispatchEvent(at('pointermove', 0.5, 0.5));
  D.dispatchEvent(at('pointermove', 0.75, 0.75));
  D.dispatchEvent(at('pointerup', 0.75, 0.75));
  const box = await until(() => $('.desk-card.editing textarea, .desk-edit'));
  box.value = 'Why is it black?';
  box.dispatchEvent(new Event('input'));
  box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
  await sleep(300);
  const mark = d.d.nodes.find((n) => n.from?.kind === 'region');
  const marks = $$('.desk-mark[data-mark]').length + ' marks, ' + $$('.desk-edge.mark').length + ' lines';
  d.els.get(mark.id).from.querySelector('[data-act="note"]').click();
  const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
  input.value = 'marked part';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => d.d.nodes.find((n) => n.id === mark.id).from.noted, 5000);
  const noted = d.d.nodes.find((n) => n.id === mark.id).from.noted;
  const card = d.d.nodes.find((n) => n.file === noted);
  const edge = d.d.edges.some((e) => e.fromNode === mark.id && e.toNode === card?.id);
  return { pic: pic.file, rect: mark.from.rect, marks, noted, edge };
`, (v) => {
  let note = '';
  try { note = fs.readFileSync(path.join(ws, 'marked part.md'), 'utf8'); } catch { /* none */ }
  const near = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 2);
  const at = v?.pic && `${v.pic}#xywh=${(v.rect || []).join(',')}`;
  return v && /^assets\/[^/]+\.png$/.test(v.pic) && fs.existsSync(path.join(ws, v.pic)) && near(v.rect, [100, 50, 200, 100]) && v.marks === '1 marks, 1 lines'
    && v.noted === 'marked part.md' && v.edge && note.startsWith('# Why is it black?') && note.includes(`](${at})`) && note.includes('> [!question] Why is it black?')
    && note.includes(`Source: [${v.pic.split('/').pop()}](${at}), marked on [standup desk](standup%20desk.canvas).`)
    ? null : `got ${JSON.stringify({ v, note })}`;
});

fs.writeFileSync(path.join(ws, 'sub', 'space 2026-10-05.md'), '# space 2026-10-05\n\n## Status (1m)\n\n> [!decision] Beta stays open.\n\n- [ ] Send the survey @ann\n\n## Launch (1m)\n\n> [!question] A press kit?\n');
await check('meetings in space (experimental): the depth stage (the note flat, the agenda on the floor), the tunnel to the next item, a card thrown in the decision orbit is a change to propose', `
  const mac = navigator.platform.startsWith('Mac');
  const command = async (name) => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
    const input = await until(() => !$('#overlay').hidden && $('#overlay input'));
    input.value = '>' + name;
    input.dispatchEvent(new Event('input'));
    await sleep(100);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ta = await openNote('sub/space 2026-10-05.md');
  await command('Meeting: depth stage');
  await until(() => $('.mrail'));
  await sleep(400);
  ta = $$('.editor-wrap textarea').find((t) => t.offsetParent);
  const flat = [ta, ...$$('*')].filter((e) => e.contains(ta)).every((e) => getComputedStyle(e).transform === 'none');
  const stage = !!$('.m-stage .m-gauge');
  const arcs = $$('.m-gauge .g-seg').length;
  ta.focus();
  ta.setSelectionRange(ta.value.indexOf('Beta'), ta.value.indexOf('Beta'));
  await command('Meeting: next agenda item');
  const tunnel = !!(await until(() => $('.m-tunnel'), 1500));
  await until(() => !$('.m-tunnel'), 5000);
  await command('Meeting: decision orbit');
  await until(() => $('.orb .orb-card'));
  await sleep(1800);
  const orbit = $$('.orb-card').length + ' cards, ' + $$('.orb-head').length + ' pillars';
  const card = $$('.orb-card').find((c) => c.textContent.includes('Send the survey'));
  const r = card.getBoundingClientRect();
  const hub = $('.orb-hub').getBoundingClientRect();
  card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + 10 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2 + 20, clientY: r.top + 20 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: hub.left + hub.width / 2, clientY: hub.bottom + 10 }));
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: hub.left + hub.width / 2, clientY: hub.bottom + 10 }));
  await sleep(800);
  const moved = $('.wall-count').textContent;
  const decided = $$('.orb-card.m-decision').map((c) => c.querySelector('.orb-card-text').textContent).sort().join('|');
  $('.wall').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await sleep(200);
  const wall = !$('.orb') && !!$('.wall .wall-card');
  $('.wall').dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true }));
  await sleep(200);
  await command('Meeting: depth stage');
  await sleep(200);
  await command('Meeting rail:');
  await sleep(200);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'M', shiftKey: true, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac }));
  await sleep(200);
  return { reduced, flat, stage, arcs, tunnel, orbit, moved, decided, wall, after: !!$('.wall') || !!$('.mrail') || !!$('.meeting') };
`, (v) => (v?.reduced || (v?.flat && v.stage && v.arcs === 2 && v.tunnel && v.orbit === '3 cards, 1 pillars' && v.moved === '1 change to propose'
  && v.decided === 'Beta stays open.|Send the survey' && v.wall && !v.after) ? null : `got ${JSON.stringify(v)}`));
{
  const t = fs.readFileSync(path.join(ws, 'sub', 'space 2026-10-05.md'), 'utf8');
  const good = t.includes('- [ ] Send the survey @ann\n') && !t.includes('[!decision] Send the survey');
  console.log(`${good ? '✓' : '✗'} the orbit's change was not written to the note (it is a proposal)`);
  if (!good) { console.log(JSON.stringify({ t })); failed = true; }
  fs.rmSync(path.join(ws, 'sub', 'space 2026-10-05.md'), { force: true });
  await sleep(800);
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
  await until(() => button('Discard', $('.review'))); // the run as it ended, not as it ran
  key('d');
  const ok = await until(() => $('.dialog.confirm') && button('Discard', $('.dialog.confirm')));
  ok?.click();
  const gone = !!(await until(() => /Discarded/.test($('.review')?.textContent || ''), 5000));
  return { toast: t.textContent, back: !!back, gone };
`, (v) => (v?.back && /Review$/.test(v.toast) && v.gone ? null : `no word when the run ended: ${JSON.stringify(v)}`));

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

{
  // MACROS.md: a macro kept as lines is a command, on keys of LEADER.md too;
  // run steps find commands by name (Save) and other macros.
  fs.writeFileSync(path.join(ws, 'MACROS.md'), '# Macros\n\n## Quote\nQuotes the line.\n\n```macro\nmove line-start\ntype "> "\nmove down\n```\n\n## Quote two\n\n```macro\nrun Macro: Quote\nrun Macro: Quote\nrun Save\n```\n');
  fs.writeFileSync(path.join(ws, 'LEADER.md'), '# Leader keys\n\n- `o` +mine\n- `o q` Macro: Quote two\n');
  await check('a macro kept in MACROS.md: on keys of LEADER.md, it plays (and another, and Save, by name)', `
    const ta = await openNote('kept.md');
    ta.focus();
    ta.setSelectionRange(0, 0);
    const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
    let menu = null;
    for (let i = 0; i < 40 && !menu; i++) {
      press('KeyX', '\u2248', { altKey: true });
      const m = await until(() => $('.leader'), 1000);
      press('KeyO', 'o');
      await sleep(50);
      if ($$('.leader-item', m).some((b) => b.dataset.key === 'q')) menu = m;
      else { press('Escape', 'Escape'); ta.focus(); await sleep(200); }
    }
    if (!menu) return { menu: false };
    press('KeyQ', 'q');
    await until(() => ta.value.startsWith('> one\\n> two'));
    await sleep(800); // run Save: on disk
    return { menu: true, text: ta.value };
  `, (v) => (v?.menu && v.text === '> one\n> two\n' && fs.readFileSync(path.join(ws, 'kept.md'), 'utf8') === '> one\n> two\n' ? null : `the kept macro did not play: ${JSON.stringify(v)}`));
}

await check('make a command by asking (\u2325X h m): the run writes MACROS.md and LEADER.md; the review says what Margin can\u2019t read and what changes on the keys', `
  const ta = await openNote('kept.md');
  ta.focus();
  const press = (code, key, opts = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...opts }));
  press('KeyX', '\u2248', { altKey: true });
  await until(() => $('.leader'));
  press('KeyH', 'h');
  press('KeyM', 'm');
  const d = await until(() => $('.dialog'));
  const input = d.querySelector('textarea, input');
  input.value = 'a broken one';
  button('Ask the agent', d).click();
  await until(() => !$('#toast').hidden && /done/.test($('#toast').textContent), 20000);
  $('#toast .toast-action')?.click();
  const box = await until(() => $('.review .cmd-check'), 8000);
  return { text: box?.textContent || '', fix: !!box && !!button('Ask the agent to fix these', box) };
`, (v) => (/MACROS\.md line \d+: .*fly/.test(v?.text) && /o t\s*Macro: Make it a task/.test(v.text) && v.fix ? null : `the review did not check the notes of commands: ${JSON.stringify(v)}`));

console.log(failed ? `\nSmoke test failed (${results.filter((r) => !r.ok).length} of ${results.length + 4}).` : `\nAll ${results.length + 4} checks passed.`);
done(failed ? 1 : 0);
