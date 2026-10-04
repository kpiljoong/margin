import { renderMarkdown, outline, slug } from './markdown.js';
import { store } from './store.js';
import { linkAt } from './links.js';
import { PreviewFind } from './previewfind.js';
import { openLeader, linkHints, pickHint } from './leader.js';
import { Macros, Stop as MacroStop, describe as describeMacro } from './macro.js';
import { parseMacros, withMacro, MACROS_FILE, MACROS_STARTER } from './macrotext.js';
import { checkCommandNotes, COMMAND_NOTES } from './commandcheck.js';
import { fillTemplate, isTemplate, TEMPLATE_DIR } from './templates.js';
import { MarkdownEditor, setEditorKeys } from './editor.js';
import { emacs, occurLines, occurPattern, keyName as emacsKeyName, commandOf as emacsCommandOf, COMMAND_DOCS, PREFIXES as EMACS_PREFIXES, emacsName, keysOf as emacsKeysOf, emacsCommands } from './emacs.js';
import { hunksOf } from './track.js';
import { renderDiagrams } from './diagrams.js';
import { flowToMermaid, flowsAsMermaid, parseFlow, isStepText, flowStepNames, nameKey, flowTour, flowLineAt, COLORS } from './flow.js';
import { pairInk, parseInk, addMark, removeMark, setMark, fitBoard, boardLine, INK, INK_COLORS, ARROW_STYLES } from './ink.js';
import { pictureHunks, penPlaces, pictureSummary, showPicture, PLACE } from './penpic.js';
import { connect, addBox, freshName, nextAnswer, setColor, setDirection, removeBox, removeArrow, setArrowKind, setArrowLabel, reverseArrow, setShape, arrowSpot } from './flowedit.js';
import { FigureCanvas } from './canvas.js';
import { ARROW_KINDS } from './inkdraw.js';
import { pinnedFigure, pinLabel } from './pins.js';
import { sketchToFlow } from './sketchflow.js';
import { goalAt, boxAt, mentionRanges, definitionLines, leadLines, numberedItems } from './figure-goal.js';
import { isDrawing, drawingFormat, DrawingFrame, renderDrawingEmbeds, cachedEmbed, forgetEmbed, drawingImageUrl } from './drawing.js';
import { copyPng, copySvg, svgFromDataUrl, imageToPng } from './clip.js';
import { openViewer } from './viewer.js';
import { fuzzy, rankCommands, used } from './commands.js';
import { parseRecipes, mergeRecipes, runsDirectly, RECIPES_FILE, RECIPES_STARTER } from './recipes.js';
import { parseLeaderKeys, applyLeaderKeys, LEADER_FILE, LEADER_STARTER } from './leaderkeys.js';
import { sectionRange, linesRange } from './narrow.js';
import { listing as dirListing, planDired, describeOps, orderOps, plainLine } from './dired.js';
import { docOf } from './docs.js';
import SHORTCUTS from './shortcuts.json' with { type: 'json' };
import { effectiveKeys, eventKeys, normalize, keyLabel, unusable, conflicts, customOnly } from './keys.js';
import { THEMES, allThemes, applyTheme, resolveTheme, onSystemThemeChange, setCustomThemes, validateTheme, exportTheme } from './themes.js';

// ------------------------------------------------------------------ basics

const $ = (sel, root = document) => root.querySelector(sel);
const isMac = navigator.platform.includes('Mac');
// Present only inside the desktop app (see desktop/preload.js).
const desktop = window.agentNotesDesktop || null;
// "Reveal in Finder" in the platform's words.
const REVEAL_LABEL = { darwin: 'Reveal in Finder', win32: 'Show in File Explorer' }[desktop?.platform] || 'Open Containing Folder';
const revealItem = (p) => (desktop?.revealPath ? { label: REVEAL_LABEL, run: () => desktop.revealPath(p) } : null);
if (desktop?.platform === 'darwin') document.documentElement.classList.add('desktop-mac');
const MOD = isMac ? '⌘' : 'Ctrl+';

// Keyboard shortcuts (defaults in shortcuts.json, see keys.js). Changed ones
// live in the desktop app's config, so its menu and the system-wide shortcut
// follow; in a browser, in this browser's storage.
const SHORTCUT_IDS = new Set(SHORTCUTS.filter((d) => d.scope !== 'menu' || desktop).map((d) => d.id));
const keyDefs = () => SHORTCUTS.filter((d) => SHORTCUT_IDS.has(d.id));
let customKeys = {};
let KEYS = {};
let appKeys = new Map(); // keys → shortcut id, for the page's own shortcuts
function applyKeys() {
  KEYS = effectiveKeys(keyDefs(), customKeys, isMac);
  appKeys = new Map(keyDefs().filter((d) => d.scope === 'app' || d.scope === 'editor').filter((d) => KEYS[d.id]).map((d) => [KEYS[d.id], d.id]));
  setEditorKeys(Object.fromEntries(keyDefs().filter((d) => d.scope === 'editor' || d.scope === 'find').map((d) => [d.id, KEYS[d.id]])));
}
applyKeys();
// A shortcut for people to read ("⌘⇧P"), or '' when it has none.
const kbd = (id) => keyLabel(KEYS[id] || '', isMac);
const withKey = (text, id) => (kbd(id) ? `${text} (${kbd(id)})` : text);
async function loadShortcuts() {
  try { customKeys = (desktop?.getShortcuts ? await desktop.getShortcuts() : JSON.parse(store.getItem('an.shortcuts') || '{}')) || {}; } catch { customKeys = {}; }
  applyKeys();
}
async function saveShortcuts(keys) {
  customKeys = customOnly(keyDefs(), keys, isMac);
  applyKeys();
  if (!desktop?.setShortcuts) { store.setItem('an.shortcuts', JSON.stringify(customKeys)); return; }
  const r = await desktop.setShortcuts(customKeys);
  if (r && r.quickCapture === false) toast(`${kbd('quick-capture')} is taken by another app: quick capture has no system-wide shortcut now.`, 'error');
}

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

const token = (() => {
  const u = new URL(location.href);
  const t = u.searchParams.get('t');
  if (t) {
    sessionStorage.setItem('agent-notes-token', t);
    u.searchParams.delete('t');
    history.replaceState(null, '', u.pathname + u.hash);
  }
  return sessionStorage.getItem('agent-notes-token') || '';
})();

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-agent-notes-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// In-app replacement for window.prompt() (not available in Electron).
function askText({ title, label = '', value = '', placeholder = '', multiline = false, okLabel = 'OK' }) {
  return new Promise((resolve) => {
    const overlay = $('#overlay');
    const input = multiline
      ? h('textarea', { placeholder, value })
      : h('input', { class: 'input', placeholder, value, spellcheck: false });
    const done = (v) => { overlay.hidden = true; overlay.replaceChildren(); resolve(v); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      if (e.key === 'Enter' && !e.isComposing && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); done(input.value); }
    });
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    overlay.replaceChildren(h('div', { class: 'dialog' },
      h('div', { class: 'dialog-body' }, h('h2', {}, title), label ? h('p', { class: 'sub' }, label) : null, input),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'grow' }, multiline ? `${MOD}Enter to submit` : ''),
        h('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => done(input.value) }, okLabel))));
    overlay.hidden = false;
    input.focus();
    if (!multiline) input.setSelectionRange(value.length, value.length);
  });
}

// In-app replacement for window.confirm(): on Windows, Electron leaves the
// page without keyboard focus after a native dialog, so typing stopped
// working. Resolves true for OK; the focus goes back where it was.
function askConfirm(message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = $('#overlay');
    const before = document.activeElement;
    const done = (v) => {
      overlay.hidden = true;
      overlay.replaceChildren();
      overlay.onkeydown = null;
      if (before?.isConnected) before.focus({ preventScroll: true });
      resolve(v);
    };
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    overlay.onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    overlay.replaceChildren(h('div', { class: 'dialog confirm', role: 'alertdialog' },
      h('div', { class: 'dialog-body' }, h('p', {}, message)),
      h('div', { class: 'dialog-foot' },
        h('div', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
        ok)));
    overlay.hidden = false;
    ok.focus();
  });
}

let toastTimer;
// Every message shown, for a look back (as Emacs's *Messages*): ⌥X b m.
const messages = [];
let messageSeq = 0;
function toast(msg, kind = '', action = null) {
  messages.push({ at: new Date(), msg: String(msg), kind, seq: ++messageSeq });
  if (S.tabs.some((t) => t.kind === 'messages')) requestAnimationFrame(() => redrawSpecial('messages'));
  if (messages.length > 200) messages.shift();
  const el = $('#toast');
  el.replaceChildren(msg, action ? h('button', { class: 'toast-action', onclick: () => { el.hidden = true; action.run(); } }, action.label) : '');
  el.className = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : kind === 'error' ? 6000 : 2800);
}

// The echo area (as Emacs's), in the status bar: a prefix waiting for its
// key ("C-x-"), a word from a key ("Mark set"). Those also go to Messages.
let echoText = '';
let echoTimer;
function showEcho(text, sticky = false) {
  echoText = text || '';
  clearTimeout(echoTimer);
  if (echoText && !sticky) {
    messages.push({ at: new Date(), msg: echoText, kind: '', seq: ++messageSeq });
    if (messages.length > 200) messages.shift();
    echoTimer = setTimeout(() => { echoText = ''; renderStatus(); }, 3000);
  }
  renderStatus();
}

const basename = (p) => p.split('/').pop();
const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stem = (p) => basename(p).replace(/\.[^.]+$/, '');
const isNote = (p) => /\.(md|markdown|mdx|txt)$/i.test(p);
const isMermaidFile = (p) => /\.(mmd|mermaid)$/i.test(p || '');
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;
// Files with a rendered view next to the source (Edit / Split / Preview).
const hasPreview = (p) => isNote(p) || isMermaidFile(p);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};

// ------------------------------------------------------------------ state

const S = {
  info: null,
  files: [],
  expanded: new Set(JSON.parse(store.getItem('an.expanded') || '[]')),
  view: store.getItem('an.view') || 'files',
  mode: store.getItem('an.mode') || 'split',
  tabs: [],
  active: null,
  runs: [],
  searchQuery: '',
  searchResults: null,
  backlinks: [],
  mentions: [],
  git: { repo: false },
  gitMap: new Map(),
  tags: [],
  dirs: [],
  recent: [],
  bookmarks: [], // paths, in the order they were added
  settings: null, // loaded below
};

// Editor groups (panes). Each tab belongs to one group; each group has its
// own active tab and view mode. At most two groups, side by side.
S.groups = [{ active: null, mode: store.getItem('an.mode') || 'split' }];
S.focus = 0;
const attachedByGroup = [null, null]; // file tab whose editor is in each pane
let splitRatio = Number(store.getItem('an.splitRatio')) || 0.5; // left pane's share in a split
const isAttached = (tab) => attachedByGroup[tab.group] === tab;
const groupMode = (tab) => (tab?.kind === 'file' && isMermaidFile(tab.path) ? tab.mmdMode || 'preview' : S.groups[tab?.group ?? S.focus]?.mode || S.mode);

// ------------------------------------------------------------------ settings

const DEFAULT_SETTINGS = {
  theme: 'system', font: 'mono', fontSize: 15, width: 'normal', lineHeight: 1.7,
  accent: '', systemLight: 'paper', systemDark: 'midnight',
  autosave: true, highlight: true, spellcheck: false, sidebarWidth: 260,
  // Emacs keys in the editor (emacs.js), and where M-q wraps.
  emacsKeys: false, fillColumn: 70,
  // Labs: off until turned on in Settings.
  labSteadyDraw: false, labWheelPans: false,
  // The file tree shows the active tab's file (as VS Code's Auto Reveal).
  followTab: true,
  // Pens: yours (suggesting, comments) and the agent's; '' is the theme's.
  penMe: '', penAgent: '',
};
const ACCENTS = ['#7aa2f7', '#bb9af7', '#2ac3de', '#9ece6a', '#e0af68', '#ff9e64', '#f7768e', '#c0caf5'];
const LINE_HEIGHTS = { 1.5: 'Compact', 1.7: 'Normal', 1.9: 'Relaxed' };
const themePair = () => ({ light: S.settings.systemLight, dark: S.settings.systemDark });
const currentTheme = () => resolveTheme(S.settings.theme, themePair());

function loadCustomThemes() {
  try { setCustomThemes(JSON.parse(store.getItem('an.customThemes') || '[]')); } catch { setCustomThemes([]); }
}
loadCustomThemes();
const FONTS = {
  mono: { label: 'Mono', stack: 'var(--mono)' },
  sans: { label: 'Sans', stack: 'var(--sans)' },
  serif: { label: 'Serif', stack: '"Iowan Old Style", "Charter", "Georgia", "Noto Serif KR", "Nanum Myeongjo", serif' },
};
const WIDTHS = { narrow: ['Narrow', '640px'], normal: ['Normal', '760px'], wide: ['Wide', '980px'], full: ['Full', '100%'] };

function loadSettings() {
  try {
    const saved = JSON.parse(store.getItem('an.settings') || '{}');
    // Before 0.5.17 this was "treeFollows", off unless turned on.
    if (!('followTab' in saved) && saved.treeFollows) saved.followTab = true;
    delete saved.treeFollows;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

function applySettings() {
  const st = S.settings;
  const theme = applyTheme(st.theme, { pair: themePair(), accent: st.accent });
  desktop?.setBackground?.(theme.vars.bg);
  const r = document.documentElement.style;
  r.setProperty('--ed-font', (FONTS[st.font] || FONTS.mono).stack);
  r.setProperty('--ed-size', `${st.fontSize}px`);
  r.setProperty('--line-width', (WIDTHS[st.width] || WIDTHS.normal)[1]);
  r.setProperty('--sidebar-width', `${st.sidebarWidth}px`);
  r.setProperty('--ed-line-height', String(st.lineHeight || 1.7));
  for (const [v, key] of [['--pen-me', 'penMe'], ['--pen', 'penAgent']]) { if (st[key]) r.setProperty(v, st[key]); else r.removeProperty(v); }
  for (const t of S.tabs) t.editor?.setOptions({ highlight: st.highlight, spellcheck: st.spellcheck });
  emacs.on = !!st.emacsKeys;
  emacs.fillColumn = Number(st.fillColumn) || 70;
  // Diagrams are drawn in theme colours.
  for (const t of S.tabs) if (t.previewEl?.querySelector('pre.diagram, pre[data-lang="mermaid" i], .drawing-embed, .mmd-embed')) renderPreview(t);
  for (const t of S.tabs) if (t.kind === 'drawing') t.frame?.post({ type: 'theme', theme: isDarkTheme() ? 'dark' : 'light' });
}

S.settings = loadSettings();

function setSetting(key, value) {
  S.settings[key] = value;
  store.setItem('an.settings', JSON.stringify(S.settings));
  applySettings();
  renderStatus();
}

const tabById = (id) => S.tabs.find((t) => t.id === id) || null;
const activeIn = (g) => tabById(S.groups[g]?.active);
const activeTab = () => activeIn(S.focus);
const fileTab = () => { const t = activeTab(); return t && t.kind === 'file' ? t : null; };
const drawingTab = () => { const t = activeTab(); return t && t.kind === 'drawing' ? t : null; };
const isDoc = (t) => !!t && (t.kind === 'file' || t.kind === 'drawing'); // tabs that stand for a file
const persist = () => {
  store.setItem('an.expanded', JSON.stringify([...S.expanded]));
  store.setItem('an.view', S.view);
  store.setItem('an.mode', S.groups[0].mode);
  store.setItem(`an.tabs.${S.info?.root}`, JSON.stringify({
    groups: S.groups.map((g, i) => ({
      open: S.tabs.filter((t) => isDoc(t) && t.group === i).map((t) => t.path),
      active: isDoc(activeIn(i)) ? activeIn(i).path : null,
      mode: g.mode,
    })),
    focus: S.focus,
  }));
};

function focusGroup(g) {
  if (!S.groups[g] || S.focus === g) return;
  S.focus = g;
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('focused', Number(p.dataset.g) === g));
  renderSidebar();
  renderStatus();
  const t = fileTab();
  if (t) loadBacklinks(t.path);
}

// Open (or move) a tab into the other pane, creating it if needed.
function ensureSecondGroup() {
  if (!S.groups[1]) S.groups.push({ active: null, mode: S.groups[0].mode });
  return 1;
}

function closeGroupIfEmpty() {
  if (S.groups.length < 2) return;
  for (const g of [1, 0]) {
    if (!S.tabs.some((t) => t.group === g)) {
      if (g === 0) { S.tabs.forEach((t) => { t.group = 0; }); S.groups[0] = { ...S.groups[1] }; }
      S.groups.length = 1;
      attachedByGroup[1] = null;
      S.focus = 0;
      return;
    }
  }
}

// ------------------------------------------------------------------ files

async function loadTree() {
  const t = await api('GET', '/api/tree');
  S.files = t.files;
  S.dirs = t.dirs || [];
  linkIndex = null;
  renderSidebar();
  updateNavButtons();
}

// O(1) link resolution: rebuilt whenever the file list changes.
let linkIndex = null;
function buildLinkIndex() {
  const byPath = new Map();
  const byName = new Map();
  for (const f of S.files) {
    byPath.set(f.path, f.path);
    if (!f.note && (isDrawing(f.path) || isMermaidFile(f.path) || IMAGE_FILE.test(f.path))) {
      // ![[sketch.excalidraw]] / ![[flow.mmd]] / ![[shot.png]] embed a drawing,
      // diagram or picture from anywhere.
      const name = basename(f.path).toLowerCase();
      if (!byName.has(name)) byName.set(name, f.path);
    }
    if (!f.note) continue;
    const lp = f.path.toLowerCase();
    if (!byName.has(lp)) byName.set(lp, f.path);
    const noExt = lp.replace(/\.[^./]+$/, '');
    if (!byName.has(noExt)) byName.set(noExt, f.path);
    const st = stem(f.path).toLowerCase();
    if (!byName.has(st)) byName.set(st, f.path);
  }
  linkIndex = { byPath, byName };
}

function resolveLink(target, fromPath) {
  const t = target.trim().replace(/#.*$/, '');
  if (!t) return null;
  if (!linkIndex) buildLinkIndex();
  // Relative path first ("../x.md"), then [[name]] by basename anywhere.
  if (fromPath !== undefined && /[/.]/.test(t)) {
    const parts = (dirname(fromPath) ? `${dirname(fromPath)}/${t}` : t).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    const joined = out.join('/');
    const hit = linkIndex.byPath.get(joined) || linkIndex.byPath.get(`${joined}.md`);
    if (hit) return hit;
  }
  return linkIndex.byName.get(t.toLowerCase()) || null;
}

// [[Note#Section]] and [[#Section]] (this note): the note and the heading.
// Obsidian's [[Note#Section#Sub]] points at the last one.
function splitLink(target) {
  const [note, ...rest] = String(target).split('#');
  return { note: note.trim(), heading: rest.map((x) => x.trim()).filter(Boolean).pop() || '' };
}

// The line of a heading, matched the way links write it: without case,
// marks or extra spaces.
function headingLine(content, heading) {
  const want = slug(heading);
  return outline(content).find((it) => slug(it.text.replace(/[*_`]/g, '')) === want)?.line ?? null;
}

// Follow a link from a note, to its section if it names one. False when the
// note doesn't exist.
async function followLink(target, fromPath) {
  const { note, heading } = splitLink(target);
  const path = note ? resolveLink(note, fromPath) : (isNote(fromPath || '') ? fromPath : null);
  if (!path) return false;
  if (path !== fileTab()?.path) await openFile(path);
  const tab = fileTab();
  if (!heading || tab?.path !== path) return true;
  const line = headingLine(tab.content, heading);
  if (line == null) toast(`No section “${heading}” in ${stem(path)}`);
  // Once the note is shown (its preview drawn).
  else requestAnimationFrame(() => requestAnimationFrame(() => gotoHeading(line)));
  return true;
}

// ---------------------------------------------------------------- link preview
// Hovering a [[link]] in a preview (or, holding ⌘/Ctrl, in the editor) shows
// the note — or just the section it names — in a small window. Clicking the
// window's title opens it.
const linkPop = { el: null, key: '', timer: 0, hideTimer: 0 };

// The part of a note a link shows: the section from its heading to the next
// heading as high, or the whole note.
function linkSection(content, heading) {
  if (!heading) return { text: content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/, ''), line: null };
  const line = headingLine(content, heading);
  if (line == null) return null;
  const heads = outline(content);
  const level = heads.find((o) => o.line === line).level;
  const end = heads.find((o) => o.line > line && o.level <= level)?.line;
  return { text: content.split('\n').slice(line, end).join('\n'), line };
}

function hideLinkPreview() {
  clearTimeout(linkPop.timer); clearTimeout(linkPop.hideTimer);
  linkPop.key = '';
  linkPop.el?.remove();
  linkPop.el = null;
}

// Hide soon, unless the pointer comes back to the link or into the window.
function leaveLinkPreview() {
  clearTimeout(linkPop.timer);
  clearTimeout(linkPop.hideTimer);
  linkPop.hideTimer = setTimeout(hideLinkPreview, 300);
}

function hoverLink(target, fromPath, rect) {
  const key = `${fromPath}\n${target}`;
  clearTimeout(linkPop.hideTimer);
  if (linkPop.key === key) return;
  clearTimeout(linkPop.timer);
  linkPop.timer = setTimeout(() => showLinkPreview(target, fromPath, rect, key), linkPop.el ? 0 : 350);
}

async function showLinkPreview(target, fromPath, rect, key) {
  const { note, heading } = splitLink(target);
  const path = note ? resolveLink(note, fromPath) : (isNote(fromPath || '') ? fromPath : null);
  if (!path || !isNote(path)) return;
  const open = S.tabs.find((t) => t.kind === 'file' && t.path === path && t.content != null);
  let content = open?.content;
  if (content == null) try { content = (await api('GET', `/api/file?path=${encodeURIComponent(path)}`)).content; } catch { return; }
  const part = linkSection(content, heading);
  hideLinkPreview();
  linkPop.key = key;
  const body = h('div', { class: 'link-preview-body md' });
  body.innerHTML = part ? renderMarkdown(part.text, { image: (url) => localImage(url, path) }) : '';
  if (!part) body.append(h('div', { class: 'empty' }, `No section “${heading}”.`));
  else if (!part.text.trim()) body.append(h('div', { class: 'empty' }, 'Empty note.'));
  const go = () => { hideLinkPreview(); followLink(target, fromPath); };
  const el = h('div', { class: 'link-preview', onmouseenter: () => clearTimeout(linkPop.hideTimer), onmouseleave: leaveLinkPreview },
    h('button', { class: 'link-preview-head', title: 'Open', onclick: go }, stem(path), heading ? h('span', { class: 'dim' }, ` › ${heading}`) : null),
    body);
  // Links inside it open their note too; nothing else in it acts.
  body.addEventListener('click', (e) => {
    const a = e.target.closest('a.internal');
    if (a?.dataset.target) { e.preventDefault(); hideLinkPreview(); followLink(a.dataset.target, path); }
    else if (a) e.preventDefault();
  });
  document.body.append(el);
  linkPop.el = el;
  renderDiagrams(body);
  // Below the link, or above it when there's more room there.
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const below = innerHeight - rect.bottom;
  el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - w - 8))}px`;
  el.style.top = `${below >= hgt + 12 || below >= rect.top ? rect.bottom + 6 : Math.max(8, rect.top - hgt - 6)}px`;
}

// A preview pane: plain hover.
function previewLinkHover(e, tab) {
  const a = e.target.closest('a.internal');
  if (!a || a.closest('.link-preview')) return;
  let target = a.dataset.target || a.dataset.href;
  try { if (a.dataset.href) target = decodeURIComponent(target); } catch { /* as written */ }
  if (!a.dataset.target && /^[a-z][\w+.-]*:/i.test(target)) return;
  hoverLink(target, tab.path, a.getBoundingClientRect());
  a.addEventListener('mouseleave', leaveLinkPreview, { once: true });
}

// The editor: a [[link]] under the pointer while ⌘/Ctrl is held. The coloured
// layer under the text has a span for each link.
function editorLinkHover(e, ed, tab) {
  if (!(isMac ? e.metaKey : e.ctrlKey)) { ed.ta.classList.remove('over-link'); if (linkPop.el || linkPop.timer) leaveLinkPreview(); return; }
  // Any link can be ⌘-clicked; [[links]] also show a preview.
  const under = [...ed.hlLayer.querySelectorAll('.md-wikilink, .md-link, .md-url')].find((sp) => [...sp.getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom));
  ed.ta.classList.toggle('over-link', !!under);
  const span = under?.classList.contains('md-wikilink') ? under : null;
  if (!span) { leaveLinkPreview(); return; }
  if (span.previousElementSibling?.textContent.startsWith('!')) return; // an embed
  hoverLink(span.textContent.split('|')[0], tab.path, span.getBoundingClientRect());
}

// Textareas normalise line breaks to LF; remember CRLF files (common on
// Windows) and write them back with CRLF so saving never rewrites every line.
function fromDisk(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const content = eol === '\r\n' ? text.replace(/\r\n/g, '\n') : text;
  return { content, saved: content, eol };
}
const toDisk = (text, eol) => (eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text);

// A kept note opened again: its cursor and scroll as they were.
function restoreKept(tab, focus) {
  requestAnimationFrame(() => {
    if (!tab.editor || !S.tabs.includes(tab)) return;
    if (focus && editorShown(tab)) tab.editor.focus();
    tab.editor.setSelection(Math.min(tab.sel || 0, tab.editor.value.length));
    tab.editor.scrollTop = tab.scroll || 0;
    renderStatus();
  });
}

async function openFile(path, { line, focus = true, group, side = false, text = false } = {}) {
  if (isDrawing(path) && !text) return openDrawing(path, { focus, group, side });
  let tab = S.tabs.find((t) => t.kind === 'file' && t.path === path);
  const target = side ? ensureSecondGroup() && (S.focus === 1 && S.groups.length > 1 ? 0 : 1) : (group ?? S.focus);
  if (!tab) {
    try {
      const f = await api('GET', `/api/file?path=${encodeURIComponent(path)}`);
      const kept = closedTabs.get(path);
      closedTabs.delete(path);
      if (kept && kept.hash === f.hash) { tab = kept; tab.group = target; restoreKept(tab, line == null && focus); }
      else tab = { id: `f:${path}`, kind: 'file', path, ...fromDisk(f.content), hash: f.hash, sel: 0, scroll: 0, group: target };
      S.tabs.push(tab);
    } catch (e) { toast(e.message, 'error'); return; }
  } else if (side && tab.group !== target) moveTab(tab, target, false);
  activate(tab.id);
  if (line != null) requestAnimationFrame(() => gotoLine(line));
  else if (focus) requestAnimationFrame(() => { if (isAttached(tab)) tab.editor.focus(); });
  for (let d = dirname(path); d; d = dirname(d)) S.expanded.add(d);
  S.recent = [path, ...S.recent.filter((p) => p !== path)].slice(0, 30);
  store.setItem(`an.recent.${S.info?.root}`, JSON.stringify(S.recent));
  loadBacklinks(path);
}

function activate(id) {
  const tab = tabById(id);
  if (!tab) return;
  if (!S.groups[tab.group]) tab.group = 0;
  const cur = activeIn(tab.group);
  if (cur && cur !== tab && cur.kind === 'file') flushAutosave(cur);
  if (cur && cur !== tab && cur.kind === 'drawing') saveDrawing(cur, { flush: true });
  S.groups[tab.group].active = id;
  S.focus = tab.group;
  navRecord(tab);
  touchMru(tab);
  persist();
  render();
  if (S.settings.followTab && (tab.kind === 'file' || tab.kind === 'drawing')) requestAnimationFrame(() => showInTree(tab.path, { quiet: true }));
}

// ------------------------------------------------------------------ back / forward

// Browser-style history of the notes and images you looked at, across panes.
// Going back reopens closed tabs; deleted files are skipped, renamed ones followed.
const nav = { stack: [], index: -1, moving: false, ready: false };
const NAV_MAX = 100;
const navable = (t) => t && (t.kind === 'file' || t.kind === 'image' || t.kind === 'drawing');
const navExists = (e) => S.files.some((f) => f.path === e.path);

function navRecord(tab) {
  if (!nav.ready || nav.moving || !navable(tab)) return;
  if (nav.stack[nav.index]?.path === tab.path) return;
  navKeep();
  navPush({ path: tab.path, kind: tab.kind, t: performance.now() });
}
function navPush(e) {
  nav.stack = [...nav.stack.slice(0, nav.index + 1), e].slice(-NAV_MAX);
  nav.index = nav.stack.length - 1;
}

// Back and forward return to the place in the note, not just the note (as
// Vim's jump list): where the cursor and the scroll were when you left.
function navKeep(e = nav.stack[nav.index]) {
  const t = e && S.tabs.find((x) => x.kind === 'file' && x.path === e.path && x.editor);
  if (!t) return;
  e.pos = t.editor.selectionStart;
  e.top = t.editor.ta.scrollTop;
  e.ptop = t.previewEl?.isConnected ? t.previewEl.scrollTop : null;
}
function navRestore(e) {
  const t = S.tabs.find((x) => x.kind === 'file' && x.path === e.path && x.editor);
  if (!t || e.pos == null) return;
  requestAnimationFrame(() => {
    if (editorShown(t)) t.editor.focus();
    t.editor.setSelection(Math.min(e.pos, t.editor.value.length));
    t.editor.ta.scrollTop = e.top;
    if (e.ptop != null && t.previewEl?.isConnected) t.previewEl.scrollTop = e.ptop;
    renderStatus();
    markActiveHeading();
  });
}
// A jump inside the note (a heading, a line, a search result): the place it
// leaves becomes a step back. Not the jump that comes with opening a note at
// a line (that's one step).
function navJump(tab = fileTab()) {
  const e = nav.stack[nav.index];
  if (!nav.ready || nav.moving || !tab?.editor || e?.path !== tab.path) return;
  if (e.t && performance.now() - e.t < 800) return;
  navKeep(e);
  navPush({ path: tab.path, kind: tab.kind, jump: true });
}

// Drop entries for files that are gone and merge neighbours that became equal.
function navPrune() {
  const out = [];
  let index = -1;
  nav.stack.forEach((e, i) => {
    if (navExists(e) && (e.jump || out[out.length - 1]?.path !== e.path)) out.push(e);
    if (i <= nav.index) index = out.length - 1;
  });
  nav.stack = out;
  nav.index = index;
}

function navRenamed(moved) {
  for (const e of nav.stack) if (moved[e.path]) e.path = moved[e.path];
  navPrune();
}

// Where a step would land: going back from a view that isn't in the history
// (a review, a diff) first returns to the note you were on.
function navTarget(step) {
  const here = activeTab();
  const atEntry = navable(here) && here.path === nav.stack[nav.index]?.path;
  let i = step < 0 && !atEntry ? nav.index : nav.index + step;
  while (i >= 0 && i < nav.stack.length && !navExists(nav.stack[i])) i += step < 0 ? -1 : 1;
  return i >= 0 && i < nav.stack.length ? i : -1;
}

async function navGo(step) {
  const i = navTarget(step);
  if (i < 0) return;
  const e = nav.stack[i];
  const here = activeTab();
  if (navable(here) && here.path === nav.stack[nav.index]?.path) navKeep();
  nav.moving = true;
  try {
    if (e.kind === 'image') openImage(e.path);
    else await openFile(e.path, { focus: e.pos == null });
  } finally { nav.moving = false; }
  navRestore(e);
  nav.index = i;
  navPrune();
  updateNavButtons();
}

function navButtons() {
  return [
    h('button', { class: 'icon-btn nav-btn', 'data-step': '-1', title: withKey('Back', 'nav-back'), 'aria-label': 'Back', disabled: navTarget(-1) < 0, onclick: () => navGo(-1) }, '←'),
    h('button', { class: 'icon-btn nav-btn', 'data-step': '1', title: withKey('Forward', 'nav-forward'), 'aria-label': 'Forward', disabled: navTarget(1) < 0, onclick: () => navGo(1) }, '→'),
  ];
}
function updateNavButtons() {
  for (const b of document.querySelectorAll('.nav-btn')) b.disabled = navTarget(Number(b.dataset.step)) < 0;
}

// Moving an editor between panes re-parents its DOM, so detach it first.
function moveTab(tab, g, rerender = true) {
  const from = tab.group;
  if (from === g) return;
  if (g === 1) ensureSecondGroup();
  tab.group = g;
  if (attachedByGroup[from] === tab) attachedByGroup[from] = null;
  if (S.groups[from]?.active === tab.id) {
    const rest = S.tabs.filter((t) => t.group === from);
    S.groups[from].active = rest[rest.length - 1]?.id || null;
  }
  S.groups[g].active = tab.id;
  S.focus = g;
  closeGroupIfEmpty();
  if (rerender) { persist(); render(); }
}

function splitRight() {
  const tab = activeTab();
  if (S.groups.length > 1) { focusGroup(S.focus === 0 ? 1 : 0); return; }
  if (tab && S.tabs.filter((t) => t.group === 0).length > 1) { moveTab(tab, 1); return; }
  ensureSecondGroup();
  S.focus = 1;
  render();
  openPalette();
}

// Buffers, as in Emacs and Vim: a note closed keeps its cursor, scroll and
// undo for the session, and comes back as it was when opened again (if the
// file hasn't changed meanwhile). The most recently used come first in the
// buffer list (⌥X b b), and ⌥X \` goes back to the one before.
const closedTabs = new Map(); // path → tab
const CLOSED_MAX = 20;
let mru = []; // tab ids, most recent first
function touchMru(tab) { mru = [tab.id, ...mru.filter((x) => x !== tab.id)].slice(0, 100); }
function keepClosed(tab) {
  if (tab.kind !== 'file' || !tab.editor || tab.content !== tab.saved || tab.conflict) { mru = mru.filter((x) => x !== tab.id); return; }
  tab.sel = tab.editor.selectionStart;
  tab.scroll = tab.editor.scrollTop;
  closedTabs.delete(tab.path);
  closedTabs.set(tab.path, tab);
  while (closedTabs.size > CLOSED_MAX) { const [p, t] = closedTabs.entries().next().value; closedTabs.delete(p); mru = mru.filter((x) => x !== t.id); }
}
// The buffers, most recent first: open tabs, then notes closed but kept.
function buffers() {
  const open = new Map(S.tabs.map((t) => [t.id, t]));
  const kept = new Map([...closedTabs.values()].map((t) => [t.id, t]));
  const ids = [...mru, ...S.tabs.map((t) => t.id)].filter((id, i, a) => a.indexOf(id) === i && (open.has(id) || kept.has(id)));
  return ids.map((id) => ({ tab: open.get(id) || kept.get(id), closed: !open.has(id) }));
}
function showBuffer({ tab, closed }) {
  if (closed) return openFile(tab.path);
  activate(tab.id);
  focusEditor();
}
// Back to the buffer before this one (Vim's ⌃^, Doom's SPC \`).
function otherBuffer() {
  const cur = activeTab();
  const b = buffers().find((x) => x.tab !== cur && x.tab.kind !== 'welcome');
  if (!b) { toast('No other note yet'); return; }
  showBuffer(b);
}

async function closeTab(id) {
  const tab = S.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.kind === 'file' && S.settings.autosave && !tab.conflict) await flushAutosave(tab);
  if (tab.kind === 'file' && tab.content !== tab.saved && !(await askConfirm(`Discard unsaved changes to ${tab.path}?`, { okLabel: 'Discard', danger: true }))) return;
  if (tab.kind === 'drawing' && !tab.discard) {
    if (S.settings.autosave && !tab.conflict) await saveDrawing(tab, { flush: true });
    else await flushDrawing(tab);
    if (tab.text !== tab.saved && !(await askConfirm(`Discard unsaved changes to ${tab.path}?`, { okLabel: 'Discard', danger: true }))) return;
  }
  if (tab.kind === 'drawing') { clearTimeout(tab.autosaveTimer); tab.frame?.destroy(); tab.frame = null; }
  if (tab.timer) clearInterval(tab.timer);
  const g = tab.group ?? 0;
  const siblings = S.tabs.filter((t) => t.group === g);
  const idx = siblings.indexOf(tab);
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  if (attachedByGroup[g] === tab) attachedByGroup[g] = null;
  keepClosed(tab);
  if (S.groups[g]?.active === id) {
    const rest = S.tabs.filter((t) => t.group === g);
    S.groups[g].active = (rest[idx] || rest[idx - 1])?.id || null;
  }
  closeGroupIfEmpty();
  persist();
  render();
}

async function saveTab(tab = fileTab(), { force = false } = {}) {
  if (!tab || tab.kind !== 'file') return;
  if (tab.saving) { tab.saveAgain = true; return tab.saving; }
  clearTimeout(tab.autosaveTimer);
  const content = tab.content;
  const run = (async () => {
    try {
      const r = await api('PUT', '/api/file', { path: tab.path, content: toDisk(content, tab.eol), baseHash: tab.hash, force });
      tab.hash = r.hash;
      tab.saved = content;
      tab.conflict = false;
      tab.missing = false;
    } catch (e) {
      if (e.status === 409) { tab.conflict = true; toast('File changed on disk — choose how to resolve it (banner above the editor).', 'error'); }
      else toast(`Save failed: ${e.message}`, 'error');
    }
  })();
  tab.saving = run;
  renderStatus();
  await run;
  tab.saving = null;
  renderTabs(); renderStatus(); renderBanner();
  if (tab.path === RECIPES_FILE) loadRecipes();
  if (tab.path === LEADER_FILE) loadLeaderKeys();
  if (tab.path === MACROS_FILE) loadMacros();
  if (tab.saveAgain) { tab.saveAgain = false; if (tab.content !== tab.saved && !tab.conflict) await saveTab(tab); }
}

// Autosave: shortly after typing stops, and whenever a tab is left or closed.
function scheduleAutosave(tab) {
  if (!S.settings.autosave || tab.conflict) return;
  clearTimeout(tab.autosaveTimer);
  tab.autosaveTimer = setTimeout(() => saveTab(tab), 700);
}

async function flushAutosave(tab) {
  if (!S.settings.autosave || tab.kind !== 'file' || tab.conflict) return;
  clearTimeout(tab.autosaveTimer);
  if (tab.content !== tab.saved) await saveTab(tab);
}

async function reloadTab(tab) {
  const f = await api('GET', `/api/file?path=${encodeURIComponent(tab.path)}`);
  Object.assign(tab, { ...fromDisk(f.content), hash: f.hash, conflict: false, missing: false });
  // Suggesting: the editor shows the suggestions; the note's new text comes
  // when suggesting stops (and the review merges them with it).
  if (tab.editor && !tab.editor.tracking) {
    const { selectionStart, scrollTop } = tab.editor;
    tab.editor.loadText(tab.content);
    tab.editor.setSelection(Math.min(selectionStart, tab.content.length));
    tab.editor.scrollTop = scrollTop;
  }
  if (isAttached(tab)) { renderPreview(tab); renderBanner(tab); renderStatus(); }
  renderTabs();
}

// Pick up edits made outside the app (another editor, git, an applied run).
async function syncTabs(tabs) {
  for (const tab of tabs) {
    try {
      const st = await api('GET', `/api/stat?path=${encodeURIComponent(tab.path)}`);
      if (!st.exists) { tab.missing = true; continue; }
      tab.missing = false;
      if (st.hash === tab.hash || tab.saving) continue;
      if (tab.kind === 'drawing') {
        if (tab.text === tab.saved) await reloadDrawing(tab);
        else tab.conflict = true;
        renderDrawingBanner(tab);
        continue;
      }
      if (tab.content === tab.saved) await reloadTab(tab);
      else tab.conflict = true;
    } catch { /* ignore */ }
  }
  renderBanner();
  renderTabs();
}

const syncOpenTabs = () => syncTabs(S.tabs.filter(isDoc));

async function newNote(folder, template) {
  const base = folder ?? (fileTab() && !isTemplate(fileTab().path) ? dirname(fileTab().path) : '');
  const name = await askText({ title: template ? `New note from “${stem(template)}”` : 'New note', label: 'Path relative to the workspace. “.md” is added if missing.', value: base ? `${base}/` : '', placeholder: 'folder/My note', okLabel: 'Create' });
  if (!name || name.endsWith('/')) return;
  try {
    const filled = template ? await templateText(template, basename(name).replace(/\.md$/i, '')) : null;
    const f = await api('POST', '/api/file', { path: name, content: filled?.text });
    await loadTree();
    await openFile(f.path);
    if (filled?.cursor != null) placeCursor(f.path, filled.cursor);
  } catch (e) { toast(e.message, 'error'); }
}

// + in the tree: a blank note, or — when there are templates — one of them.
function newNoteMenu(e) {
  const all = templateFiles();
  if (!all.length) { newNote(); return; }
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, [
    { label: 'Blank note', run: () => newNote() },
    '-',
    ...all.slice(0, 20).map((f) => ({ label: `From “${stem(f.path)}”`, run: () => newNote(undefined, f.path) })),
  ]);
}

// Templates: the notes in templates/ (see templates.js).
const templateFiles = () => S.files.filter((f) => f.note && isTemplate(f.path)).sort((a, b) => a.path.localeCompare(b.path));
async function templateText(path, title) {
  const open = S.tabs.find((t) => t.kind === 'file' && t.path === path);
  const src = open ? open.content : (await api('GET', `/api/file?path=${encodeURIComponent(path)}`)).content.replace(/\r\n/g, '\n');
  return fillTemplate(src, { title });
}
function placeCursor(path, offset) {
  const tab = S.tabs.find((t) => t.kind === 'file' && t.path === path);
  if (!tab?.editor) return;
  requestAnimationFrame(() => { tab.editor.selectRange(offset, offset); tab.editor.scrollToOffset(offset); });
}
// Choose a template, then do this with it.
function pickTemplate(then, placeholder = 'New note from template…') {
  const all = templateFiles();
  if (!all.length) {
    toast(`No templates yet: notes in the ${TEMPLATE_DIR}/ folder are templates`, '', { label: 'Create one', run: createTemplate });
    return;
  }
  picker({
    placeholder,
    source: (q) => all.map((f) => ({ f, m: fuzzy(q, stem(f.path)) })).filter((x) => x.m).map(({ f, m }) => ({
      icon: '❏', label: marked(stem(f.path), m.idx), hint: dirname(f.path), run: () => then(f.path),
    })),
  });
}
async function createTemplate() {
  const p = `${TEMPLATE_DIR}/Template.md`;
  try {
    if (!S.files.some((f) => f.path === p)) await api('POST', '/api/file', { path: p, content: '# {{title}}\n\nCreated {{date}} {{time}}\n\n{{cursor}}\n' });
    await loadTree();
    openFile(p);
  } catch (e) { toast(e.message, 'error'); }
}
// Insert a template at the caret in the open note.
async function insertTemplate(path) {
  const tab = fileTab();
  if (!tab?.editor) { toast('No note is open'); return; }
  const { text, cursor } = await templateText(path, stem(tab.path));
  const ed = tab.editor;
  const at = ed.ta.selectionStart;
  ed.replace(at, ed.ta.selectionEnd, text);
  if (cursor != null) ed.selectRange(at + cursor, at + cursor);
  ed.focus();
}

const todayPath = () => {
  const d = new Date();
  return `journal/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`;
};

// Quick capture: append one line to Inbox or today's journal without leaving
// what you're doing. Uses the open editor when the note is open (keeps undo).
function quickCapture() {
  const overlay = $('#overlay');
  const close = () => { overlay.hidden = true; overlay.replaceChildren(); };
  let target = store.getItem('an.captureTarget') || 'inbox';
  const text = h('textarea', { class: 'capture-text', placeholder: 'Capture a thought, task or link…', rows: 3 });
  const asTask = h('input', { type: 'checkbox', checked: store.getItem('an.captureTask') !== 'false' });
  const opt = (value, label) => h('label', {}, h('input', { type: 'radio', name: 'capture-target', value, checked: target === value, onchange: () => { target = value; } }), label);
  const save = async () => {
    const line = text.value.trim();
    if (!line) { close(); return; }
    store.setItem('an.captureTarget', target);
    store.setItem('an.captureTask', String(asTask.checked));
    const p = target === 'journal' ? todayPath() : 'Inbox.md';
    const time = new Date().toTimeString().slice(0, 5);
    const entry = line.split('\n').map((l, i) => (i === 0 ? `- ${asTask.checked ? '[ ] ' : ''}${target === 'journal' ? `${time} ` : ''}${l}` : `  ${l}`)).join('\n');
    close();
    try {
      const open = S.tabs.find((t) => t.kind === 'file' && t.path === p);
      if (open?.editor) {
        const v = open.editor.value;
        const add = `${v && !v.endsWith('\n') ? '\n' : ''}${entry}\n`;
        open.editor.replace(v.length, v.length, add);
        await saveTab(open);
      } else {
        let f;
        try { f = await api('GET', `/api/file?path=${encodeURIComponent(p)}`); }
        catch { f = await api('POST', '/api/file', { path: p }); await loadTree(); }
        const add = `${f.content && !f.content.endsWith('\n') ? '\n' : ''}${entry}\n`;
        await api('PUT', '/api/file', { path: p, content: f.content + add, baseHash: f.hash });
      }
      toast(`Captured to ${stem(p)}`, '', { label: 'Open', run: () => openFile(p) });
    } catch (e) { toast(`Capture failed: ${e.message}`, 'error'); }
  };
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.replaceChildren(h('div', { class: 'dialog capture' },
    h('div', { class: 'dialog-body' }, h('h2', {}, 'Quick capture'), text,
      h('div', { class: 'scope-row' }, opt('inbox', 'Inbox'), opt('journal', 'Today’s journal'), h('label', {}, asTask, 'as a task'))),
    h('div', { class: 'dialog-foot' }, h('div', { class: 'grow' }, 'Enter to save · Shift+Enter for a new line'),
      h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Capture'))));
  overlay.hidden = false;
  text.focus();
}

// A new journal note uses templates/Daily.md (or Journal.md) if there is one.
async function openDaily() {
  const p = todayPath();
  let cursor = null;
  if (!S.files.some((f) => f.path === p)) {
    try {
      const t = templateFiles().find((f) => /^(daily|journal)\.md$/i.test(basename(f.path)));
      const filled = t ? await templateText(t.path, stem(p)) : null;
      cursor = filled?.cursor ?? null;
      await api('POST', '/api/file', { path: p, content: filled?.text });
      await loadTree();
    } catch (e) { return toast(e.message, 'error'); }
  }
  await openFile(p);
  if (cursor != null) placeCursor(p, cursor);
}

const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Linked mentions ([[Name]]) plus unlinked ones: plain-text occurrences of the
// note's name elsewhere, which can be turned into links with one click.
async function loadBacklinks(path) {
  const name = stem(path);
  const linkRe = new RegExp(`\\[\\[${escRe(name)}(\\||\\]|#)`, 'i');
  const mentionRe = new RegExp(`(^|[^\\p{L}\\p{N}\\[])(${escRe(name)})(?![\\p{L}\\p{N}\\]])`, 'iu');
  try {
    const [linked, plain] = await Promise.all([
      api('GET', `/api/search?q=${encodeURIComponent(`[[${name}`)}`),
      name.length >= 3 ? api('GET', `/api/search?q=${encodeURIComponent(name)}`) : { results: [] },
    ]);
    S.backlinks = linked.results.filter((x) => x.path !== path && !isTemplate(x.path) && x.matches.some((m) => linkRe.test(m.text)));
    S.mentions = plain.results
      .filter((x) => x.path !== path && isNote(x.path) && !isTemplate(x.path))
      .map((x) => ({ path: x.path, matches: x.matches.filter((m) => mentionRe.test(m.text.replace(/\[\[[^\]]*\]\]/g, ''))) }))
      .filter((x) => x.matches.length)
      .slice(0, 20);
  } catch { S.backlinks = []; S.mentions = []; }
  if (S.view === 'files') renderSidebar();
}

async function linkMention(target, mentionPath, line) {
  const name = stem(target);
  try {
    const f = await api('GET', `/api/file?path=${encodeURIComponent(mentionPath)}`);
    const lines = f.content.split('\n');
    const re = new RegExp(`(^|[^\\p{L}\\p{N}\\[])(${escRe(name)})(?![\\p{L}\\p{N}\\]])`, 'iu');
    const before = lines[line - 1];
    if (!before || !re.test(before)) { toast('That mention changed; refresh and try again.', 'error'); return; }
    lines[line - 1] = before.replace(re, (_, pre, word) => `${pre}[[${word === name ? name : `${name}|${word}`}]]`);
    await api('PUT', '/api/file', { path: mentionPath, content: lines.join('\n'), baseHash: f.hash });
    const open = S.tabs.find((t) => t.kind === 'file' && t.path === mentionPath);
    if (open) await syncTabs([open]);
    toast(`Linked in ${stem(mentionPath)}`);
    loadBacklinks(target);
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ render: sidebar

function renderActivity() {
  document.querySelectorAll('#activity [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view && !$('#app').classList.contains('no-sidebar')));
  const badge = $('#agent-badge');
  const running = S.runs.some((r) => r.status === 'running');
  const review = S.runs.some((r) => r.status === 'review');
  badge.hidden = !running && !review;
  badge.className = running ? 'is-running' : 'is-review';
}

function renderSidebar() {
  const sb = $('#sidebar');
  // The panel is rebuilt on every change: keep its scroll position.
  const keep = sb.dataset.view === S.view ? sb.querySelector('.panel-body')?.scrollTop : 0;
  const shown = sb.dataset.view !== S.view && S.view === 'files';
  // A row focused from the keyboard keeps the focus.
  const fr = sb.contains(document.activeElement) && document.activeElement.closest?.(LIST_ROWS);
  const was = fr && { cls: fr.classList[0], id: fr.dataset.path || fr.dataset.bookmark || fr.title, text: fr.textContent };
  sb.dataset.view = S.view;
  sb.replaceChildren(...(S.view === 'search' ? searchPanel() : S.view === 'agent' ? agentPanel() : S.view === 'git' ? gitPanel() : filesPanel()));
  const body = sb.querySelector('.panel-body');
  if (body && keep) body.scrollTop = keep;
  if (shown && S.settings.followTab) sb.querySelector('.tree-row.active[data-path]')?.scrollIntoView({ block: 'nearest' });
  if (was) focusRow([...sb.querySelectorAll(LIST_ROWS)].find((r) => r.classList[0] === was.cls && (r.dataset.path || r.dataset.bookmark || r.title) === was.id && r.textContent === was.text));
  renderActivity();
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const d of S.dirs) {
    let node = root;
    d.split('/').forEach((part, i, parts) => {
      const key = parts.slice(0, i + 1).join('/');
      if (!node.dirs.has(part)) node.dirs.set(part, { path: key, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    });
  }
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { path: key, dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push(f);
  }
  return root;
}

function treeRows(node, depth, rows) {
  const pad = (d) => `${8 + d * 12}px`;
  for (const [name, dir] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const open = S.expanded.has(dir.path);
    const row = h('div', { class: 'tree-row', title: dir.path,
      onclick: () => { open ? S.expanded.delete(dir.path) : S.expanded.add(dir.path); persist(); renderSidebar(); },
      oncontextmenu: (e) => folderMenu(e, dir.path) },
    h('span', { class: 'chev' }, open ? '▾' : '▸'), h('span', { class: 'name' }, name));
    row.style.paddingLeft = pad(depth);
    rows.push(row);
    if (open) treeRows(dir, depth + 1, rows);
  }
  const active = (fileTab() || drawingTab())?.path;
  for (const f of node.files.sort((a, b) => a.path.localeCompare(b.path))) {
    const drawing = isDrawing(f.path);
    const row = h('div', { class: `tree-row${f.path === active ? ' active' : ''}${f.note || drawing || isMermaidFile(f.path) ? '' : ' dim'}`, title: f.path, 'data-path': f.path,
      onclick: (e) => (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(f.path) ? openImage(f.path) : openFile(f.path, { side: e.metaKey || e.ctrlKey })),
      oncontextmenu: (e) => fileMenu(e, f) },
    h('span', { class: 'chev' }, drawing ? '◇' : isMermaidFile(f.path) ? '◈' : f.note ? '' : '·'), h('span', { class: 'name' }, f.note ? basename(f.path).replace(/\.md$/, '') : basename(f.path)),
    S.gitMap.has(f.path) ? h('span', { class: `git-code gc-${S.gitMap.get(f.path)}`, title: 'Changed since last commit' }, S.gitMap.get(f.path)) : null);
    row.style.paddingLeft = pad(depth);
    rows.push(row);
  }
  return rows;
}

// The open file's row in the tree: its folders opened, scrolled to, flashed.
function locateFile() {
  const path = (fileTab() || drawingTab())?.path;
  if (!path) { toast('No file is open'); return; }
  showInTree(path);
}

// quiet (the tree following the active tab): its folders are opened even
// while the tree is hidden, so it's there when the tree shows; scrolled only
// as far as needed, and flashed only if the tree had to move to show it.
function showInTree(path, { quiet = false } = {}) {
  const hidden = S.view !== 'files' || $('#app').classList.contains('no-sidebar');
  let opened = false;
  for (let d = dirname(path); d; d = dirname(d)) if (!S.expanded.has(d)) { S.expanded.add(d); opened = true; }
  if (quiet && hidden) { if (opened) persist(); return; }
  if (!quiet) { S.view = 'files'; $('#app').classList.remove('no-sidebar'); }
  persist();
  if (opened || !quiet) renderSidebar();
  const row = [...$('#sidebar').querySelectorAll('.tree-row')].find((r) => r.dataset.path === path);
  if (!row) { if (!quiet) toast('The open file is not in this workspace’s tree'); return; }
  const body = row.closest('.panel-body');
  const before = body?.scrollTop;
  row.scrollIntoView({ block: quiet ? 'nearest' : 'center' });
  if (quiet && !opened && body?.scrollTop === before) return;
  row.classList.remove('located');
  void row.offsetWidth; // restart the flash
  row.classList.add('located');
  setTimeout(() => row.classList.remove('located'), 1200);
}

// Bookmarks: files kept at the top of the tree, per workspace. One that is
// gone (deleted, or not there yet) stays bookmarked but isn't shown.
const isBookmarked = (path) => S.bookmarks.includes(path);
function saveBookmarks() { store.setItem(`an.bookmarks.${S.info?.root}`, JSON.stringify(S.bookmarks)); }
function toggleBookmark(path) {
  if (!path) { toast('No file is open'); return; }
  const on = !isBookmarked(path);
  S.bookmarks = on ? [...S.bookmarks, path] : S.bookmarks.filter((p) => p !== path);
  saveBookmarks();
  toast(on ? `Bookmarked ${basename(path)}` : `Removed the bookmark on ${basename(path)}`);
  renderSidebar();
}
// Swap with the next shown one (a missing file's bookmark isn't shown).
function moveBookmark(path, by) {
  const shown = S.bookmarks.filter((p) => S.files.some((f) => f.path === p));
  const other = shown[shown.indexOf(path) + by];
  if (!other || !shown.includes(path)) return;
  const b = [...S.bookmarks];
  const i = b.indexOf(path);
  const j = b.indexOf(other);
  [b[i], b[j]] = [b[j], b[i]];
  S.bookmarks = b;
  saveBookmarks();
  renderSidebar();
}
function bookmarkRows() {
  const files = new Map(S.files.map((f) => [f.path, f]));
  const shown = S.bookmarks.filter((p) => files.has(p));
  if (!shown.length) return [];
  const active = (fileTab() || drawingTab())?.path;
  return [h('div', { class: 'section-label' }, 'Bookmarks'), ...shown.map((p, i) => {
    const f = files.get(p);
    const name = f.note ? stem(p) : basename(p);
    const row = h('div', { class: `tree-row bookmark-row${p === active ? ' active' : ''}`, title: p, 'data-bookmark': p,
      onclick: (e) => (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i.test(p) ? openImage(p) : openFile(p, { side: e.metaKey || e.ctrlKey })),
      oncontextmenu: (e) => contextMenu(e, [
        { label: 'Open', run: () => openFile(p) },
        f.note ? { label: 'Open to the side', key: `${MOD}click`, run: () => openFile(p, { side: true }) } : null,
        { label: 'Show in the tree', run: () => showInTree(p) },
        '-',
        i > 0 ? { label: 'Move up', run: () => moveBookmark(p, -1) } : null,
        i < shown.length - 1 ? { label: 'Move down', run: () => moveBookmark(p, 1) } : null,
        { label: 'Remove bookmark', run: () => toggleBookmark(p) },
      ]) },
    h('span', { class: 'chev' }, '★'), h('span', { class: 'name' }, name),
    dirname(p) ? h('span', { class: 'bookmark-dir' }, dirname(p)) : null);
    row.style.paddingLeft = '8px';
    return row;
  }), h('div', { class: 'section-label' }, 'Files')];
}

function toggleFollowTab() {
  setSetting('followTab', !S.settings.followTab);
  toast(S.settings.followTab ? 'The tree follows the active tab' : 'The tree no longer follows the active tab');
  renderSidebar();
  const path = (fileTab() || drawingTab())?.path;
  if (S.settings.followTab && path) showInTree(path, { quiet: true });
}

function filesPanel() {
  const tab = fileTab();
  const out = [
    h('div', { class: 'panel-head' },
      h('span', { class: 'title', title: S.info?.root }, S.info?.name || 'Workspace'),
      h('button', { class: `icon-btn follow-tab${S.settings.followTab ? ' on' : ''}`, title: `Follow the active tab: ${S.settings.followTab ? 'on' : 'off'}`, 'aria-pressed': String(!!S.settings.followTab), onclick: toggleFollowTab }, '⇅'),
      h('button', { class: 'icon-btn', title: 'Show the open file in the tree', onclick: locateFile }, '◎'),
      h('button', { class: 'icon-btn', title: 'Today’s journal note', onclick: openDaily }, '◷'),
      h('button', { class: 'icon-btn new-note', title: 'New note', onclick: newNoteMenu }, '+'),
      h('button', { class: 'icon-btn', title: 'New folder', onclick: () => newFolder() }, '⊞'),
      h('button', { class: 'icon-btn', title: 'Refresh', onclick: () => loadTree().then(syncOpenTabs) }, '↻')),
  ];
  const body = h('div', { class: 'panel-body' });
  const rows = treeRows(buildTree(S.files), 0, []);
  body.append(...bookmarkRows());
  body.append(...(rows.length ? rows : [h('div', { class: 'empty' }, 'No files yet. Create a note with +.')]));
  if (S.tags.length) {
    body.append(h('div', { class: 'section-label' }, `Tags (${S.tags.length})`),
      h('div', { class: 'tag-cloud' }, S.tags.slice(0, 40).map((t) => h('button', { class: 'tag-chip', title: `Search #${t.tag}`, onclick: () => searchFor(`#${t.tag}`) }, `#${t.tag}`, h('span', {}, t.count)))));
  }
  if (tab && isNote(tab.path)) {
    const items = outline(tab.content);
    if (items.length) {
      body.append(h('div', { class: 'section-label' }, 'Outline'));
      const min = Math.min(...items.map((i) => i.level));
      for (const it of items) {
        const row = h('div', { class: 'outline-row heading-row', 'data-line': String(it.line), onclick: () => gotoHeading(it.line) }, it.text.replace(/[*_`]/g, ''));
        row.style.paddingLeft = `${12 + (it.level - min) * 12}px`;
        body.append(row);
      }
    }
    body.append(h('div', { class: 'section-label' }, `Linked from (${S.backlinks.length})`));
    if (!S.backlinks.length) body.append(h('div', { class: 'empty' }, `No notes link to [[${stem(tab.path)}]] yet.`));
    for (const b of S.backlinks) body.append(h('div', { class: 'outline-row', title: b.path, onclick: () => openFile(b.path, { line: b.matches[0]?.line }) }, `↩ ${stem(b.path)}`));
    if (S.mentions?.length) {
      body.append(h('div', { class: 'section-label' }, `Unlinked mentions (${S.mentions.length})`));
      for (const m of S.mentions) {
        const first = m.matches[0];
        body.append(h('div', { class: 'mention-row', title: first.text.trim() },
          h('span', { class: 'mention-name', onclick: () => openFile(m.path, { line: first.line }) }, stem(m.path)),
          h('button', { class: 'mention-link', title: `Turn this mention into [[${stem(tab.path)}]]`, onclick: () => linkMention(tab.path, m.path, first.line) }, 'Link')));
      }
    }
  }
  out.push(body);
  return out;
}

const runSearch = debounce(async () => {
  const q = S.searchQuery;
  if (!q.trim()) { S.searchResults = null; renderSearchResults(); searchChanged(); return; }
  try {
    const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    if (q === S.searchQuery) { S.searchResults = r; S.searchAt = null; renderSearchResults(); searchChanged(); }
  } catch (e) { toast(e.message, 'error'); }
}, 180);

function highlight(text, q) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  let pos = 0;
  for (let i = lower.indexOf(ql); i !== -1 && ql; i = lower.indexOf(ql, pos)) {
    frag.append(text.slice(pos, i), h('b', {}, text.slice(i, i + q.length)));
    pos = i + q.length;
  }
  frag.append(text.slice(pos));
  return frag;
}

// The search results as a list to step through from the note (Emacs
// next-error, Vim :cnext): ⌥X s n / s p, F8 / ⇧F8.
const searchHits = () => (S.searchResults?.results || []).flatMap((f) => f.matches.map((m) => ({ path: f.path, line: m.line })));
async function stepSearch(by) {
  const hits = searchHits();
  if (!hits.length) { toast(S.searchQuery ? 'No search results' : 'Nothing searched yet', '', { label: 'Search', run: () => ACTIONS.search() }); return; }
  let i = S.searchAt ?? -1;
  const tab = fileTab();
  if (!(hits[i] && tab?.path === hits[i].path && tab.editor?.cursorLine() === hits[i].line)) {
    // Not on the last one: from where the cursor is.
    const line = tab?.editor?.cursorLine() ?? 0;
    const here = hits.findIndex((x) => x.path === tab?.path && (by > 0 ? x.line > line : x.line >= line));
    if (here >= 0) i = by > 0 ? here - 1 : here;
    else if (tab && hits.some((x) => x.path === tab.path)) i = by > 0 ? hits.findLastIndex((x) => x.path === tab.path) : hits.findIndex((x) => x.path === tab.path);
  }
  i = ((i + by) % hits.length + hits.length) % hits.length;
  await openSearchHit(i, { reveal: true });
  toast(`${i + 1} / ${hits.length}  ${hits[i].path}:${hits[i].line}`);
}
async function openSearchHit(i, { reveal = false } = {}) {
  const hit = searchHits()[i];
  if (!hit) return;
  S.searchAt = i;
  document.querySelectorAll('#search-results .search-hit').forEach((r, k) => r.classList.toggle('current', k === i));
  const same = fileTab()?.path === hit.path;
  if (same) navJump();
  await openFile(hit.path, { focus: false });
  const tab = S.tabs.find((t) => t.kind === 'file' && t.path === hit.path);
  if (!tab?.editor) return;
  requestAnimationFrame(() => {
    if (groupMode(tab) === 'preview') setMode('split');
    const v = tab.editor.value;
    const a = lineOffset(v, hit.line - 1);
    const text = v.slice(a, (v.indexOf('\n', a) + 1 || v.length + 1) - 1);
    const at = text.toLowerCase().indexOf(S.searchQuery.toLowerCase());
    gotoOffset(tab, at >= 0 ? a + at : a, at >= 0 ? a + at + S.searchQuery.length : a);
    if (reveal) $('#search-results .search-hit.current')?.scrollIntoView({ block: 'nearest' });
  });
}

function renderSearchResults(box = $('#search-results')) {
  if (!box) return;
  const r = S.searchResults;
  if (!r) { box.replaceChildren(h('div', { class: 'empty' }, 'Search file names and contents. Case-insensitive.')); return; }
  if (!r.results.length) { box.replaceChildren(h('div', { class: 'empty' }, 'No matches.')); return; }
  const rows = [];
  let n = 0;
  for (const f of r.results) {
    const first = n;
    rows.push(h('div', { class: 'search-file', title: f.path, onclick: () => (f.matches.length ? openSearchHit(first) : openFile(f.path)) },
      h('span', {}, f.path), h('span', { class: 'count' }, f.matches.length || '')));
    for (const m of f.matches) {
      const i = n++;
      rows.push(h('div', { class: `search-hit${i === S.searchAt ? ' current' : ''}`, onclick: () => openSearchHit(i) },
        h('span', { class: 'ln' }, m.line), highlight(m.text.trim(), S.searchQuery)));
    }
  }
  if (r.truncated) rows.push(h('div', { class: 'empty' }, 'Results truncated — refine your query.'));
  box.replaceChildren(...rows);
}

function searchPanel() {
  const input = h('input', { class: 'input', id: 'search-input', placeholder: 'Search workspace', value: S.searchQuery,
    oninput: (e) => { S.searchQuery = e.target.value; runSearch(); },
    onkeydown: (e) => { if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.isComposing)) { e.preventDefault(); focusRow($('#search-results')?.querySelector('.search-hit, .search-file')); } } });
  const list = h('div', { class: 'panel-body', id: 'search-results' });
  // Filled now, not later: renderSidebar puts the scroll position back right
  // after this, and an empty list would take it back to the top.
  renderSearchResults(list);
  return [h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Search')), h('div', { class: 'search-box' }, input), list];
}

// Sign-in state of CLI agents (claude/codex), checked by the server.
let agentStatusLoading = null;
function loadAgentStatus(fresh = false) {
  if (agentStatusLoading && !fresh) return agentStatusLoading;
  agentStatusLoading = api('GET', `/api/agents/status${fresh ? '?fresh=1' : ''}`)
    .then((r) => { S.agentStatus = r.agents; if (S.view === 'agent') renderSidebar(); return r.agents; })
    .catch(() => { S.agentStatus = []; return []; });
  return agentStatusLoading;
}

function signInWarning(a, st) {
  return h('div', { class: 'agent-note' }, '⚠ ', h('b', {}, a.label), `: ${st.message} `,
    st.login ? h('span', {}, 'Run ', h('code', {}, st.login), ' in Terminal, then try again.') : null);
}

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));
function usageText(u, short = false) {
  if (!u) return '';
  const cost = u.costUsd != null ? `$${u.costUsd < 0.01 ? u.costUsd.toFixed(4) : u.costUsd.toFixed(2)}` : '';
  if (short) return cost || `${fmtTokens(u.input + u.output)} tok`;
  return `${fmtTokens(u.input)} in · ${fmtTokens(u.output)} out${cost ? ` · ${cost}` : ''}`;
}
const usageTitle = (u) => (u ? `Input ${u.input.toLocaleString()} tokens (${u.cached.toLocaleString()} from cache), output ${u.output.toLocaleString()} tokens${u.costUsd != null ? `, cost reported by the CLI: $${u.costUsd}` : ''}` : '');

function agentPanel() {
  const a = S.info?.agent;
  if (a?.configured && !S.agentStatus) loadAgentStatus();
  const warnings = (S.agentStatus || []).filter((st) => st.ok === false)
    .map((st) => [S.info.agents.find((x) => x.id === st.id), st]).filter(([x]) => x);
  const out = [h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Agent'),
    h('button', { class: 'icon-btn', title: 'Refresh', onclick: loadRuns }, '↻'))];
  const body = h('div', { class: 'panel-body' });
  body.append(h('div', { class: 'agent-card' }, a?.configured
    ? [h('div', {}, h('b', {}, a.label)),
      h('p', {}, 'Works on a staged copy. Nothing in your notes changes until you accept it.'),
      h('button', { class: 'btn primary small', onclick: () => openTaskDialog() }, `New task  ${kbd('delegate')}`),
      desktop ? h('button', { class: 'btn small', onclick: () => desktop.configureAgent() }, 'Manage agents…') : null,
      (S.info.agents || []).length > 1 ? h('p', {}, `${S.info.agents.length} agents available — pick one per task.`) : null,
      ...warnings.map(([x, st]) => signInWarning(x, st))]
    : desktop ? [h('div', {}, h('b', {}, 'No agent configured')),
      h('p', {}, 'Agents are opt-in. Pick the offline demo agent to try the review flow, or connect a CLI agent.'),
      h('button', { class: 'btn primary small', onclick: () => desktop.configureAgent() }, 'Choose agent…'),
      h('p', {}, 'Private notes (front matter ', h('code', {}, 'private: true'), ' or ', h('code', {}, '.agentnotesignore'), ') are never shared.')]
    : [h('div', {}, h('b', {}, 'No agent configured')),
      h('p', {}, 'Agents are opt-in. Restart with one of:'),
      h('p', {}, h('code', {}, '--agent demo'), ' (offline demo)'),
      h('p', {}, h('code', {}, '--agent "claude -p --permission-mode acceptEdits"')),
      h('p', {}, 'Private notes (front matter ', h('code', {}, 'private: true'), ' or ', h('code', {}, '.agentnotesignore'), ') are never shared.')]));
  body.append(h('div', { class: 'section-label' }, 'Runs'));
  if (!S.runs.length) body.append(h('div', { class: 'empty' }, 'No runs yet.'));
  const active = activeTab();
  for (const r of S.runs) {
    body.append(h('div', { class: `run-row${active?.runId === r.id ? ' active' : ''}`, onclick: () => openReview(r.id) },
      h('div', { class: 'task', title: r.task }, r.recipe ? h('b', {}, `${r.recipe} · `) : null, r.task),
      h('div', { class: 'meta' }, h('span', { class: `badge st-${r.status}` }, r.status), h('span', {}, r.focus ? stem(r.focus) : r.scope), h('span', {}, timeAgo(r.startedAt)),
        r.usage ? h('span', { class: 'usage', title: usageTitle(r.usage) }, usageText(r.usage, true)) : null)));
  }
  out.push(body);
  return out;
}

// ------------------------------------------------------------------ render: main

function render() {
  ensurePanes();
  renderTabs();
  S.groups.forEach((_, g) => renderContent(g));
  renderSidebar();
  renderStatus();
}

// Pane skeletons: one per group, each with its own tab strip and content.
function ensurePanes() {
  const host = $('#panes');
  const want = S.groups.length;
  while (host.children.length > want) host.lastElementChild.remove();
  while (host.children.length < want) {
    const g = host.children.length;
    const pane = h('div', { class: 'pane', 'data-g': String(g), onpointerdown: () => focusGroup(g) },
      h('div', { class: 'tabs', role: 'tablist' }), h('div', { class: 'pane-content' }));
    host.append(pane);
  }
  host.classList.toggle('split', want > 1);
  [...host.children].forEach((p, g) => p.classList.toggle('focused', g === S.focus && want > 1));
  const second = host.children[1];
  if (second && !second.querySelector('.pane-resizer')) {
    second.prepend(h('div', { class: 'pane-resizer', title: 'Drag to resize · double-click to reset', onpointerdown: resizePanes, ondblclick: () => setSplitRatio(0.5, true) }));
  }
  setSplitRatio(splitRatio);
}

// Width of the left pane in a split, as a share of both (see splitRatio).
function setSplitRatio(r, save = false) {
  splitRatio = Math.max(0.15, Math.min(0.85, r));
  const first = $('#panes')?.children[0];
  if (first) first.style.flexGrow = S.groups.length > 1 ? String(splitRatio / (1 - splitRatio)) : '';
  if (save) store.setItem('an.splitRatio', String(splitRatio));
  placeFramesSoon();
}
function resizePanes(e) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('active');
  const box = $('#panes').getBoundingClientRect();
  const at = (ev) => (ev.clientX - box.left) / box.width;
  const move = (ev) => setSplitRatio(at(ev));
  const up = (ev) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.classList.remove('active');
    setSplitRatio(at(ev), true);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
}
const paneEl = (g) => $(`#panes .pane[data-g="${g}"]`);

// Width of the editor next to the preview or canvas, as a share of the
// note's area; remembered separately for split and canvas.
const editorRatio = (() => { try { return JSON.parse(store.getItem('an.editorRatio')) || {}; } catch { return {}; } })();
const wrapMode = (wrap) => (wrap.classList.contains('mode-canvas') ? 'canvas' : 'split');
function setEditorRatio(wrap, r, save = false) {
  r = Math.max(0.2, Math.min(0.8, r));
  wrap.style.setProperty('--ed-left', `${r}fr`);
  wrap.style.setProperty('--ed-right', `${1 - r}fr`);
  wrap.style.setProperty('--ed-at', `${r * 100}%`);
  if (save) {
    editorRatio[wrapMode(wrap)] = r;
    store.setItem('an.editorRatio', JSON.stringify(editorRatio));
  }
  placeFramesSoon();
}
function resizeEditor(e) {
  e.preventDefault();
  e.stopPropagation();
  const handle = e.currentTarget;
  const wrap = handle.parentElement;
  handle.setPointerCapture(e.pointerId);
  handle.classList.add('active');
  const box = wrap.getBoundingClientRect();
  const at = (ev) => (ev.clientX - box.left) / box.width;
  const move = (ev) => setEditorRatio(wrap, at(ev));
  const up = (ev) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.classList.remove('active');
    setEditorRatio(wrap, at(ev), true);
    // Other notes in the same mode follow.
    for (const w of document.querySelectorAll('.editor-wrap')) if (w !== wrap && wrapMode(w) === wrapMode(wrap)) setEditorRatio(w, editorRatio[wrapMode(wrap)]);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
}

function renderTabs() {
  ensurePanes();
  S.groups.forEach((grp, g) => {
  const bar = paneEl(g).querySelector('.tabs');
  bar.replaceChildren(...S.tabs.filter((t) => t.group === g).map((t) => {
    const dirty = (t.kind === 'file' && t.content !== t.saved) || (t.kind === 'drawing' && t.text !== t.saved);
    const label = SPECIAL[t.kind] ? SPECIAL[t.kind].name(t) : basename(t.path);
    return h('div', { class: `tab${t.id === grp.active ? ' active' : ''}${dirty ? ' dirty' : ''}`, title: t.path || t.title, draggable: 'true',
      'data-id': t.id,
      ondragstart: (e) => { e.dataTransfer.setData('text/x-agent-notes-tab', t.id); e.dataTransfer.effectAllowed = 'move'; document.body.classList.add('tab-dragging'); },
      ondragend: tabDragEnd,
      onclick: () => activate(t.id), onauxclick: (e) => { if (e.button === 1) closeTab(t.id); },
      oncontextmenu: (e) => contextMenu(e, [
        { label: S.groups.length > 1 ? 'Move to other pane' : 'Open to the side', run: () => moveTab(t, t.group === 0 ? 1 : 0) },
        isDoc(t) ? { label: 'Rename / move file…', run: () => renameItem(t.path) } : null,
        '-',
        { label: 'Close', run: () => closeTab(t.id) },
        { label: 'Close others', run: () => closeTabs(S.tabs.filter((x) => x.group === t.group && x !== t)) },
        { label: 'Close to the right', run: () => { const row = S.tabs.filter((x) => x.group === t.group); closeTabs(row.slice(row.indexOf(t) + 1)); } },
        { label: 'Close all', run: () => closeTabs(S.tabs.filter((x) => x.group === t.group)) },
      ]) },
    t.kind === 'review' ? h('span', { class: 'kind' }, '✦') : null,
    h('span', { class: 'label' }, label),
    h('button', { class: 'close', title: 'Close', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, h('span', {}, '×')));
  }), S.groups.length > 1 ? h('button', { class: 'pane-close', title: 'Close pane (tabs move to the other pane)', onclick: () => closePane(g) }, '×') : '');
  // Drag a tab to reorder it, here or from the other pane.
  bar.ondragover = (e) => {
    if (!e.dataTransfer.types.includes('text/x-agent-notes-tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { before, el } = tabDropTarget(bar, e.clientX);
    clearTabMarks();
    if (el) el.classList.add(before ? 'drop-before' : 'drop-after');
    else bar.classList.add('drop-end');
  };
  bar.ondragleave = (e) => { if (!bar.contains(e.relatedTarget)) clearTabMarks(); };
  bar.ondrop = (e) => {
    const t = tabById(e.dataTransfer.getData('text/x-agent-notes-tab'));
    const { before, el } = tabDropTarget(bar, e.clientX);
    tabDragEnd();
    if (!t) return;
    e.preventDefault();
    const target = el && tabById(el.dataset.id);
    placeTab(t, g, target ? (before ? target : S.tabs.filter((x) => x.group === g)[S.tabs.filter((x) => x.group === g).indexOf(target) + 1] || null) : null);
  };
  bar.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

// The tab a drop at clientX lands next to: { el, before } (el null = after the last).
function tabDropTarget(bar, x) {
  const tabs = [...bar.querySelectorAll('.tab')];
  for (const el of tabs) {
    const r = el.getBoundingClientRect();
    if (x < r.right) return { el, before: x < r.left + r.width / 2 };
  }
  return { el: null, before: false };
}
function clearTabMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-end')) el.classList.remove('drop-before', 'drop-after', 'drop-end');
}
function tabDragEnd() {
  clearTabMarks();
  document.body.classList.remove('tab-dragging');
  const hint = $('#drop-hint');
  if (hint) hint.hidden = true;
}

// Put `tab` in pane g, just before `before` (a tab in g) or at the end.
function placeTab(tab, g, before = null) {
  if (before === tab) return;
  const moved = tab.group !== g;
  if (moved) moveTab(tab, g, false);
  S.tabs.splice(S.tabs.indexOf(tab), 1);
  S.tabs.splice(before && S.tabs.includes(before) ? S.tabs.indexOf(before) : S.tabs.length, 0, tab);
  if (!moved) { S.groups[g].active = tab.id; S.focus = g; }
  persist();
  render();
}

// Close several tabs; each unsaved one asks first (see closeTab).
async function closeTabs(tabs) {
  for (const t of [...tabs]) await closeTab(t.id);
}

// Drop a tab on the left or right half of a pane to show it on that side.
function paneDropZone(e) {
  const c = e.target.closest?.('.pane-content');
  if (!c) return null;
  const g = Number(c.closest('.pane').dataset.g);
  const r = c.getBoundingClientRect();
  if (S.groups.length > 1) return { g, rect: r, side: g === 0 ? 'left' : 'right' };
  const side = e.clientX < r.left + r.width / 2 ? 'left' : 'right';
  return { g, side, rect: side === 'left' ? { left: r.left, top: r.top, width: r.width / 2, height: r.height } : { left: r.left + r.width / 2, top: r.top, width: r.width / 2, height: r.height } };
}
$('#panes').addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('text/x-agent-notes-tab')) return;
  const z = paneDropZone(e);
  let hint = $('#drop-hint');
  if (!hint) { hint = h('div', { id: 'drop-hint' }); document.body.append(hint); }
  if (!z) { hint.hidden = true; return; }
  e.preventDefault();
  e.stopPropagation(); // not a file drop
  e.dataTransfer.dropEffect = 'move';
  hint.hidden = false;
  Object.assign(hint.style, { left: `${z.rect.left}px`, top: `${z.rect.top}px`, width: `${z.rect.width}px`, height: `${z.rect.height}px` });
});
$('#panes').addEventListener('dragleave', (e) => { if (!$('#panes').contains(e.relatedTarget) && $('#drop-hint')) $('#drop-hint').hidden = true; });
$('#panes').addEventListener('drop', (e) => {
  const t = tabById(e.dataTransfer.getData('text/x-agent-notes-tab'));
  const z = t && paneDropZone(e);
  tabDragEnd();
  if (!z) return;
  e.preventDefault();
  e.stopPropagation();
  if (S.groups.length > 1) { if (t.group !== z.g) placeTab(t, z.g); return; }
  if (S.tabs.filter((x) => x.group === 0).length < 2) return; // nothing to split from
  moveTab(t, 1, false);
  if (z.side === 'left') swapPanes();
  persist();
  render();
});

// Exchange the two panes (tabs, active tab, mode).
function swapPanes() {
  if (S.groups.length < 2) return;
  for (const t of S.tabs) t.group = t.group === 0 ? 1 : 0;
  S.groups.reverse();
  attachedByGroup[0] = null;
  attachedByGroup[1] = null;
  S.focus = S.focus === 0 ? 1 : 0;
}

function closePane(g) {
  if (S.groups.length < 2) return;
  const other = g === 0 ? 1 : 0;
  for (const t of S.tabs) if (t.group === g) t.group = other;
  if (attachedByGroup[g]) attachedByGroup[g] = null;
  S.groups[g].active = null;
  closeGroupIfEmpty();
  persist();
  render();
}

function renderContent(g = S.focus) {
  placeFramesSoon();
  ensurePanes();
  const pane = paneEl(g);
  if (!pane) return;
  const c = pane.querySelector('.pane-content');
  const tab = activeIn(g);
  if (attachedByGroup[g] && attachedByGroup[g] !== tab) attachedByGroup[g] = null;
  if (!tab) { c.replaceChildren(g === 0 ? welcome() : h('div', { class: 'empty pane-empty' }, 'Open a note here with ', h('kbd', {}, kbd('quick-open') || 'the palette'), '.')); return; }
  if (SPECIAL[tab.kind]) { showSpecial(c, tab); return; }
  if (tab.kind === 'drawing') { drawingView(tab, c); return; }
  if (tab.kind === 'image') {
    c.replaceChildren(h('div', { class: 'toolbar' }, ...navButtons(), h('span', { class: 'crumbs' }, tab.path.split('/').join('  ›  '))),
      h('div', { class: 'image-view' }, h('img', { src: `/api/raw?path=${encodeURIComponent(tab.path)}&t=${token}`, alt: tab.path })));
    return;
  }

  const ed = editorFor(tab);
  const preview = h('div', { class: 'preview md', onclick: (e) => previewClick(e, tab), onmouseover: (e) => previewLinkHover(e, tab), onkeydown: (e) => previewKeys(e, tab) });
  let mode = groupMode(tab);
  if (mode === 'canvas' && !isNote(tab.path)) mode = 'split';
  const wrap = h('div', { class: `editor-wrap mode-${hasPreview(tab.path) ? mode : 'edit'}` }, ed.el, preview, mode === 'canvas' ? canvasFor(tab).el : null,
    h('div', { class: 'ed-resizer', title: 'Drag to resize · double-click to reset', onpointerdown: resizeEditor, ondblclick: (e) => setEditorRatio(e.currentTarget.parentElement, 0.5, true) }));
  setEditorRatio(wrap, editorRatio[wrapMode(wrap)] ?? 0.5);
  const seg = h('div', { class: 'seg' }, ...(isNote(tab.path) ? ['edit', 'split', 'canvas', 'preview'] : ['edit', 'split', 'preview']).map((m) =>
    h('button', { class: mode === m ? 'on' : '', title: kbd('cycle-mode') ? `${m[0].toUpperCase() + m.slice(1)} (${kbd('cycle-mode')} cycles)` : m[0].toUpperCase() + m.slice(1), onclick: () => { S.focus = tab.group; setMode(m); } }, m[0].toUpperCase() + m.slice(1))));
  const toolbar = h('div', { class: 'toolbar' },
    ...navButtons(),
    h('span', { class: 'crumbs' }, tab.path.split('/').join('  ›  ')),
    hasPreview(tab.path) ? seg : null,
    isMermaidFile(tab.path) ? h('button', { class: 'icon-btn', title: 'Copy diagram as image (PNG)', onclick: () => copyPicture(mermaidFilePicture(tab)) }, '⧉') : null,
    h('button', { class: 'icon-btn', title: withKey('Find in note', 'find'), onclick: () => findInNote(tab) }, '⌕'),
    h('button', { class: 'icon-btn', title: S.groups.length > 1 ? 'Move to the other pane' : withKey('Open to the side', 'split'), onclick: () => (S.groups.length > 1 ? moveTab(tab, tab.group === 0 ? 1 : 0) : splitRight()) }, '◫'),
    h('button', { class: 'icon-btn', title: withKey('Focus mode', 'focus'), onclick: toggleFocusMode }, '⛶'),
    h('button', { class: 'icon-btn', title: 'More actions', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.right - 200, clientY: r.bottom + 4 }, [
      { label: 'Rename / move…', key: kbd('rename'), run: () => renameItem(tab.path) },
      { label: 'Copy [[link]]', run: () => navigator.clipboard.writeText(`[[${stem(tab.path)}]]`).then(() => toast('Link copied')) },
      isNote(tab.path) ? { label: 'Copy for GitHub (flows as Mermaid)', run: () => copyWithMermaid(tab) } : null,
      isMermaidFile(tab.path) ? { label: 'Copy embed ![[…]]', run: () => navigator.clipboard.writeText(`![[${basename(tab.path)}]]`).then(() => toast('Embed copied — paste it into a note')) } : null,
      ...(isMermaidFile(tab.path) ? ['-', ...pictureItems(() => mermaidFilePicture(tab), { view: () => viewPicture(mermaidFilePicture(tab), basename(tab.path)) })] : []),
      '-',
      { label: 'History…', run: () => openHistory(tab.path) },
      S.gitMap.has(tab.path) ? { label: 'Changes since last commit', run: () => openGitDiff(tab.path) } : null,
      '-',
      { label: 'Export as HTML…', run: () => exportHtml(tab) },
      { label: 'Print / save as PDF…', run: () => printNote(tab) },
      '-',
      { label: isNote(tab.path) ? 'Delete note' : 'Delete file', danger: true, run: () => deleteItem(tab.path) },
    ]); } }, '⋯'),
    S.info?.agent?.configured && isNote(tab.path)
      ? h('button', { class: 'btn small', title: withKey('Ask the agent about this note', 'delegate'), onclick: () => openTaskDialog() }, '✦ Ask agent')
      : null);
  // Re-attaching resets the textarea's scroll (and fires a scroll event), so
  // remember the position first and ignore scroll events until restored.
  const want = tab.scroll || 0;
  tab.restoring = true;
  const banner = h('div', { class: 'banner-slot' });
  tab.previewEl = preview;
  tab.bannerEl = banner;
  c.replaceChildren(toolbar, banner, wrap);
  attachedByGroup[g] = tab;
  renderPreview(tab);
  // Finding in the preview: only while it is shown in this pane.
  for (const t of S.tabs) if (t.pfind?.open && t.group === g && t !== tab) t.pfind.close();
  if (tab.pfind) { if (mode === 'preview') tab.pfind.mount(wrap, preview); else tab.pfind.close(); }
  renderBanner(tab);
  requestAnimationFrame(() => {
    if (!isAttached(tab)) return;
    ed.scrollTop = want;
    tab.scroll = want;
    tab.restoring = false;
    syncScroll(tab);
  });
}

// One editor per tab so each keeps its own undo history and selection.
function editorFor(tab) {
  if (tab.editor) return tab.editor;
  const ed = new MarkdownEditor({
    onChange: (v) => { tab.content = v; onEdit(tab); drawNotesSoon(tab); },
    onScroll: () => { if (isAttached(tab) && !tab.restoring) { tab.scroll = ed.scrollTop; syncScroll(tab); } },
    onCursor: renderStatus,
    complete: completeFor,
    onPasteFiles: (files) => attachFiles(tab, files),
    onTrack: () => proofChanged(tab),
    onNarrow: () => { if (activeTab() === tab) renderStatus(); },
  });
  ed.value = tab.content;
  ed.setOptions({ highlight: S.settings.highlight, spellcheck: S.settings.spellcheck });
  ed.setCurrentLine(!!S.meeting);
  tab.editor = ed;
  if (isNote(tab.path)) loadComments(tab);
  ed.ta.addEventListener('mousemove', (e) => editorLinkHover(e, ed, tab));
  ed.ta.addEventListener('click', (e) => editorLinkClick(e, ed, tab));
  ed.ta.addEventListener('mouseleave', () => { if (linkPop.el || linkPop.timer) leaveLinkPreview(); });
  return ed;
}

// Headings of notes not open, for [[Note# completion: path → { at, heads },
// read again after a while (the note may have changed).
const headingsOf = new Map();

function completeFor(kind, query, ctx) {
  if (kind === 'heading') {
    const tab = fileTab();
    const path = ctx.note.trim() ? resolveLink(ctx.note, tab?.path) : tab?.path;
    if (!path) return [];
    const open = S.tabs.find((t) => t.kind === 'file' && t.path === path);
    const known = headingsOf.get(path);
    let heads = open ? outline(open.content) : known?.heads;
    if (!open && (!known || Date.now() - known.at > 10000)) {
      headingsOf.set(path, { at: Date.now(), heads: known?.heads || [] });
      api('GET', `/api/file?path=${encodeURIComponent(path)}`).then((f) => {
        headingsOf.set(path, { at: Date.now(), heads: outline(f.content) });
        tab?.editor?._maybeComplete(); // show them now they're here
      }).catch(() => {});
      if (!heads?.length) return [];
    }
    return heads.map((it) => ({ it, text: it.text.replace(/[*_`]/g, '') }))
      .map((x) => ({ ...x, m: fuzzy(query, x.text) }))
      .filter((x) => x.m && x.text.toLowerCase() !== query.trim().toLowerCase())
      .sort((a, b) => (query ? b.m.score - a.m.score : 0))
      .map(({ it, text }) => ({ label: text, detail: `H${it.level}`, insert: text }));
  }
  if (kind === 'link') {
    const notes = S.files.filter((f) => f.note);
    const counts = {};
    for (const f of notes) counts[stem(f.path).toLowerCase()] = (counts[stem(f.path).toLowerCase()] || 0) + 1;
    return notes.map((f) => ({ f, m: fuzzy(query, stem(f.path)) || fuzzy(query, f.path) }))
      .filter((x) => x.m)
      .sort((a, b) => b.m.score - a.m.score)
      .map(({ f }) => {
        const name = stem(f.path);
        const unique = counts[name.toLowerCase()] === 1;
        return { label: name, detail: dirname(f.path), insert: unique ? name : f.path.replace(/\.md$/i, '') };
      });
  }
  if (kind === 'tag') {
    const q = query.toLowerCase();
    return S.tags.filter((t) => t.tag.toLowerCase().startsWith(q) && t.tag.toLowerCase() !== q)
      .map((t) => ({ label: `#${t.tag}`, detail: String(t.count), insert: t.tag }));
  }
  if (kind === 'step') {
    // Steps already written in this note's ```flow blocks: the same text is
    // the same box, so reusing a name keeps the picture joined.
    const q = query.trim().toLowerCase();
    const names = stepNamesOf(fileTab());
    return names.map((name) => ({ name, low: name.toLowerCase() }))
      .filter(({ low }) => low !== q && (low.includes(q) || nameKey(low).includes(nameKey(q))))
      .sort((a, b) => (b.low.startsWith(q) - a.low.startsWith(q)) || a.name.length - b.name.length)
      .slice(0, 8)
      .map(({ name }, i) => ({ label: name, detail: i === 0 ? 'Tab' : '', insert: name }));
  }
  return [];
}

// The note's flow step names, parsed again only when its text changed.
function stepNamesOf(tab) {
  if (!tab?.editor) return [];
  const v = tab.editor.value;
  if (tab.stepNames?.v !== v) tab.stepNames = { v, names: flowStepNames(v) };
  return tab.stepNames.names;
}

// Pasted or dropped files are stored next to the note (./assets/) as plain
// files and linked with a relative path, so the Markdown stays portable.
async function attachFiles(tab, files) {
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is larger than 25 MB`, 'error'); continue; }
    try {
      const data = await blobBase64(file);
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const res = await api('POST', '/api/asset', { note: tab.path, name: file.name || `pasted.${ext}`, data });
      const target = encodeURI(res.path);
      tab.editor.insert(/^image\//.test(file.type) ? `![${stem(res.path)}](${target})` : `[${basename(res.path)}](${target})`);
    } catch (e) { toast(`Could not attach ${file.name}: ${e.message}`, 'error'); }
  }
}

function localImage(url, notePath) {
  if (/^[a-z][\w+.-]*:/i.test(url) || url.startsWith('//')) return null; // remote: never fetched
  let rel;
  try { rel = decodeURI(url.split('#')[0].split('?')[0]); } catch { rel = url; }
  const parts = (rel.startsWith('/') ? rel.slice(1) : [dirname(notePath), rel].filter(Boolean).join('/')).split('/');
  const out = [];
  for (const part of parts) { if (part === '..') out.pop(); else if (part && part !== '.') out.push(part); }
  return `/api/raw?path=${encodeURIComponent(out.join('/'))}&t=${token}`;
}

function welcome() {
  const shortcuts = [
    [kbd('quick-open'), 'Quick open'], [kbd('palette'), 'Commands'], [kbd('search'), 'Search everything'],
    [kbd('find'), 'Find / replace'], [kbd('delegate'), 'Delegate to agent'], [kbd('cycle-mode'), 'Edit / split / preview'],
    [kbd('settings'), 'Settings & themes'], [kbd('focus'), 'Focus mode'], [kbd('sidebar'), 'Toggle sidebar'],
    [kbd('split'), 'Split / switch pane'], [kbd('next-occurrence'), 'Add next occurrence'], [kbd('git'), 'Git changes'],
    [[kbd('nav-back'), kbd('nav-forward')].filter(Boolean).join(' '), 'Back / forward'],
    ...(desktop ? [[kbd('quick-capture'), 'Quick capture (anywhere)']] : [['Tab', 'Next table cell']]),
  ].filter(([k]) => k);
  const recent = S.recent.filter((p) => S.files.some((f) => f.path === p)).slice(0, 8);
  const action = (label, key, run) => h('button', { class: 'welcome-action', onclick: run }, h('span', {}, label), key ? h('kbd', {}, key) : null);
  return h('div', { class: 'welcome' },
    h('h1', {}, S.info?.name || 'Margin'),
    h('div', { class: 'welcome-sub' }, h('span', { class: 'lock' }, '● '), 'Plain Markdown files in ', h('code', {}, S.info?.root || ''), '. Agents propose, you decide.'),
    h('div', { class: 'welcome-grid' },
      h('div', {},
        h('div', { class: 'section-label' }, 'Start'),
        action('New note', null, () => newNote()),
        action('Today’s journal', null, openDaily),
        action('Quick capture…', desktop ? kbd('quick-capture') : null, quickCapture),
        action('Open a note…', kbd('quick-open'), () => openPalette()),
        desktop ? action('Open a file…', kbd('open-file'), () => desktop.openFile()) : null,
        desktop ? action('Open another folder…', kbd('open-folder'), () => desktop.openFolder()) : null,
        S.info?.agent?.configured ? action('Delegate a task…', kbd('delegate'), () => openTaskDialog()) : null,
        action('Themes & settings', kbd('settings'), openSettings)),
      h('div', {},
        h('div', { class: 'section-label' }, 'Recent'),
        recent.length ? recent.map((p) => h('button', { class: 'welcome-recent', title: p, onclick: () => openFile(p) },
          h('span', {}, stem(p)), h('span', { class: 'dir' }, dirname(p))))
          : h('div', { class: 'empty' }, 'Notes you open show up here.'))),
    h('div', { class: 'section-label' }, 'Keyboard'),
    h('div', { class: 'welcome-keys' }, shortcuts.map(([k, d]) => h('div', {}, h('kbd', {}, k), h('span', {}, d)))));
}

function renderPreview(tab) {
  const p = tab.previewEl;
  if (!p || !p.isConnected || !hasPreview(tab.path) || groupMode(tab) === 'edit') return;
  if (groupMode(tab) === 'canvas' && isNote(tab.path)) { renderCanvas(tab); return; }
  if (isMermaidFile(tab.path)) {
    // The whole file is one diagram.
    const pre = h('pre', { 'data-lang': 'mermaid', class: 'mmd-file' });
    pre.textContent = tab.content.trim() ? tab.content : 'flowchart LR\n  empty["Empty diagram"]';
    p.replaceChildren(pre);
    renderDiagrams(p);
    return;
  }
  // Suggesting: the note as it is, with your suggestions and comments on it.
  const proof = tab.editor?.tracking && pen ? tab.editor.trackTexts() : null;
  p.classList.toggle('mine', !!proof);
  if (proof) {
    const notes = openComments(tab).map((c, n) => ({ n, comment: c.comment, quote: [c.quote, ...(c.alts || [])].find((q) => q && proof.original.includes(q)) || c.quote }));
    const text = pen.penSource(proof.original, hunksOf(proof.original, proof.proposed), notes).text;
    p.innerHTML = renderMarkdown(text, { image: (url) => localImage(url, tab.path), embed: (target, label) => fileEmbed(target, label, tab.path) });
    pen.decorate(p);
  } else p.innerHTML = renderMarkdown(tab.content, { image: (url) => localImage(url, tab.path), embed: (target, label) => fileEmbed(target, label, tab.path) });
  pairInk(p); // a picture and its ```ink marks: one figure, before the layout moves them
  if (p.querySelector('.note-embed.loading')) {
    fillNoteEmbeds(p).then(() => { // the ones read from disk: draw what's in them
      if (!p.isConnected) return;
      renderDiagrams(p);
      if (p.querySelector('.drawing-embed:not(.ready)')) fillDrawingEmbeds(p);
      if (p.querySelector('.mmd-embed.loading')) fillMermaidEmbeds(p).then(() => renderDiagrams(p));
    });
  }
  p.querySelectorAll('a.internal').forEach((a) => {
    const target = a.dataset.target || a.dataset.href;
    if (!/^#/.test(target) && !resolveLink(target, tab.path)) { a.classList.add('missing'); a.title = 'Not found — click to create'; }
  });
  applyFolds(tab, p);
  const figures = hasFiguresLayout(tab.content);
  p.classList.toggle('figures', figures);
  if (figures) layoutFigures(p);
  renderDiagrams(p);
  if (p.querySelector('.drawing-embed:not(.ready)')) fillDrawingEmbeds(p);
  if (p.querySelector('.mmd-embed.loading')) fillMermaidEmbeds(p).then(() => renderDiagrams(p));
  if (tab.pfind?.open) tab.pfind.run(false);
}

// ⌘F: in Preview, find in the rendered note (it stays in Preview); in Edit
// and Split, the editor's find. Replacing edits the text, so it is the
// editor's — from Preview that switches to Split.
function previewFindFor(tab) {
  return tab.pfind || (tab.pfind = new PreviewFind({
    onReplace: (q) => findInNote(tab, { replace: true, query: q }),
    keys: (e) => { const k = eventKeys(e, isMac); return !k ? null : k === KEYS['find-next'] ? 'next' : k === KEYS['find-prev'] ? 'prev' : null; },
  }));
}
function findInNote(tab = fileTab(), { replace = false, query = null } = {}) {
  if (!tab?.editor) return;
  S.focus = tab.group;
  const inPreview = groupMode(tab) === 'preview' && hasPreview(tab.path) && !isMermaidFile(tab.path);
  if (inPreview && !replace) {
    const f = previewFindFor(tab);
    const sel = window.getSelection();
    const picked = sel && !sel.isCollapsed && tab.previewEl?.contains(sel.anchorNode) ? sel.toString().trim() : '';
    f.mount(tab.previewEl.parentElement, tab.previewEl);
    f.show(picked && !picked.includes('\n') ? picked : '');
    return;
  }
  const q = query ?? (tab.pfind?.open ? tab.pfind.query : null);
  tab.pfind?.close();
  if (groupMode(tab) === 'preview') setMode('split');
  tab.editor.openFind({ replace, query: q });
}

// "layout: figures" in a note's front matter: each section (from one heading
// to the next) becomes a row, its text on the left and its pictures —
// ```flow and ```mermaid blocks, ![[diagram]] and ![[drawing]] embeds —
// beside it on the right.
function hasFiguresLayout(content) {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) return false;
  const end = text.indexOf('\n---', 3);
  return end > 0 && /^layout:\s*figures\s*$/m.test(text.slice(4, end));
}

const FIGURE_BLOCK = 'pre[data-lang="mermaid" i], pre[data-lang="flow" i], .mmd-embed, .drawing-embed, figure.ink-figure';
function isFigure(el) {
  if (el.matches(FIGURE_BLOCK)) return true;
  // An embed on a line of its own is a paragraph holding just that.
  const only = el.tagName === 'P' && el.children.length === 1 ? el.firstElementChild : null;
  return !!only?.matches('.mmd-embed, .drawing-embed') && el.textContent.trim() === only.textContent.trim();
}

function layoutFigures(p) {
  let row = null;
  const rows = [];
  for (const el of [...p.children]) {
    if (el.matches('pre.frontmatter')) continue;
    if (!row || /^H[1-6]$/.test(el.tagName)) {
      row = { el: h('div', { class: 'fig-row' }), text: h('div', { class: 'fig-text' }), side: h('div', { class: 'fig-side' }) };
      row.el.append(row.text, row.side);
      rows.push(row);
      el.before(row.el);
    }
    (isFigure(el) ? row.side : row.text).append(el);
  }
  for (const r of rows) r.el.classList.toggle('no-figure', !r.side.childElementCount);
  markFigureRow();
}

// The row of the section holding the cursor is highlighted.
function markFigureRow() {
  const tab = fileTab();
  const p = tab?.previewEl;
  if (!p?.classList.contains('figures') || !tab.editor) return;
  const cur = tab.editor.cursorLine() - 1;
  let active = null;
  for (const row of p.querySelectorAll(':scope > .fig-row')) {
    const first = row.querySelector('.fig-text [data-line]');
    if (!first || Number(first.dataset.line) <= cur) active = row;
  }
  p.querySelectorAll(':scope > .fig-row').forEach((r) => r.classList.toggle('current', r === active));
}

// ---- canvas view: the editor, and the note's pictures on a canvas beside it
// (public/canvas.js). One card per section with pictures; the camera goes to
// what the cursor is on.

function canvasFor(tab) {
  return (tab.canvas ||= new FigureCanvas({
    // A click selects: the cursor goes to the box's text, the keys stay
    // on the canvas (Esc goes to the text).
    onNode: (pre, id) => gotoBox(tab, pre, id, false),
    onFigure: (fig) => gotoOffset(tab, lineOffset(tab.editor.value, Number(fig.dataset.line) || 0), undefined, false),
    onSection: (sec) => gotoOffset(tab, lineOffset(tab.editor.value, sec.line), undefined, false),
    canRename: (pre) => flowEditable(pre),
    onRename: (pre, node, text) => renameBox(tab, pre, node, text),
    // Drawing (public/flowedit.js writes the text).
    canEdit: (pre) => flowEditable(pre),
    onAddAfter: (pre, id) => addBoxAfter(tab, pre, id),
    onAddBox: (pre) => editFlow(tab, pre, (src) => { const name = freshName(src); return { text: addBox(src, name), select: name, rename: true }; }),
    onConnect: (pre, from, to) => connectBoxes(tab, pre, from, to),
    onDelete: (pre, id) => deleteBox(tab, pre, id),
    onColorMenu: (pre, id, at) => colorMenu(tab, pre, id, at),
    onBoxMenu: (e, pre, id) => boxMenu(tab, e, pre, id),
    onCardMenu: (e, pre) => cardMenu(tab, e, pre),
    onArrow: (pre, a, what, arg) => editArrow(tab, pre, a, what, arg),
    onNewFlow: () => newFlowHere(tab),
    onNewSketch: () => newSketchHere(tab),
    onPastePictures: (files) => pastePictures(tab, files),
    onUndo: (redo) => drawUndo(tab, redo),
    onArrowStep: (pre, from, to) => gotoArrow(tab, pre, from, to),
    onShapeMenu: (pre, id, at) => shapeMenu(tab, pre, id, at),
    onInk: (fig, change) => inkEdit(tab, fig, change),
    onInkMenu: (e, fig, mark) => inkArrowMenu(tab, e, fig, mark),
    onInkHint: (msg) => toast(msg),
    // Comments on the pictures (kept with the note's others).
    onBoxComment: (pre, id, rect) => drawingComment(tab, pre, { on: 'flow', box: nodeText(pre, id) }, rect),
    onInkComment: (fig, [x, y], rect) => drawingComment(tab, fig, { on: fig.dataset.board != null ? 'sketch' : 'picture', x, y }, rect),
    onCommentPin: (id) => { const c = tab.comments?.find((x) => x.id === id); if (c) gotoNote(tab, c, false); },
    // A numbered dot: its list item marked in the text; a click goes there.
    onInkHover: (fig, num) => { const r = fig && calloutRange(tab, fig, num); tab.editor.setHints(r ? [r] : []); },
    onInkDot: (fig, num) => { const r = calloutRange(tab, fig, num); if (r) gotoOffset(tab, r[0], r[0], false); else toast(`No item ${num}. in a numbered list of this section to say what it is.`); },
    onInkColor: (at, color, pick) => contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: at.x, clientY: at.y },
      INK_COLORS.map((c, i) => ({ label: `${colorLabel(c)}${c === color ? ' ✓' : ''}`, swatch: INK[c], key: String(i + 1), hotkey: String(i + 1), run: () => pick(c) }))),
    // The box under the pointer: its mentions in the text, marked.
    onHover: (pre, id) => {
      const node = pre?.flowNodes?.find((n) => n.id === id);
      tab.editor.setHints(node ? mentionRanges(tab.editor.value, node.text) : []);
    },
    onEscape: () => tab.editor.focus(),
    here: () => flowBoxHere(tab),
    onStep: (pre, id) => gotoBox(tab, pre, id, false),
    tour: (prefer) => presentSteps(tab, prefer),
    wheelPans: () => S.settings.labWheelPans,
    onExport: (btn) => { const r = btn.getBoundingClientRect(); contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.left, clientY: r.bottom + 4 }, pictureItems(() => Promise.resolve().then(() => canvasPicture(tab)))); },
  }));
}

// The whole canvas as one picture: the sections' frames and titles, and the
// pictures where they are, in theme colours. An SVG holding the pictures'
// images, so copying it as PNG works like any diagram.
function canvasPicture(tab) {
  const { w, h, sections } = tab.canvas.layout();
  if (!sections.length) throw new Error('no pictures on the canvas');
  const css = getComputedStyle(document.documentElement);
  const v = (name, or) => css.getPropertyValue(name).trim() || or;
  const bg = themeBackground();
  const fg = v('--fg-dim', '#888');
  const line = v('--border', '#ccc');
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const pad = 24;
  const parts = [];
  for (const s of sections) {
    parts.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="14" fill="none" stroke="${line}" stroke-dasharray="4 4"/>`,
      `<text x="${s.x + 16}" y="${s.y + 26}" fill="${fg}" font-family="-apple-system, system-ui, sans-serif" font-size="15" font-weight="600">${esc(s.title)}</text>`);
    for (const c of s.cards) {
      parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="10" fill="${bg}" stroke="${line}"/>`);
      for (const i of c.images) parts.push(`<image href="${esc(i.src)}" x="${i.x}" y="${i.y}" width="${i.w}" height="${i.h}"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w + pad * 2)}" height="${Math.ceil(h + pad * 2)}" viewBox="${-pad} ${-pad} ${Math.ceil(w + pad * 2)} ${Math.ceil(h + pad * 2)}"><rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="${bg}"/>${parts.join('')}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return { from: tab.path, name: `${stem(tab.path)}-canvas`, what: () => 'the canvas', url, svg: async () => svg, png: () => imageToPng(url, { scale: 2, background: bg }) };
}

// The steps of a presentation: section by section (the canvas's frames),
// each first whole (a `frame` step: its title and first lines of text), then
// each ```flow picture along its arrows (flowTour), a picture's ```ink marks
// a few at a time (marks up to and with a text mark, whose words are the
// caption), other pictures whole (unless the frame has only them). A box
// step's caption: the box, its note, the arrow it was reached by, and what
// the section's text says it is (`- Name: …` items, definitionLines). At a
// step with several ways out, `choices` lists them (a number picks one:
// `prefer`, pre → { stepId: [ids first] }); going back to such a step and
// arrows to a step shown already are steps of their own.
function presentSteps(tab, prefer = new Map()) {
  const v = tab.editor.value;
  const secs = tab.canvasSections || [];
  const steps = [];
  secs.forEach((sec, k) => {
    if (!sec.figures.length) return;
    // Its text, and that of an intro above it without pictures of its own.
    let start = k;
    while (start > 0 && !secs[start - 1].figures.length) start--;
    const begin = secs[start].line;
    const end = secs[k + 1]?.line ?? Infinity;
    steps.push({ frame: sec, pre: null, id: null, title: sec.title, text: '', note: '', via: '', lines: leadLines(v, begin, end) });
    const alone = sec.figures.length === 1;
    const items = numberedItems(v, sec.line, end);
    for (const pre of sec.figures) {
      // What is hidden stays hidden throughout: not a step.
      const marks = pre.matches('.ink-figure') ? (pre.inkMarks || []).filter((m) => m.kind !== 'hide') : [];
      if (!pre.flowNodes) {
        if (!alone) steps.push({ pre, id: null, title: sec.title, text: '', note: '', via: '', lines: [] });
        let group = [];
        marks.forEach((m, j) => {
          group.push(m.line);
          if (m.kind !== 'text' && m.kind !== 'num' && j < marks.length - 1) return;
          // A numbered dot says what its list item says.
          const item = m.kind === 'num' && items.find((x) => x.n === m.text);
          const said = m.kind === 'num' ? (item ? `${m.text}. ${item.text}` : m.text) : m.text;
          steps.push({ pre, id: null, marks: group, title: sec.title, text: m.kind === 'text' || m.kind === 'num' ? said : '', note: '', via: '', lines: [] });
          group = [];
        });
        continue;
      }
      const edges = pre.flowEdges || [];
      const byId = new Map(pre.flowNodes.map((n) => [n.id, n]));
      const choicesOf = (id) => {
        const out = edges.filter((e) => e.from === id);
        return out.length > 1 ? out.map((e) => ({ to: e.to, label: e.label, text: byId.get(e.to)?.text || '' })) : null;
      };
      for (const t of flowTour({ nodes: pre.flowNodes, edges }, prefer.get(pre) || {})) {
        const n = byId.get(t.id);
        const from = t.from && byId.get(t.from);
        const arrow = from ? `${from.text}${t.label ? ` — ${t.label}` : ''} →` : '';
        const base = { pre, id: t.id, from: t.from || null, title: sec.title, text: n.text, note: n.note || '', lines: [] };
        if (t.back) steps.push({ ...base, back: true, via: '↩ Back to this branch', after: `Next: ${t.label || 'the other way'}`, choices: choicesOf(t.id) });
        else if (t.join) steps.push({ ...base, join: t.join, via: arrow, after: t.join === 'loop' ? '↺ Back to a step on the way here' : '⤷ Joins here (shown before)' });
        else steps.push({ ...base, via: arrow, lines: definitionLines(v, n.text, begin, end), choices: choicesOf(t.id) });
      }
    }
  });
  return steps;
}

function canvasExport(run) {
  const tab = fileTab();
  if (!tab?.canvas?.el.isConnected) { toast(withKey('This works in the Canvas view', 'cycle-mode')); return; }
  try { run(canvasPicture(tab)); } catch (e) { toast(e.message, 'error'); }
}

function moveFlowAtCursor(tab = fileTab()) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note first.', 'error'); return; }
  if (!tab.canvas?.el.isConnected) { toast(withKey('This works in the Canvas view', 'cycle-mode')); return; }
  const goal = canvasGoal(tab);
  const v = tab.editor.value;
  const cur = v.slice(0, tab.editor.selectionStart).split('\n').length - 1;
  const pre = goal?.fig;
  const lines = pre?.dataset.source?.replace(/\n$/, '').split('\n').length ?? 0;
  if (!flowEditable(pre) || cur < Number(pre.dataset.line) || cur > Number(pre.dataset.line) + lines + 1) { toast('Put the cursor in a ```flow block first.'); return; }
  moveFlowOut(tab, pre);
}

function presentFlows() {
  const tab = fileTab();
  if (!tab?.canvas?.el.isConnected) { toast(withKey('Presenting works in the Canvas view', 'cycle-mode')); return; }
  tab.canvas.present();
}

// Follow the flow on the canvas from the box at the cursor (the canvas
// takes the keys: arrows, a number at a branch, Esc back to the text).
function walkFlow(back) {
  const tab = fileTab();
  if (!tab?.canvas?.el.isConnected) { toast(withKey('Following the flow works in the Canvas view', 'cycle-mode')); return; }
  tab.canvas.stage.focus({ preventScroll: true });
  tab.canvas.step(back);
}

// The ```flow box at the cursor (see boxAt).
const flowBoxHere = (tab) => boxAt(canvasGoal(tab), tab.editor.value, tab.editor.selectionStart, figInfo);

function renderCanvas(tab) {
  const cv = tab.canvas;
  if (!cv?.el.isConnected) return;
  const doc = h('div', {});
  doc.innerHTML = renderMarkdown(tab.content, { image: (url) => localImage(url, tab.path), embed: (target, label) => fileEmbed(target, label, tab.path) });
  // Every picture on a line of its own is a card, to draw on.
  pairInk(doc, { all: true });
  let sec = { title: stem(tab.path), line: 0, figures: [] };
  const sections = [sec];
  const waiting = new Set();
  for (const el of [...doc.children]) {
    if (el.matches('pre.frontmatter')) continue;
    if (/^H[1-6]$/.test(el.tagName)) {
      sec = { title: el.textContent.trim(), line: Number(el.dataset.line) || 0, figures: [] };
      sections.push(sec);
    } else if (isFigure(el)) {
      // An embed on its own line comes wrapped in a paragraph.
      const fig = el.tagName === 'P' ? el.firstElementChild : el;
      fig.dataset.line ??= el.dataset.line;
      sec.figures.push(fig);
    } else if (el.tagName === 'P' && el.children.length === 1 && el.firstElementChild.matches('.note-embed') && el.textContent.trim() === el.firstElementChild.textContent.trim()) {
      // ![[Note]] on its own line: the pictures in that note (a flow moved
      // out to a note of its own), shown here as they are there.
      const embed = el.firstElementChild;
      const path = embed.dataset.path;
      const src = S.tabs.find((t) => t.kind === 'file' && t.path === path && t.content != null)?.content ?? noteSources.get(path);
      if (src == null) { waiting.add(path); continue; }
      const part = linkSection(src, splitLink(embed.dataset.target).heading);
      if (!part) continue;
      const inner = h('div', {});
      noteEmbedDepth++;
      try { inner.innerHTML = renderMarkdown(part.text, { image: (url) => localImage(url, path), embed: () => null }); } finally { noteEmbedDepth--; }
      for (const fig of inner.querySelectorAll('pre[data-lang="flow" i], pre[data-lang="mermaid" i]')) {
        fig.dataset.line = el.dataset.line;
        fig.dataset.from = path;
        fig.title = `From ${path}`;
        sec.figures.push(fig);
      }
    }
  }
  if (waiting.size) {
    Promise.all([...waiting].map((path) => api('GET', `/api/file?path=${encodeURIComponent(path)}`)
      .then((f) => noteSources.set(path, f.content.replace(/\r\n/g, '\n')), () => noteSources.set(path, ''))))
      .then(() => { if (tab.canvas?.el.isConnected) renderCanvas(tab); });
  }
  const seen = new Map();
  for (const s of sections) { const n = (seen.get(s.title) || 0) + 1; seen.set(s.title, n); s.key = `${s.title}#${n}`; }
  tab.canvasSections = sections;
  cv.setCards(sections.filter((s) => s.figures.length));
  renderDiagrams(cv.world);
  if (cv.world.querySelector('.drawing-embed:not(.ready)')) fillDrawingEmbeds(cv.world);
  if (cv.world.querySelector('.mmd-embed.loading')) fillMermaidEmbeds(cv.world).then(() => renderDiagrams(cv.world));
  if (tab.comments) canvasComments(tab);
  followCursor(tab);
}

// The pictures' part of a figure, as public/figure-goal.js reads it.
const figInfo = (fig) => ({
  line: Number(fig.dataset.line) || 0,
  source: (fig.matches('pre[data-lang]') && !fig.dataset.from) || fig.dataset.board != null ? (fig.dataset.source ?? fig.textContent) : null,
  flowNodes: fig.flowNodes,
  diagramNodes: fig.diagramNodes,
  inkMarks: fig.inkMarks,
});

// The numbered list item a picture's dot `num` stands for, in the note at
// the canvas: [start, end] offsets of its text, or null.
function calloutRange(tab, fig, num) {
  const secs = tab.canvasSections || [];
  const k = secs.findIndex((x) => x.figures.includes(fig));
  if (k < 0 || num == null) return null;
  const v = tab.editor.value;
  const item = numberedItems(v, secs[k].line, secs[k + 1]?.line ?? Infinity).find((x) => x.n === num);
  if (!item) return null;
  const start = lineOffset(v, item.line);
  const end = v.indexOf('\n', start);
  const line = v.slice(start, end < 0 ? v.length : end);
  return [start + line.search(/\d/), end < 0 ? v.length : end];
}

// What the cursor is on, for the canvas (see goalAt).
const canvasGoal = (tab) => goalAt(tab.canvasSections, tab.editor.value, tab.editor.selectionStart, figInfo);

function followCursor(tab = fileTab()) {
  if (tab?.canvas?.el.isConnected && tab.editor) tab.canvas.target(canvasGoal(tab));
}

const lineOffset = (v, line) => { let o = 0; for (let i = 0; i < line && o >= 0; i++) o = v.indexOf('\n', o) + 1 || -1; return o < 0 ? v.length : o; };

function gotoOffset(tab, start, end = start, focus = true) {
  tab.editor.selectRange(start, end, focus);
  renderStatus();
}

// A box on the canvas → its text in the note, selected.
function gotoBox(tab, pre, id, focus = true) {
  const v = tab.editor.value;
  // A flow shown from another note (![[…]]): its line here.
  if (pre.dataset.from) { gotoOffset(tab, lineOffset(v, Number(pre.dataset.line) || 0), undefined, focus); return; }
  const base = Number(pre.dataset.line) + 1;
  const spot = pre.flowNodes?.find((n) => n.id === id)?.spots[0];
  if (spot) { const o = lineOffset(v, base + spot.line); gotoOffset(tab, o + spot.start, o + spot.end, focus); return; }
  const lines = (pre.dataset.source ?? '').split('\n');
  const i = lines.findIndex((l) => new Set(l.match(/[\p{L}\p{N}_]+/gu) || []).has(id));
  gotoOffset(tab, lineOffset(v, base + Math.max(0, i)));
}

// Rename a box of a ```flow block: every place its text is written, in one edit.
function renameBox(tab, pre, node, text) {
  if (!isStepText(text)) { toast('A box’s text can’t hold arrows, " : " or end with ":"', 'error'); return; }
  if (suggestingNow(tab)) return;
  const v = tab.editor.value;
  const base = Number(pre.dataset.line) + 1;
  const src = pre.dataset.source.replace(/\n$/, '').split('\n');
  const start = lineOffset(v, base);
  const end = start + src.join('\n').length;
  if (v.slice(start, end) !== src.join('\n')) { toast('The note changed — try again.', 'error'); return; }
  const out = [...src];
  for (const s of [...node.spots].sort((a, b) => b.line - a.line || b.start - a.start)) {
    out[s.line] = out[s.line].slice(0, s.start) + text + out[s.line].slice(s.end);
  }
  const first = node.spots.reduce((a, b) => (a.line < b.line || (a.line === b.line && a.start < b.start) ? a : b));
  const caret = lineOffset(v, base + first.line) + first.start + text.length;
  const before = tab.canvas?.selectionNames();
  const pinned = pinnedOn(tab, pre).filter((c) => c.pin.box === node.text);
  tab.editor.closeStep();
  tab.editor.replace(start, end, out.join('\n'), caret);
  tab.editor.closeStep();
  drawn(tab, pre.dataset.line, before);
  // Its comments go with it.
  if (pinned.length) {
    for (const c of pinned) { c.pin = { ...c.pin, box: text }; c.quote = text; c.alts = []; }
    keepComments(tab);
  }
  // The box stays selected on the canvas, under its new name.
  if (tab.canvas?.el.isConnected) { tab.canvas.selectSoon(pre.dataset.line, text); tab.canvas.stage.focus({ preventScroll: true }); }
  renderStatus();
  // Other pictures may hold the same box, and the text may name it: offer to
  // keep them in step.
  const now = tab.editor.value;
  const boxes = flowBoxRanges(now, node.text).length;
  const said = mentionRanges(now, node.text).length;
  if (!boxes && !said) return;
  const parts = [boxes && `${boxes} other ${boxes === 1 ? 'box' : 'boxes'}`, said && `${said} ${said === 1 ? 'place' : 'places'} in the text`].filter(Boolean);
  toast(`“${node.text}” also appears in ${parts.join(' and ')}.`, '', { label: 'Rename everywhere', run: () => renameEverywhere(tab, node.text, text) });
}

// ---- drawing on a ```flow picture: each change written in its block
// (public/flowedit.js), as one undo step; the canvas then selects the box
// the change was about.

// A ```flow picture of this note (not one shown from another).
const flowEditable = (pre) => !!pre?.flowNodes && pre.dataset.line != null && !pre.dataset.from;

function cantEdit(pre) {
  const from = pre?.dataset.from;
  if (from) toast(`This flow is in “${stem(from)}”: draw on it there.`, '', { label: `Open ${stem(from)}`, run: () => openFile(from) });
  else toast('Drawing works on ```flow pictures; a ```mermaid one changes in its text.');
}

// change(src) → { text, select?, rename? } or null (nothing to do).
function editFlow(tab, pre, change) {
  if (!flowEditable(pre)) { cantEdit(pre); return false; }
  if (suggestingNow(tab)) return false;
  const v = tab.editor.value;
  const src = pre.dataset.source.replace(/\n$/, '');
  const start = lineOffset(v, Number(pre.dataset.line) + 1);
  const end = start + src.length;
  if (v.slice(start, end) !== src) { toast('The note changed — try again.', 'error'); return false; }
  let r;
  try { r = change(src); } catch (e) { toast(e.message, 'error'); return false; }
  if (!r || r.text === src) return false;
  // The cursor on the box selected; else where it was.
  let caret = tab.editor.selectionStart;
  if (caret > end) caret += r.text.length - src.length;
  else if (caret > start + r.text.length) caret = start + r.text.length;
  const spot = r.select && parseFlow(r.text).nodes.find((n) => n.text === r.select)?.spots.at(-1);
  if (spot) caret = start + lineOffset(r.text, spot.line) + spot.start;
  const before = tab.canvas?.selectionNames();
  tab.editor.closeStep();
  tab.editor.replace(start, end, r.text, caret);
  tab.editor.closeStep();
  drawn(tab, pre.dataset.line, before);
  if (r.select) tab.canvas?.selectSoon(pre.dataset.line, r.select, !!r.rename);
  if (r.edge) tab.canvas?.selectEdgeSoon(pre.dataset.line, ...r.edge);
  if (tab.canvas?.el.isConnected) tab.canvas.stage.focus({ preventScroll: true });
  renderStatus();
  bigFlowHint(tab, pre.dataset.line, r.text);
  return true;
}

const nodeText = (pre, id) => pre.flowNodes?.find((n) => n.id === id)?.text;

// A drawing change was written: the canvas waits for its picture, and ⌘Z
// gives back what was selected before it (by the text the change left).
function drawn(tab, line, before) {
  tab.canvas?.changed(line);
  tab.drawUndo = [...(tab.drawUndo || []).slice(-19), { after: tab.editor.value, before }];
}

function drawUndo(tab, redo = false) {
  const was = !redo && (tab.drawUndo || []).findLast((r) => r.after === tab.editor.value);
  if (redo) tab.editor.redo(); else tab.editor.undo();
  // The notification offering to undo it has done its part.
  if ($('#toast .toast-action')?.textContent === 'Undo') $('#toast').hidden = true;
  const c = tab.canvas;
  if (!c) return;
  const sel = was?.before;
  if (sel) {
    c.changed(sel.line);
    if (sel.edge) c.selectEdgeSoon(sel.line, ...sel.edge); else c.selectSoon(sel.line, sel.name);
  }
  if (c.el.isConnected) c.stage.focus({ preventScroll: true });
}

// An arrow clicked: the cursor on where it is written (the keys stay on the canvas).
function gotoArrow(tab, pre, a, b) {
  if (!flowEditable(pre)) return;
  const spot = arrowSpot(pre.dataset.source.replace(/\n$/, ''), nodeText(pre, a), nodeText(pre, b));
  if (!spot) return;
  const o = lineOffset(tab.editor.value, Number(pre.dataset.line) + 1 + spot.line);
  gotoOffset(tab, o + spot.start, o + spot.end, false);
}

// A mark drawn on a picture: a line added to (or taken out of) the ```ink
// block after it, the block made with the first mark and gone with the last.
// A sketch's block is its own picture: it stays, and grows to hold what is
// drawn past its edge. One ⌘Z each.
function inkEdit(tab, fig, change) {
  if (suggestingNow(tab)) return;
  const v = tab.editor.value;
  const eol = (n) => { const i = v.indexOf('\n', lineOffset(v, n)); return i < 0 ? v.length : i; };
  const pic = Number(fig.dataset.line);
  const board = fig.dataset.board != null;
  if (!(board ? /^\s*(`{3,}|~{3,})\s*ink\s*$/i : /!\[/).test(v.slice(lineOffset(v, pic), eol(pic)))) { toast('The note changed — try again.', 'error'); return; }
  let from;
  let to;
  let text;
  if (fig.dataset.inkLine === '') {
    if (!change.add) return;
    from = eol(pic);
    to = from;
    const next = v.slice(from + 1, eol(pic + 1));
    text = `\n\n\`\`\`ink\n${change.add}\n\`\`\`${from < v.length && next.trim() ? '\n' : ''}`;
  } else {
    const at = Number(fig.dataset.inkLine);
    const src = fig.dataset.source;
    const start = lineOffset(v, at + 1);
    const close = at + 1 + (src ? src.split('\n').length : 0);
    if (v.slice(start, start + src.length) !== src || !/^\s*(`{3,}|~{3,})\s*$/.test(v.slice(lineOffset(v, close), eol(close)))) { toast('The note changed — try again.', 'error'); return; }
    // sets: several marks changed at once (a box and the arrows on it);
    // removes: several taken out.
    let next = change.add ? addMark(src, change.add) : change.sets ? change.sets.reduce((t, [n, m]) => setMark(t, n, m), src)
      : change.set ? setMark(src, ...change.set)
        : change.removes ? [...change.removes].sort((x, y) => y - x).reduce(removeMark, src) : removeMark(src, change.remove);
    if (board) {
      next = fitBoard(next);
      // A sketch grown: its comments are on its new board line.
      const was = boardText(src);
      const now = boardText(next);
      if (was && now && was !== now) {
        const pinned = pinnedOn(tab, fig).filter((c) => c.quote === was);
        for (const c of pinned) c.quote = now;
        if (pinned.length) keepComments(tab);
      }
    }
    if (next.trim()) { from = start; to = start + src.length; text = next; } else {
      // The last mark gone: the block too, the picture as it was.
      from = eol(pic);
      to = eol(close);
      text = '';
    }
  }
  tab.editor.closeStep();
  // The cursor on the picture's line: the canvas stays on it, and keeps the
  // keys (the next tool, say).
  const keys = tab.canvas?.el.contains(document.activeElement);
  tab.editor.replace(from, to, text, lineOffset(v, pic));
  tab.editor.closeStep();
  if (keys) tab.canvas.stage.focus({ preventScroll: true });
  renderStatus();
}

// Drawing writes the picture's lines straight into the note: not while
// suggesting, where every edit is a suggestion on the text. → refused.
function suggestingNow(tab) {
  if (!tab.editor?.tracking) return false;
  toast(withKey('Drawing goes straight into the note: stop suggesting first', 'suggest'), 'error');
  return true;
}

const SHAPE_ITEMS = [['box', 'Box'], ['round', 'Rounded'], ['circle', 'Circle'], ['db', 'Database'], ['decision', 'Question (diamond)']];
function shapeMenu(tab, pre, id, at) {
  const node = pre.flowNodes?.find((n) => n.id === id);
  if (!node) return;
  if (!flowEditable(pre)) { cantEdit(pre); return; }
  const r = tab.canvas?.stage.getBoundingClientRect();
  const pos = at || { x: r ? r.left + r.width / 2 : 200, y: r ? r.top + 60 : 200 };
  const now = node.shape || 'box';
  const items = SHAPE_ITEMS.filter(([k]) => k !== 'decision' || node.text.endsWith('?'));
  contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: pos.x, clientY: pos.y }, items.map(([k, label], i) => ({
    label: `${label}${k === now ? ' ✓' : ''}`, key: String(i + 1), hotkey: String(i + 1),
    run: () => editFlow(tab, pre, (src) => ({ text: setShape(src, node.text, k), select: node.text })),
  })));
}

function addBoxAfter(tab, pre, id) {
  const from = nodeText(pre, id);
  if (from == null) return;
  editFlow(tab, pre, (src) => { const name = freshName(src); return { text: connect(src, from, name, nextAnswer(src, from)), select: name, rename: true }; });
}

function connectBoxes(tab, pre, a, b) {
  const from = nodeText(pre, a);
  const to = nodeText(pre, b);
  if (from == null || to == null) return;
  const done = editFlow(tab, pre, (src) => ({ text: connect(src, from, to, nextAnswer(src, from)), select: to }));
  if (done || !flowEditable(pre)) return;
  // There already: that arrow, selected, to change.
  const e = pre.flowEdges?.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  if (e) tab.canvas?.selectEdge(pre, e.from, e.to);
  toast(`“${from}” goes to “${to}” already — the arrow is selected: Delete takes it out, B makes it two-way.`);
}

// An arrow selected on the canvas: { from, to } (box ids).
const BOTH_WAYS = new Set(['<-->', '---']);
function editArrow(tab, pre, a, what, arg) {
  if (what === 'menu') { arrowMenu(tab, arg, pre, a); return; }
  const from = nodeText(pre, a.from);
  const to = nodeText(pre, a.to);
  if (from == null || to == null) return;
  const edge = pre.flowEdges?.find((x) => x.from === a.from && x.to === a.to);
  const kind = edge?.kind || '-->';
  const toggle = (k) => (src) => ({ text: setArrowKind(src, from, to, kind === k ? '-->' : k), edge: [from, to] });
  // Words go with a one-way arrow only (an answer out of a question stays).
  const words = edge?.label && pre.flowNodes?.find((n) => n.id === a.from)?.shape !== 'decision' ? edge.label : '';
  if (what === 'reverse' && BOTH_WAYS.has(kind)) { toast('This arrow goes both ways (or none): nothing to turn round.'); return; }
  const change = {
    delete: (src) => ({ text: removeArrow(src, from, to) }),
    both: toggle('<-->'),
    dotted: toggle('-.->'),
    line: toggle('---'),
    reverse: (src) => ({ text: reverseArrow(src, from, to), edge: [to, from] }),
    label: (src) => ({ text: setArrowLabel(src, from, to, arg), edge: [from, to] }),
  }[what];
  if (!change) return;
  if (!editFlow(tab, pre, change)) return;
  const undo = { label: 'Undo', run: () => drawUndo(tab) };
  if (what === 'delete') toast(`Took out the arrow “${from}” → “${to}”.`, '', undo);
  else if (words && ['both', 'dotted', 'line'].includes(what) && kind === '-->') toast(`“${words}” is left off: only a one-way arrow has words, for now.`, '', undo);
}

function arrowMenu(tab, e, pre, a) {
  if (!flowEditable(pre)) { cantEdit(pre); return; }
  const edge = pre.flowEdges?.find((x) => x.from === a.from && x.to === a.to);
  const kind = edge?.kind || '-->';
  const run = (what) => () => editArrow(tab, pre, a, what);
  contextMenu(e, [
    { label: kind === '<-->' ? 'One way' : 'Both ways', key: 'B', hotkey: 'b', run: run('both') },
    BOTH_WAYS.has(kind) ? null : { label: 'Turn it round', key: 'R', hotkey: 'r', run: run('reverse') },
    { label: kind === '-.->' ? 'Solid' : 'Dotted', key: 'D', hotkey: 'd', run: run('dotted') },
    { label: kind === '---' ? 'With an arrowhead' : 'A plain line', run: run('line') },
    kind === '-->' || edge?.label ? { label: edge?.label ? 'Change the words…' : 'Words on it…', key: 'Enter', run: () => tab.canvas.labelEdge(a) } : null,
    '-',
    { label: 'Take the arrow out', key: '⌫', danger: true, run: run('delete') },
  ]);
}

function deleteBox(tab, pre, id) {
  const name = nodeText(pre, id);
  if (name == null) return;
  if (editFlow(tab, pre, (src) => ({ text: removeBox(src, name) }))) toast(`Deleted “${name}”.`, '', { label: 'Undo', run: () => drawUndo(tab) });
}

const COLOR_ITEMS = Object.keys(COLORS);
const colorLabel = (c) => c[0].toUpperCase() + c.slice(1);
function colorMenu(tab, pre, id, at) {
  const node = pre.flowNodes?.find((n) => n.id === id);
  if (!node) return;
  if (!flowEditable(pre)) { cantEdit(pre); return; }
  const r = tab.canvas?.stage.getBoundingClientRect();
  const pos = at || { x: r ? r.left + r.width / 2 : 200, y: r ? r.top + 60 : 200 };
  const paint = (c) => editFlow(tab, pre, (src) => ({ text: setColor(src, [node.text], c), select: node.text }));
  contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: pos.x, clientY: pos.y }, [
    ...COLOR_ITEMS.map((c, i) => ({ label: `${colorLabel(c)}${node.color === c ? ' ✓' : ''}`, swatch: COLORS[c], key: String(i + 1), hotkey: String(i + 1), run: () => paint(c) })),
    '-',
    { label: `No colour${node.color ? '' : ' ✓'}`, swatch: null, key: '0', hotkey: '0', run: () => paint(null) },
  ]);
}

function boxMenu(tab, e, pre, id) {
  const name = nodeText(pre, id);
  if (!flowEditable(pre)) {
    const from = pre.dataset.from;
    contextMenu(e, [from ? { label: `Open ${stem(from)} to draw on it`, run: () => openFile(from) } : null]);
    return;
  }
  contextMenu(e, [
    { label: 'Rename', key: 'Enter', run: () => tab.canvas.renameBox({ pre, id }) },
    { label: 'Add a box after it', key: 'Tab', run: () => addBoxAfter(tab, pre, id) },
    { label: 'Colour…', key: 'C', run: () => colorMenu(tab, pre, id, { x: e.clientX, y: e.clientY }) },
    { label: 'Shape…', key: 'S', run: () => shapeMenu(tab, pre, id, { x: e.clientX, y: e.clientY }) },
    { label: 'Select its text in the note', run: () => gotoBox(tab, pre, id) },
    { label: 'Comment…', key: 'M', run: () => drawingComment(tab, pre, { on: 'flow', box: name }, () => tab.canvas.hit(pre, id)?.getBoundingClientRect() || null) },
    '-',
    { label: `Delete “${name}”`, key: '⌫', danger: true, run: () => deleteBox(tab, pre, id) },
  ]);
}

const FLOW_WAYS = { TD: 'down', LR: 'right', RL: 'left', BT: 'up' };
function cardMenu(tab, e, pre) {
  const img = pre.querySelector(':scope > img');
  const from = pre.dataset.from;
  const flow = flowEditable(pre);
  const way = FLOW_WAYS[pre.flowDirection] || 'down';
  contextMenu(e, [
    flow ? { label: 'New box', key: 'N', run: () => editFlow(tab, pre, (src) => { const name = freshName(src); return { text: addBox(src, name), select: name, rename: true }; }) } : null,
    ...(flow ? ['down', 'right', 'left', 'up'].map((d) => ({ label: `Runs ${d}${d === way ? ' ✓' : ''}`, run: () => editFlow(tab, pre, (src) => ({ text: setDirection(src, d) })) })) : []),
    flow ? { label: 'Move to a note of its own…', run: () => moveFlowOut(tab, pre) } : null,
    from ? { label: `Open ${stem(from)}`, run: () => openFile(from) } : null,
    pre.dataset.board != null ? { label: 'Read it as a flow (below it)', run: () => sketchToFlowHere(tab, pre) } : null,
    flow || from || pre.dataset.board != null ? '-' : null,
    ...(pre.matches('.ink-figure') ? pictureItems(() => inkPicture(pre, tab.path))
      : img ? pictureItems(() => diagramPicture(img, from || tab.path, `${stem(from || tab.path)}-diagram`)) : []),
  ]);
}

// An arrow drawn on a picture: its kind (straight, curved, elbow), or out.
function inkArrowMenu(tab, e, fig, mark) {
  const now = mark.style || 'straight';
  contextMenu(e, [
    ...ARROW_STYLES.map((style) => ({ label: `${ARROW_KINDS[style][1]}${style === now ? ' ✓' : ''}`, run: () => { if (style !== now) inkEdit(tab, fig, { set: [mark.line, { ...mark, style, via: style === 'elbow' ? [] : mark.via }] }); } })),
    '-',
    { label: 'Delete', danger: true, run: () => inkEdit(tab, fig, { remove: mark.line }) },
  ]);
}

// Suggested once a picture: a flow this long reads better in a note of its own.
const BIG_FLOW = 30;
function bigFlowHint(tab, line, text) {
  if (text.split('\n').length < BIG_FLOW) return;
  tab.flowHinted ||= new Set();
  if (tab.flowHinted.has(line)) return;
  tab.flowHinted.add(line);
  toast('This flow is getting long. It can live in a note of its own, shown here as ![[…]].', '', {
    label: 'Move it…',
    run: () => { const pre = tab.canvasSections?.flatMap((s) => s.figures).find((f) => f.dataset.line === line && flowEditable(f)); if (pre) moveFlowOut(tab, pre); },
  });
}

// A ```flow block to its own note (in the same folder): the block becomes
// ![[Name]], and the canvas still shows it here.
async function moveFlowOut(tab, pre) {
  if (!flowEditable(pre)) { cantEdit(pre); return; }
  if (suggestingNow(tab)) return;
  const line = Number(pre.dataset.line);
  const src = pre.dataset.source.replace(/\n$/, '');
  const where = () => {
    const v = tab.editor.value;
    const start = lineOffset(v, line);
    const body = lineOffset(v, line + 1);
    const closeAt = lineOffset(v, line + 1 + src.split('\n').length);
    const nl = v.indexOf('\n', closeAt);
    const end = nl < 0 ? v.length : nl;
    const ok = v.slice(body, body + src.length) === src && /^\s*(`{3,}|~{3,})\s*$/.test(v.slice(closeAt, end));
    return ok ? { v, start, end, fence: v.slice(start, body - 1).trim(), close: v.slice(closeAt, end).trim() } : null;
  };
  if (!where()) { toast('The note changed — try again.', 'error'); return; }
  const section = tab.canvasSections?.find((s) => s.figures.includes(pre));
  const suggested = section && section.line > 0 ? section.title : pre.flowNodes[0]?.text || 'Flow';
  const dir = dirname(tab.path);
  const typed = await askText({ title: 'Move this flow to a note of its own', label: `It goes to a new note${dir ? ` in ${dir}/` : ''}; here it becomes ![[name]] and shows as before.`, value: suggested.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim(), okLabel: 'Move' });
  const name = typed?.trim().replace(/\.md$/i, '');
  if (!name) return;
  if (/[\\/#^[\]|]/.test(name)) { toast('A name without / \\ # ^ [ ] |, please.', 'error'); return; }
  const path = `${dir ? `${dir}/` : ''}${name}.md`;
  if (S.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) { toast(`${path} is there already.`, 'error'); return; }
  const w = where();
  if (!w) { toast('The note changed — try again.', 'error'); return; }
  const content = `${w.fence}\n${src}\n${w.close}\n`;
  try { await api('POST', '/api/file', { path, content }); } catch (e) { toast(e.message, 'error'); return; }
  noteSources.set(path, content);
  // Known to the tree first, so the link finds it when the note is drawn again.
  await loadTree();
  const now = where();
  if (!now) { toast(`${path} was made, but the note changed meanwhile: the flow stays here too.`, 'error'); return; }
  tab.editor.closeStep();
  tab.editor.replace(now.start, now.end, `![[${name}]]`, now.start);
  tab.editor.closeStep();
  toast(`Moved to ${path}.`, '', { label: 'Open it', run: () => openFile(path) });
}

// Where a new block goes: after the cursor's line, out of the fenced block
// (or front matter) the cursor is in, and after the ```ink of a picture it is
// on (that pair stays one). → the text to replace it with, and the block's
// first line.
function belowCursor(tab, block) {
  const v = tab.editor.value;
  const lines = v.split('\n');
  let line = v.slice(0, tab.editor.selectionStart).split('\n').length - 1;
  const fences = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!fence && m) fence = { mark: m[1], at: i, info: m[2].trim() };
    else if (fence && m && lines[i].trim().startsWith(fence.mark) && !lines[i].trim().slice(fence.mark.length).trim()) {
      fences.push({ ...fence, end: i });
      fence = null;
    }
  }
  const inside = fences.find((f) => line >= f.at && line <= f.end);
  if (inside) line = inside.end;
  else if (/!\[/.test(lines[line] || '')) {
    let next = line + 1;
    while (next < lines.length && !lines[next].trim()) next++;
    const ink = fences.find((f) => f.at === next && /^ink$/i.test(f.info));
    if (ink) line = ink.end;
  }
  const lineStart = lineOffset(v, line);
  const nl = v.indexOf('\n', lineStart);
  const pos = nl < 0 ? v.length : nl;
  const blank = !lines[line]?.trim();
  const at = blank ? lineStart : pos;
  const before = v.slice(0, at);
  const after = v.slice(blank ? pos : at);
  const lead = !before || before.endsWith('\n\n') || (blank && before.endsWith('\n') && !before.trim()) ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return { at, end: blank ? pos : at, text: lead + block + tail, start: at + lead.length, line: (before + lead).split('\n').length - 1 };
}

// A new ```flow picture below the cursor's line (after the block the cursor
// is in), with one box to name.
function newFlowHere(tab = fileTab()) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note to add a flow.', 'error'); return; }
  if (suggestingNow(tab)) return;
  const b = belowCursor(tab, '```flow\nStart\n```');
  tab.editor.closeStep();
  tab.editor.replace(b.at, b.end, b.text, b.start + 8);
  tab.editor.closeStep();
  if (tab.canvas?.el.isConnected) {
    tab.canvas.selectSoon(b.line, 'Start', true);
    tab.canvas.stage.focus({ preventScroll: true });
  } else toast(withKey('A flow: draw on it in the Canvas view', 'cycle-mode'));
}

// A sketch: a blank ```ink board below the cursor's line, on the canvas
// with the pen up — for drawing as it comes, in a meeting say. Opens the
// canvas when it isn't.
function newSketchHere(tab = fileTab()) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note to add a sketch.', 'error'); return; }
  if (suggestingNow(tab)) return;
  const b = belowCursor(tab, `\`\`\`ink\n${boardLine()}\n\`\`\``);
  tab.editor.closeStep();
  tab.editor.replace(b.at, b.end, b.text, b.start);
  tab.editor.closeStep();
  if (!tab.canvas?.el.isConnected) setMode('canvas');
  const cv = tab.canvas;
  if (!cv?.el.isConnected) return;
  renderCanvas(tab);
  // Writing on a blank page: in black, unless another pen was picked.
  if (cv.ink.color === 'red') { cv.ink.color = 'black'; cv.ink.paintDot(); }
  // Looking at it, wherever the camera was (once the view is laid out).
  requestAnimationFrame(() => { if (cv.el.isConnected && cv.goal?.fig?.dataset.board != null) cv.refocus(false); });
  cv.ink.use('pen');
  cv.stage.focus({ preventScroll: true });
}

// The sketches of a note: [{ line, close, source }] (the lines of their
// fences, 0-based) — ```ink blocks with a board and no picture above.
function sketchBlocks(v) {
  const lines = v.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})\s*ink\s*$/i.exec(lines[i]);
    if (!m) continue;
    const fence = m[1];
    let j = i + 1;
    while (j < lines.length && !(lines[j].trim().startsWith(fence) && /^(`+|~+)$/.test(lines[j].trim()))) j++;
    const source = lines.slice(i + 1, j).join('\n');
    let k = i - 1;
    while (k >= 0 && !lines[k].trim()) k--;
    const picture = k >= 0 && /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(lines[k]);
    if (!picture && parseInk(source).board) out.push({ line: i, close: j, source });
    i = j;
  }
  return out;
}

// A sketch read as a flow (public/sketchflow.js): its boxes, words and
// arrows written as a ```flow block below it, one ⌘Z; the sketch stays.
// What can't be read so (pen strokes, say) can go to an agent, whose flow
// comes back to review. The sketch: fig's, else the one looked at on the
// canvas, the one at the cursor, or the note's only one.
function sketchToFlowHere(tab = fileTab(), fig = null) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note with a sketch first.', 'error'); return; }
  if (suggestingNow(tab)) return;
  const v = tab.editor.value;
  const all = sketchBlocks(v);
  const looked = fig || (tab.canvas?.el.isConnected ? canvasGoal(tab)?.fig : null);
  const want = looked?.dataset?.board != null ? Number(looked.dataset.line) : null;
  const cur = v.slice(0, tab.editor.selectionStart).split('\n').length - 1;
  const s = all.find((b) => b.line === want) || all.find((b) => b.line <= cur && cur <= b.close) || (all.length === 1 ? all[0] : null);
  if (!s) { toast(all.length ? 'Put the cursor in the sketch to read as a flow.' : 'No sketch here: make one with ⌥X p s.'); return; }
  const r = sketchToFlow(s.source);
  const ask = { label: 'Ask an agent', run: () => sketchAgent(tab, s, !!r) };
  if (!r) { toast('Nothing in this sketch reads as a step yet: boxes, words and arrows do; pen strokes don’t.', '', ask); return; }
  const end = lineOffset(v, s.close) + (v.split('\n')[s.close] ?? '').length;
  const after = v.slice(end);
  const block = `\n\n\`\`\`flow\n${r.text}\n\`\`\``;
  const text = block + (!after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n');
  const first = parseFlow(r.text).nodes[0]?.text;
  tab.editor.closeStep();
  tab.editor.replace(end, end, text, end + 10);
  tab.editor.closeStep();
  if (tab.canvas?.el.isConnected) {
    if (first) tab.canvas.selectSoon(s.close + 2, first);
    tab.canvas.stage.focus({ preventScroll: true });
  }
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const left = [
    r.left.pen && plural(r.left.pen, 'pen stroke'),
    r.left.num && plural(r.left.num, 'numbered dot'),
    r.left.arrows && `${plural(r.left.arrows, 'arrow')} joining no step`,
  ].filter(Boolean);
  const said = [`A flow of ${plural(r.steps, 'step')} and ${plural(r.arrows, 'arrow')}, below the sketch.`,
    r.unnamed ? `${plural(r.unnamed, 'box', 'boxes')} without words: named Box 1${r.unnamed > 1 ? '…' : ''}.` : '',
    left.length ? `Not read: ${left.join(', ')}.` : ''].filter(Boolean).join(' ');
  toast(said, '', r.unnamed || r.left.pen || r.left.arrows ? ask : { label: 'Undo', run: () => drawUndo(tab) });
}

// An agent reads the sketch, pen strokes too, and writes (or mends) the
// flow below it: a run, to review.
function sketchAgent(tab, s, made) {
  const where = `the sketch (the \`\`\`ink block with a "board:" line, line ${s.line + 1} of ${tab.path})`;
  openTaskDialog(made
    ? `Read ${where} as a flow chart — its pen strokes too (a closed stroke may be a box, a line with a hook at its end an arrow) — and mend the \`\`\`flow block right below it, made from its boxes, words and arrows only: name the "Box 1"… steps from what the sketch says, add what the strokes show. Leave the sketch as it is.`
    : `Read ${where} as a flow chart — its pen strokes too (a closed stroke may be a box, a line with a hook at its end an arrow) — and write it as a \`\`\`flow block right below it. Leave the sketch as it is.`, { scope: 'file' });
}

// Pictures pasted on the canvas: kept in ./assets/ (as the editor does), each
// on a line of its own below the cursor's block; the camera goes to it, to
// draw on.
async function pastePictures(tab, files) {
  if (!isNote(tab.path)) return;
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is larger than 25 MB`, 'error'); continue; }
    try {
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const res = await api('POST', '/api/asset', { note: tab.path, name: file.name || `pasted.${ext}`, data: await blobBase64(file) });
      const b = belowCursor(tab, `![${stem(res.path)}](${encodeURI(res.path)})`);
      tab.editor.closeStep();
      tab.editor.replace(b.at, b.end, b.text, b.start);
      tab.editor.closeStep();
    } catch (e) { toast(`Could not add ${file.name}: ${e.message}`, 'error'); }
  }
  tab.canvas?.stage.focus({ preventScroll: true });
}

// Where ```flow blocks write a box named `name`: [[start, end]] offsets.
function flowBoxRanges(v, name) {
  const out = [];
  const lines = v.split('\n');
  let o = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})\s*flow\s*$/i.exec(lines[i]);
    if (!m) { o += lines[i].length + 1; continue; }
    let end = i + 1;
    while (end < lines.length && !lines[end].trim().startsWith(m[1])) end++;
    const starts = [];
    let p = o + lines[i].length + 1;
    for (let j = i + 1; j < end; j++) { starts.push(p); p += lines[j].length + 1; }
    try {
      for (const n of parseFlow(lines.slice(i + 1, end).join('\n')).nodes) {
        if (n.text === name) for (const sp of n.spots) out.push([starts[sp.line] + sp.start, starts[sp.line] + sp.end]);
      }
    } catch { /* an empty block */ }
    for (let j = i; j <= end && j < lines.length; j++) o += lines[j].length + 1;
    i = end;
  }
  return out;
}

// Rename a box everywhere: in every ```flow block and where the text names
// it, in one edit.
function renameEverywhere(tab, from, to) {
  const v = tab.editor.value;
  const ranges = [...flowBoxRanges(v, from), ...mentionRanges(v, from)].sort((x, y) => x[0] - y[0]);
  if (!ranges.length) return;
  const a = ranges[0][0];
  const b = ranges[ranges.length - 1][1];
  let out = '';
  let pos = a;
  for (const [x, y] of ranges) { out += v.slice(pos, x) + to; pos = y; }
  // The cursor stays where it was, moved by the renamings before it.
  const at = tab.editor.selectionStart;
  const caret = at + ranges.filter(([, y]) => y <= at).length * (to.length - from.length);
  tab.editor.replace(a, b, out, caret);
  const pinned = openComments(tab).filter((c) => c.pin?.on === 'flow' && c.pin.box === from);
  if (pinned.length) {
    for (const c of pinned) { c.pin = { ...c.pin, box: to }; c.quote = to; c.alts = []; }
    keepComments(tab);
  }
  toast(`Renamed ${ranges.length === 1 ? 'one more place' : `${ranges.length} more places`}.`);
}

// Add or remove "layout: figures" in the note's front matter.
function toggleFiguresLayout(tab = fileTab()) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note to change its layout.', 'error'); return; }
  const v = tab.editor.value;
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(v);
  let from = 0; let to = 0; let text;
  if (!m) text = `---\nlayout: figures\n---\n${v.startsWith('\n') ? '' : '\n'}`;
  else {
    from = 0; to = m[0].length;
    const lines = m[1].split('\n');
    const at = lines.findIndex((l) => /^layout:\s*figures\s*$/.test(l));
    if (at >= 0) lines.splice(at, 1); else lines.push('layout: figures');
    const body = lines.filter((l, i) => l.trim() || i < lines.length - 1).join('\n');
    text = body.trim() ? `---\n${body}\n---\n` : '';
    if (!text) to += /^\n*/.exec(v.slice(to))[0].length; // no front matter left: drop the gap too
  }
  tab.editor.replace(from, to, text);
  toast(hasFiguresLayout(tab.editor.value) ? 'Figures layout on — each section’s diagrams show beside it' : 'Figures layout off');
}

// Folding lives in the preview: a heading hides everything up to the next
// heading of the same or higher level. State is kept per tab by heading id.
function applyFolds(tab, p) {
  const folds = tab.folds || (tab.folds = new Set());
  let hideLevel = 0;
  for (const el of p.children) {
    const m = /^H([1-6])$/.exec(el.tagName);
    if (m) {
      const lvl = Number(m[1]);
      if (hideLevel && lvl <= hideLevel) hideLevel = 0;
      if (!el.querySelector('.fold-toggle')) el.prepend(h('button', { class: 'fold-toggle', title: 'Fold / unfold section', 'aria-label': 'Fold section' }));
      if (hideLevel) { el.classList.add('folded-away'); continue; }
      el.classList.toggle('folded', folds.has(el.id));
      if (folds.has(el.id)) hideLevel = lvl;
      continue;
    }
    if (hideLevel) el.classList.add('folded-away');
  }
}

function setFolds(tab, mode) {
  if (!tab?.previewEl) return;
  tab.folds = new Set(mode === 'all' ? [...tab.previewEl.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((x) => (x.parentElement === tab.previewEl || x.parentElement?.classList.contains('fig-text')) && !/^H1$/.test(x.tagName)).map((x) => x.id) : []);
  renderPreview(tab);
}

function renderBanner(tab = fileTab()) {
  if (!tab) { S.tabs.forEach((t) => t.kind === 'file' && t.bannerEl && isAttached(t) && renderBanner(t)); return; }
  const slot = tab.bannerEl;
  if (!slot || !slot.isConnected) return;
  if (tab.missing) {
    slot.replaceChildren(h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'This file no longer exists on disk. Saving will recreate it.')));
  } else if (tab.conflict) {
    slot.replaceChildren(h('div', { class: 'banner' },
      h('span', { class: 'grow' }, 'This file changed on disk while you had unsaved edits.'),
      h('button', { class: 'btn small', onclick: () => reloadTab(tab).then(() => renderBanner(tab)) }, 'Load disk version'),
      h('button', { class: 'btn small danger', onclick: () => saveTab(tab, { force: true }) }, 'Keep mine & overwrite')));
  } else slot.replaceChildren();
}

// Preview refresh adapts to render cost so huge notes never make typing lag.
let previewTimer = null;
let previewCost = 0;
function livePreview(tab) {
  clearTimeout(previewTimer);
  // Labs, steady drawing: typing in a ```flow block keeps the picture until
  // the line is whole (not ending in an arrow or " :") and typing pauses —
  // so half-typed names and arrows don't redraw and reshuffle the boxes.
  const steady = S.settings.labSteadyDraw && tab.editor && flowLineAt(tab.content, tab.editor.selectionStart);
  const wait = steady ? (steady.partial ? 2500 : 700) : 0;
  previewTimer = setTimeout(() => {
    if (tab !== activeTab()) return;
    const t = performance.now();
    renderPreview(tab);
    previewCost = performance.now() - t;
  }, Math.max(wait, Math.min(1500, 120 + previewCost * 3)));
}
const liveOutline = debounce(() => { if (S.view === 'files') renderSidebar(); }, 400);

function onEdit(tab) {
  livePreview(tab);
  liveOutline();
  scheduleAutosave(tab);
  const dirtyNow = tab.content !== tab.saved;
  if (dirtyNow !== tab.wasDirty) { tab.wasDirty = dirtyNow; renderTabs(); }
  renderStatus();
}

function setMode(m) {
  // A .mmd file has its own view (it opens as the diagram), notes share the pane's.
  const t = activeIn(S.focus);
  if (t?.kind === 'file' && isMermaidFile(t.path)) { t.mmdMode = m; renderContent(S.focus); return; }
  S.mode = m;
  S.groups[S.focus].mode = m;
  persist();
  renderContent(S.focus);
}

// Line-accurate scroll sync: find the preview blocks around the editor's top
// source line (blocks carry data-line) and interpolate between them.
function syncScroll(tab) {
  const p = tab.previewEl;
  const ed = tab.editor;
  if (groupMode(tab) !== 'split' || !p || !ed) return;
  if (ed.scrollTop <= 0) { p.scrollTop = 0; return; }
  if (ed.scrollTop >= ed.scrollHeight - ed.clientHeight - 2) { p.scrollTop = p.scrollHeight; return; }
  const line = ed.topLine() - 1;
  let before = null;
  let after = null;
  for (const el of p.querySelectorAll('[data-line]')) {
    if (!el.offsetParent || el.closest('.fig-side')) continue; // folded away, or a figure beside the text
    const l = Number(el.dataset.line);
    if (l <= line) before = el;
    else { after = el; break; }
  }
  if (!before) { p.scrollTop = 0; return; }
  const bl = Number(before.dataset.line);
  const al = after ? Number(after.dataset.line) : bl + 1;
  const bt = before.offsetTop;
  const at = after ? after.offsetTop : bt + before.offsetHeight;
  p.scrollTop = bt + (at - bt) * ((line - bl) / Math.max(1, al - bl)) - 16;
}

// Outline click: scroll the preview in preview mode, otherwise move the cursor.
function gotoHeading(line) {
  navJump();
  const p = fileTab()?.previewEl;
  if (groupMode(fileTab()) === 'preview' && p) {
    const el = p.querySelector(`[data-line="${line}"]`);
    if (el) { p.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' }); return; }
  }
  gotoLine(line + 1);
}

// Highlight the outline entry for the section containing the cursor.
function markActiveHeading() {
  const tab = fileTab();
  if (!tab?.editor) return;
  // Pictures follow the cursor in notes without headings too.
  markFigureRow();
  followCursor();
  const rows = document.querySelectorAll('.heading-row');
  if (!rows.length) return;
  const cur = tab.editor.cursorLine() - 1;
  let active = null;
  for (const r of rows) if (Number(r.dataset.line) <= cur) active = r;
  rows.forEach((r) => r.classList.toggle('current', r === active));
}

function gotoLine(line) {
  const tab = fileTab();
  if (!tab) return;
  if (tab.editor && tab.editor.cursorLine() !== line) navJump(tab);
  if (groupMode(tab) === 'preview') setMode('split');
  tab.editor.gotoLine(line);
  renderStatus();
}

function searchFor(q) {
  S.searchQuery = q;
  S.view = 'search';
  $('#app').classList.remove('no-sidebar');
  persist();
  renderSidebar();
  runSearch();
}

function previewClick(e, tab) {
  // A picture in the note: shown larger (not a diagram or drawing, which have
  // their own view, nor a picture that is a link).
  const pic = e.target.closest('img');
  if (pic && !pic.closest('a, pre, .drawing-embed, .mmd-embed') && pic.naturalWidth) {
    // A picture with marks: larger with them (and its hidden parts hidden).
    const fig = pic.parentElement?.matches('.ink-figure') && pic.parentElement;
    if (fig?.inkMarks?.length) viewPicture(inkPicture(fig, tab.path), pic.alt || 'Picture'); else viewImage(pic);
    return;
  }
  const fold = e.target.closest('.fold-toggle');
  if (fold) {
    const id = fold.parentElement.id;
    tab.folds ||= new Set();
    tab.folds.has(id) ? tab.folds.delete(id) : tab.folds.add(id);
    renderPreview(tab);
    return;
  }
  const tagEl = e.target.closest('a.tag');
  if (tagEl) { e.preventDefault(); searchFor(`#${tagEl.dataset.tag}`); return; }
  if (e.target.closest('.diagram-copy')) return; // handled globally
  const embedHead = e.target.closest('.note-embed-head');
  if (embedHead) { followLink(embedHead.parentElement.dataset.target, tab.path); return; }
  const drawingEl = e.target.closest('.drawing-embed[data-path], .mmd-embed[data-path]');
  if (drawingEl) { openFile(drawingEl.dataset.path, { side: e.metaKey || e.ctrlKey }); return; }
  const box = e.target.closest('input.task');
  if (box) {
    // Toggle the checkbox in the source; the file stays the source of truth.
    const n = Number(box.dataset.line);
    const lines = tab.content.split('\n');
    const from = lines.slice(0, n).reduce((acc, l) => acc + l.length + 1, 0);
    const next = lines[n].replace(/\[([ xX])\]/, (_, c) => (c === ' ' ? '[x]' : '[ ]'));
    const keep = tab.editor.scrollTop;
    tab.editor.replace(from, from + lines[n].length, next);
    tab.editor.scrollTop = keep;
    return;
  }
  const a = e.target.closest('a.internal');
  if (!a) return;
  e.preventDefault();
  const target = a.dataset.target || a.dataset.href;
  if (a.dataset.href?.startsWith('#')) {
    const el = document.getElementById(slug(decodeURIComponent(target.slice(1))));
    el?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  // Markdown links may be URL-encoded ("my%20note.md#next-steps").
  let link = target;
  if (a.dataset.href) try { link = decodeURIComponent(target); } catch { /* keep as written */ }
  followOrCreate(link, tab.path);
}

// Follow a link from a note; one to a note that doesn't exist offers to
// create it, next to this one.
async function followOrCreate(link, fromPath) {
  if (await followLink(link, fromPath)) return;
  // A new note is named without the section.
  const name = splitLink(link).note;
  if (!name) { toast('No such note'); return; }
  if (!(await askConfirm(`"${name}" doesn't exist yet. Create it?`, { okLabel: 'Create' }))) return;
  const p = [dirname(fromPath), name].filter(Boolean).join('/');
  api('POST', '/api/file', { path: p }).then((f) => loadTree().then(() => openFile(f.path))).catch((err) => toast(err.message, 'error'));
}

// ⌘/Ctrl-click in the editor follows the link under the pointer (the click
// has already put the caret there).
function editorLinkClick(e, ed, tab) {
  if (!(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || e.button !== 0) return;
  if (ed.ta.selectionStart !== ed.ta.selectionEnd) return; // a selection being made
  if (followLinkAt(ed, tab)) e.preventDefault();
}

// Follow the link the caret is on (⌘-click, or the leader key's l l).
// Returns whether there was one.
function followLinkAt(ed, tab) {
  const text = ed.value;
  const pos = ed.ta.selectionStart;
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const end = text.indexOf('\n', pos);
  const l = linkAt(text.slice(start, end < 0 ? text.length : end), pos - start);
  if (!l) return false;
  hideLinkPreview();
  followLinkTarget(l, tab);
  return true;
}
function followLinkTarget(l, tab) {
  if (l.kind === 'url' || /^(https?:|mailto:)/i.test(l.target)) { window.open(l.target, '_blank', 'noopener,noreferrer'); return; }
  if (/^[a-z][\w+.-]*:/i.test(l.target)) return; // javascript:, file: … never
  if (l.kind === 'wiki') { followOrCreate(l.target, tab.path); return; }
  let target = l.target;
  try { target = decodeURIComponent(target); } catch { /* as written */ }
  if (l.image) {
    const m = /[?&]path=([^&]+)/.exec(localImage(l.target, tab.path) || '');
    if (m) openImage(decodeURIComponent(m[1]));
    return;
  }
  followOrCreate(target, tab.path);
}

function renderStatus() {
  const tab = activeTab();
  const items = [
    h('span', { class: 'item lock', title: 'Bound to 127.0.0.1. This app makes no outbound network requests; remote images are not loaded.' }, '● local only'),
    h('span', { class: 'item clickable', title: desktop ? 'Choose agent' : 'Agent', onclick: () => (desktop ? desktop.configureAgent() : showView('agent')) }, S.info?.agent?.configured ? `✦ ${S.info.agent.label}` : '✦ no agent'),
    h('span', { class: 'grow' }),
    h('span', { class: 'item clickable', title: 'Change theme', onclick: () => pickTheme() }, `◐ ${currentTheme().name}${S.settings.theme === 'system' ? ' (auto)' : ''}`),
  ];
  if (S.outside?.length) {
    items.splice(2, 0, h('span', { class: 'item clickable outside-count', title: 'Notes another program changed (an agent in a terminal, another editor). Click to review them change by change.', onclick: openOutside },
      `↯ ${S.outside.length} changed outside`));
  }
  if (echoText) items.splice(2, 0, h('span', { class: 'item echo' }, echoText));
  if (macros.recording) items.splice(2, 0, h('span', { class: 'item rec clickable', title: 'Click to stop recording', onclick: stopRecording }, `● Recording macro · ${kbd('macro-play') || '⌥X q q'} stops`));
  // Suggesting, comments, meeting mode: what a meeting needs to see.
  const mine = [];
  if (tab?.kind === 'file' && isNote(tab.path)) {
    const waiting = !tab.proof?.on && proofRun(tab);
    if (tab.proof?.on) mine.push(h('span', { class: 'item clickable pen-chip', title: `Your edits are suggestions: the note stays as it is. Click or ${kbd('suggest') || '⌥X p p'} to stop.`, onclick: () => toggleSuggest(tab) }, '✎ Suggesting'));
    else if (waiting) mine.push(h('span', { class: 'item clickable pen-chip', title: 'Your suggestions on this note wait for review', onclick: () => openReview(waiting.id) }, '✎ Suggestions waiting'));
    const part = tab.editor?.narrowed;
    if (part) mine.push(h('span', { class: 'item clickable narrow-chip', title: `Only lines ${part.from}–${part.to} are in view; saving keeps the whole note. Click or ${kbd('leader') || '⌥X'} n w to show all of it.`, onclick: () => widenHere(tab) }, `⊟ Narrowed · ${part.from}–${part.to}`));
    const n = openComments(tab).length;
    if (n) mine.push(h('span', { class: 'item clickable pen-chip', title: `Comments beside this note · ${kbd('leader') || '⌥X'} p n: the next one`, onclick: () => stepNote(tab, 1) }, `✍ ${n} comment${n === 1 ? '' : 's'}`));
  }
  if (S.meeting) {
    $('#status').replaceChildren(h('span', { class: 'item clickable meeting-chip', title: `Leave meeting mode (${kbd('meeting') || '⌥X p m'})`, onclick: toggleMeeting }, '● Meeting'), ...mine, h('span', { class: 'grow' }),
      h('span', { class: 'item' }, [kbd('suggest') && `${kbd('suggest')} suggest`, kbd('strike') && `${kbd('strike')} strike`, kbd('comment') && `${kbd('comment')} comment`].filter(Boolean).join(' · ')));
    return;
  }
  items.splice(2, 0, ...mine);
  if (tab?.kind === 'file') {
    const ed = tab.editor;
    if (ed) {
      const before = ed.value.slice(0, ed.selectionStart);
      const ln = before.split('\n').length;
      const col = ed.selectionStart - before.lastIndexOf('\n');
      const selLen = ed.selectionEnd - ed.selectionStart;
      items.push(h('span', { class: 'item' }, `Ln ${ln}, Col ${col}${selLen ? ` (${selLen} selected)` : ''}`));
    }
    const words = (tab.content.match(/[\p{L}\p{N}]+/gu) || []).length;
    items.push(h('span', { class: 'item', title: 'Reading time at ~230 words/min' }, `${words} words · ${Math.max(1, Math.round(words / 230))} min`));
    items.push(h('span', { class: 'item' }, tab.saving ? 'saving…' : tab.content !== tab.saved ? (S.settings.autosave ? '● editing' : '● unsaved') : 'saved'));
  }
  $('#status').replaceChildren(...items);
  markActiveHeading();
}

function showView(v) {
  const app = $('#app');
  if (S.view === v && !app.classList.contains('no-sidebar')) app.classList.add('no-sidebar');
  else { app.classList.remove('no-sidebar'); S.view = v; }
  persist();
  renderSidebar();
  if (S.view === 'search' && !app.classList.contains('no-sidebar')) $('#search-input')?.focus();
  if (S.view === 'agent') loadRuns();
  if (S.view === 'git') loadGit();
}

// ------------------------------------------------------------------ palette

function marked(text, idx) {
  const set = new Set(idx);
  return [...text].map((c, i) => (set.has(i) ? h('b', {}, c) : c));
}

const COMMANDS = [
  ['Switch note (buffers)…', () => setTimeout(pickTab, 0), { key: 'buffers' }],
  ['Back to the note before', otherBuffer, { key: 'other-note' }],
  ['Messages', () => openMessages()],
  ['Agent runs (as a buffer)', () => openRuns()],
  ['Search results (as a buffer)', () => openSearchBuffer()],
  ['Recipes: edit (RECIPES.md)', () => editRecipes()],
  ['Edit leader keys', () => editLeaderKeys()],
  ['Macro: save the last one (MACROS.md)…', () => setTimeout(saveLastMacro, 0)],
  ['Macros: edit (MACROS.md)', () => editMacros()],
  ['Make or change a command… (ask the agent)', () => setTimeout(() => changeByAgent(), 0)],
  ['Describe a key…', () => describeKey()],
  ['Describe a command…', () => setTimeout(describeCommand, 0)],
  ['Dired: edit a folder as text…', () => setTimeout(pickDiredFolder, 0)],
  ['Dired: the folder of this note', () => diredHere()],
  ['Narrow to this section or the selected lines', () => narrowHere()],
  ['Widen: show the whole note', () => widenHere()],
  ['Tasks in all notes (agenda)', () => openTasks()],
  ['Instructions for agents in this folder (AGENTS.md)', () => editAgentInstructions()],
  ['Paste from the copy history…', () => setTimeout(pasteFromHistory, 0), { key: 'paste-history' }],
  ['Jump to a word in view…', () => setTimeout(jumpInNote, 0), { key: 'jump' }],
  ['Changes from outside (agents, other editors)…', () => openOutside()],
  ['Review the next agent run', () => reviewNext()],
  ['New note', () => newNote()],
  ['New note from template…', () => setTimeout(() => pickTemplate((t) => newNote(undefined, t)), 0)],
  ['Insert template…', () => setTimeout(() => pickTemplate(insertTemplate, 'Insert template…'), 0)],
  ['Open today’s journal note', openDaily],
  ['Quick capture…', () => setTimeout(quickCapture, 0), desktop ? { key: 'quick-capture' } : undefined],
  ['Delegate a task to the agent…', () => openTaskDialog(), { key: 'delegate' }],
  ['Show current file in the tree', () => locateFile()],
  ['Show agent runs', () => showView('agent'), { key: 'runs' }],
  ['Search in workspace', () => showView('search'), { key: 'search' }],
  ['Find in note', () => findInNote(), { key: 'find' }],
  ['Replace in note', () => findInNote(undefined, { replace: true }), { key: 'replace' }],
  ['Toggle: tree follows the active tab', toggleFollowTab],
  ['Bookmark / remove bookmark for this file', () => toggleBookmark((fileTab() || drawingTab())?.path)],
  ['Go to heading…', () => setTimeout(() => openPalette('#'), 0), '#'],
  ['Go to heading in any note…', () => setTimeout(() => openPalette('@'), 0), '@'],
  ['Go to line…', () => setTimeout(() => openPalette(':'), 0), ':'],
  ['Save', () => saveTab(), { key: 'save' }],
  ['Settings', () => openSettings(), { key: 'settings' }],
  ['Keyboard shortcuts…', () => openSettings({ keys: true })],
  ['Theme: choose…', () => setTimeout(pickTheme, 0)],
  ['Insert Mermaid diagram…', () => setTimeout(pickDiagram, 0)],
  ['Insert flow (simple diagram notation)', () => insertFlow()],
  ['Toggle figures layout (text | diagrams)', () => toggleFiguresLayout()],
  ['Theme: toggle light / dark', toggleLightDark],
  ['Focus mode', toggleFocusMode, { key: 'focus' }],
  ['View: edit only', () => setMode('edit')],
  ['View: split editor and preview', () => setMode('split')],
  ['View: preview only', () => setMode('preview')],
  ['View: editor and canvas (pictures follow the cursor)', () => setMode('canvas')],
  ['Canvas: present the flows (full screen, one box at a time)', () => presentFlows()],
  ['Flow: new flow to draw on', () => newFlowHere()],
  ['Sketch: a blank board to draw on, below the cursor', () => newSketchHere()],
  ['Sketch: read it as a flow (below it)', () => sketchToFlowHere()],
  ['Flow: move the flow at the cursor to a note of its own', () => moveFlowAtCursor()],
  ['Canvas: copy the whole canvas as an image', () => canvasExport((p) => copyPicture(p))],
  ['Canvas: save the whole canvas as PNG', () => canvasExport((p) => savePicture(p))],
  ['Canvas: follow the flow to the next box', () => walkFlow(false), { key: 'flow-next' }],
  ['Canvas: follow the flow to the box before', () => walkFlow(true), { key: 'flow-back' }],
  ['Editor: toggle syntax highlighting', () => setSetting('highlight', !S.settings.highlight)],
  ['Editor: toggle autosave', () => { setSetting('autosave', !S.settings.autosave); toast(`Autosave ${S.settings.autosave ? 'on' : 'off'}`); }],
  ['Editor: toggle spellcheck', () => setSetting('spellcheck', !S.settings.spellcheck)],
  ['Editor: bigger text', () => setSetting('fontSize', Math.min(24, S.settings.fontSize + 1))],
  ['Editor: smaller text', () => setSetting('fontSize', Math.max(11, S.settings.fontSize - 1))],
  ['Go back', () => navGo(-1), { key: 'nav-back' }],
  ['Go forward', () => navGo(1), { key: 'nav-forward' }],
  ['Toggle sidebar', toggleSidebar, { key: 'sidebar' }],
  ['New drawing (Excalidraw)…', () => newDrawing()],
  ['New Mermaid diagram file (.mmd)…', () => setTimeout(() => newMermaidFile(), 0)],
  ['Reload files from disk', () => loadTree().then(syncOpenTabs)],
  ...(desktop ? [
    ['Open file…', () => desktop.openFile(), { key: 'open-file' }],
    ['Open folder…', () => desktop.openFolder(), { key: 'open-folder' }],
    ['Choose agent…', () => desktop.configureAgent()],
    ['Reveal workspace folder', () => desktop.revealFolder()],
    [`${REVEAL_LABEL}: current note`, () => fileTab() && desktop.revealPath?.(fileTab().path)],
  ] : []),
  ['Git: show changes', () => showView('git')],
  ['Git: commit all changes…', () => { showView('git'); setTimeout(() => $('.git-msg')?.focus(), 50); }],
  ['History of current note (kept versions and git)', () => fileTab() && openHistory(fileTab().path)],
  ['Preview: fold all sections', () => setFolds(fileTab(), 'all')],
  ['Preview: unfold all sections', () => setFolds(fileTab(), 'none')],
  ['Editor: format table', () => fileTab()?.editor.formatTable(0), { key: 'format-table' }],
  ['Editor: select all occurrences', () => fileTab()?.editor._selectAllOccurrences(), { key: 'all-occurrences' }],
  ['Export note as HTML…', () => exportHtml()],
  ['Print / save note as PDF…', () => printNote()],
  ['Rename / move current note…', () => fileTab() && renameItem(fileTab().path), { key: 'rename' }],
  ['Delete current note', () => fileTab() && deleteItem(fileTab().path)],
  ['New folder…', () => newFolder()],
  ['Copy note for GitHub (flows as Mermaid)', () => copyWithMermaid()],
  ['Copy [[link]] to current note', () => fileTab() && navigator.clipboard.writeText(`[[${stem(fileTab().path)}]]`).then(() => toast('Link copied'))],
  ['Split: open to the side', splitRight, { key: 'split' }],
  ['Split: move tab to other pane', () => activeTab() && moveTab(activeTab(), activeTab().group === 0 ? 1 : 0)],
  ['Split: close pane', () => closePane(S.focus)],
  ['Close tab', () => activeTab() && closeTab(activeTab().id), { key: 'close-tab' }],
  ['Close other tabs', () => activeTab() && closeTabs(S.tabs.filter((x) => x.group === S.focus && x !== activeTab()))],
  ['Close all tabs', () => closeTabs(S.tabs)],
];

// M-x: every command by name — the palette's, the leader's (with its keys),
// the recipes, and the keys of the buffer in view — with its shortcut and its
// ⌥X path. The buffer's own come first, then the ones used lately.
const NOTE_COMMAND = /^(Editor|Preview|Canvas|View|Insert|Find in note|Replace in note|Go to (heading|line)|Narrow|Widen)\b/;
let mxRecent = (() => { try { return JSON.parse(store.getItem('an.mx') || '[]').filter((x) => typeof x === 'string'); } catch { return []; } })();
const norm = (n) => n.toLowerCase().replace(/…$/, '').trim();
const upper = (w) => w.charAt(0).toUpperCase() + w.slice(1);
// A leader key's command in M-x: its own name (the same whatever its label
// says now), or the group's and the label.
const leafName = (it, group) => it.cmd || (group ? `${upper(group)}: ${it.label}` : it.label);

function allCommands() {
  const tab = activeTab();
  const out = new Map();
  const add = (c) => {
    const had = out.get(norm(c.name));
    if (!had) { out.set(norm(c.name), c); return; }
    had.leader ||= c.leader;
  };
  if (tab && SPECIAL[tab.kind]) {
    const title = SPECIAL[tab.kind].title;
    for (const [key, label] of [...BUFFER_KEYS[tab.kind], ...COMMON_KEYS]) add({ name: `${title}: ${label}`, ctx: [tab.kind], inBuffer: key, run: () => pressBufferKey(tab, key) });
  }
  for (const [name, run, opt] of COMMANDS) add({ name, run, shortcut: opt?.key || null, prefix: typeof opt === 'string' ? opt : null, ctx: NOTE_COMMAND.test(name) ? ['file'] : null });
  for (const r of recipes.list) add({ name: `Recipe: ${r.name}`, run: () => runRecipe(r), leader: r.key ? ['r', r.key] : null, ctx: r.scope === 'file' ? ['file'] : null, recipe: true });
  for (const m of kept.list) add({ name: `Macro: ${m.name}`, run: () => playKept(m), doc: keptDoc(m), ctx: ['file'], macro: m });
  // The leader's keys: on the command they run, or a command of their own.
  const walk = (items, path, group) => {
    for (const it of items) {
      if (it.when && !it.when()) continue;
      const keys = [...path, it.key];
      if (it.items) { walk(it.items, keys, it.label); continue; }
      if (it.mx === false) continue;
      if (it.recipe) { const c = out.get(norm(`Recipe: ${it.recipe.name}`)); if (c && !c.leader) c.leader = keys; continue; }
      const same = out.get(norm(it.cmd || '')) || out.get(norm(it.label));
      if (same) { same.leader ||= keys; same.alias ||= it.emacs; continue; }
      add({ name: leafName(it, group), run: it.run, leader: keys, alias: it.emacs });
    }
  };
  walk(leaderTree(), [], '');
  // Emacs's names: on Margin's own commands as a second name (M-x finds
  // either); with Emacs keys on, the rest as commands of their own.
  const all = [...out.values()];
  const named = new Map();
  for (const c of all) {
    c.alias ||= EMACS_ALIASES[c.name];
    if (c.alias) named.set(c.alias, c);
  }
  if (emacs.on) {
    for (const e of emacsCommands()) {
      const had = named.get(e.name);
      if (had) { had.emacsKey ||= e.keys; continue; }
      if (!editorShown(tab)) continue;
      all.push({ name: e.name, run: () => emacsRun(tab, e.cmd), emacsKey: e.keys, doc: e.doc, emacsOnly: true, ctx: ['file'] });
    }
  }
  return all;
}

// Margin's commands (M-x names) that Emacs has under a name of its own.
const EMACS_ALIASES = {
  'Save': 'save-buffer', 'Switch note (buffers)…': 'switch-to-buffer', 'Close tab': 'kill-buffer', 'Split: open to the side': 'split-window-right',
  'Dired: the folder of this note': 'dired', 'Narrow to this section or the selected lines': 'narrow-to-region', 'Widen: show the whole note': 'widen',
  'Go to line…': 'goto-line', 'Replace in note': 'replace-string', 'Go back': 'pop-global-mark', 'Messages': 'view-echo-area-messages',
  'Describe a key…': 'describe-key', 'Describe a command…': 'describe-command', 'Paste from the copy history…': 'yank-from-kill-ring',
  'Rename / move current note…': 'rename-visited-file', 'Tasks in all notes (agenda)': 'org-agenda', 'Back to the note before': 'mode-line-other-buffer',
};

function mxItems(q) {
  const tab = activeTab();
  const context = tab?.kind === 'file' ? 'file' : tab?.kind || '';
  const leaderKey = kbd('leader') || '⌥X';
  return rankCommands(allCommands(), q, { recent: mxRecent, context }).slice(0, 200).map(({ cmd, m }) => ({
    icon: cmd.inBuffer ? '◆' : cmd.recipe ? '✦' : '',
    // Found by its Emacs name: that name, then Margin's.
    label: m.alias ? [...marked(cmd.alias, m.idx), h('span', { class: 'pi-alias' }, cmd.name)] : marked(cmd.name, m.idx),
    hint: [cmd.inBuffer ? `key ${cmd.inBuffer}` : '', cmd.alias && !m.alias ? cmd.alias : '', cmd.emacsKey || '', cmd.shortcut ? kbd(cmd.shortcut) : cmd.prefix || '', cmd.leader ? `${leaderKey} ${cmd.leader.join(' ')}` : ''].filter(Boolean).join('  ·  '),
    run: () => {
      mxRecent = used(mxRecent, cmd.name);
      store.setItem('an.mx', JSON.stringify(mxRecent));
      remember(cmd.name, cmd.run);
      macros.command(cmd.name, cmd.run);
    },
  }));
}

// Generic keyboard-first picker used by quick open, commands and themes.
function picker({ placeholder, initial = '', source, onMove, onCancel }) {
  const overlay = $('#overlay');
  let sel = 0;
  let items = [];
  const input = h('input', { class: 'input', placeholder, value: initial, spellcheck: false });
  const list = h('div', { class: 'palette-list' });
  let done = false;
  // Never mind: back where the keys were (an editor, a buffer).
  const before = document.activeElement;
  const close = (cancelled) => {
    if (done) return;
    done = true;
    overlay.hidden = true;
    overlay.replaceChildren();
    if (cancelled && onCancel) onCancel();
    else if (cancelled && before?.isConnected && before !== document.body) before.focus();
  };
  const choose = (it, ev) => { close(false); it.run(ev); };
  const update = () => {
    items = source(input.value);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.replaceChildren(...(items.length ? items.map((it, i) => h('div', { class: `palette-item${i === sel ? ' sel' : ''}`,
      onmousedown: (e) => { e.preventDefault(); choose(it, e); }, onmousemove: () => { if (sel !== i) { sel = i; update(); } } },
    it.icon ? h('span', { class: 'pi-icon' }, it.icon) : null,
    h('span', { class: 'pi-label' }, it.label),
    it.hint ? h('span', { class: 'hint' }, it.hint) : null)) : [h('div', { class: 'palette-empty' }, 'No matches')]));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
    if (items[sel]) onMove?.(items[sel]);
  };
  input.addEventListener('input', () => { sel = 0; update(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); update(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); update(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); choose(items[sel], e); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  });
  overlay.onclick = (e) => { if (e.target === overlay) close(true); };
  overlay.replaceChildren(h('div', { class: 'dialog palette' }, input, list));
  overlay.hidden = false;
  update();
  input.focus();
  return { setIndex: (i) => { sel = i; update(); }, refresh: () => { if (input.isConnected) update(); } };
}

// Every heading in the workspace for "@" in quick open, fetched when asked
// for and kept a few seconds. Open notes count as they are in the editor.
const allHeadings = { at: 0, list: null, loading: null };
function workspaceHeadings(then) {
  if (allHeadings.list && Date.now() - allHeadings.at < 5000) return allHeadings.list;
  allHeadings.loading ||= api('GET', '/api/headings')
    .then((r) => { allHeadings.list = r.headings; allHeadings.at = Date.now(); then(); })
    .catch((e) => toast(e.message, 'error'))
    .finally(() => { allHeadings.loading = null; });
  return allHeadings.list; // the last list meanwhile (null the first time)
}

function openPalette(initial = '') {
  let pk = null;
  pk = picker({
    placeholder: `Go to note (${MOD}↵ opens to the side)   > commands   # headings   @ all headings   : line`,
    initial,
    source: (q) => {
      if (q.startsWith('>')) return mxItems(q.slice(1).trim());
      if (q.startsWith('#')) {
        const tab = fileTab();
        if (!tab) return [];
        const hq = q.slice(1).trim();
        return outline(tab.content).map((o) => ({ o, m: fuzzy(hq, o.text) })).filter((x) => x.m)
          .sort((a, b) => (hq ? b.m.score - a.m.score : a.o.line - b.o.line))
          .map(({ o, m }) => ({ label: [`${'  '.repeat(o.level - 1)}`, ...marked(o.text, m.idx)], hint: `H${o.level}`, run: () => gotoLine(o.line + 1) }));
      }
      if (q.startsWith('@')) {
        const list = workspaceHeadings(() => pk?.refresh());
        if (!list) return [{ label: ['Reading headings…'], run: () => {} }];
        const open = new Map(S.tabs.filter((t) => t.kind === 'file' && t.content != null).map((t) => [t.path, t]));
        const heads = [...list.filter((x) => !open.has(x.path)), ...[...open.values()].flatMap((t) => (isNote(t.path) ? outline(t.content).map((o) => ({ path: t.path, ...o })) : []))];
        const hq = q.slice(1).trim();
        if (!hq) return [];
        return heads.map((x) => ({ x, m: fuzzy(hq, x.text) })).filter((y) => y.m)
          .sort((a, b) => b.m.score - a.m.score || a.x.path.localeCompare(b.x.path) || a.x.line - b.x.line).slice(0, 60)
          .map(({ x, m }) => ({ label: marked(x.text, m.idx), hint: `${stem(x.path)} · H${x.level}`,
            run: (e) => openFile(x.path, { line: x.line + 1, side: !!(e?.metaKey || e?.ctrlKey) }) }));
      }
      if (q.startsWith(':')) {
        const n = parseInt(q.slice(1), 10);
        return fileTab() && n > 0 ? [{ label: `Go to line ${n}`, run: () => gotoLine(n) }] : [];
      }
      const recentRank = new Map(S.recent.map((p, i) => [p, i]));
      if (!q.trim()) {
        const recent = S.recent.filter((p) => S.files.some((f) => f.path === p)).slice(0, 12);
        const rest = S.files.filter((f) => f.note && !recentRank.has(f.path)).slice(0, 40).map((f) => f.path);
        return [...recent, ...rest].map((p) => ({ label: [basename(p).replace(/\.md$/, '')], hint: recentRank.has(p) ? `${dirname(p) || '/'} · recent` : dirname(p), run: (e) => openFile(p, { side: !!(e?.metaKey || e?.ctrlKey) }) }));
      }
      const items = S.files.map((f) => {
        const m = fuzzy(q, f.path);
        if (!m) return null;
        const nameM = fuzzy(q, basename(f.path));
        let score = m.score + (nameM ? nameM.score * 0.6 : 0) + (f.note ? 0.5 : 0);
        if (recentRank.has(f.path)) score += 3 - recentRank.get(f.path) * 0.1;
        return { f, m, score };
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 60)
        .map((x) => ({ label: marked(x.f.path, x.m.idx), run: (e) => openFile(x.f.path, { side: !!(e?.metaKey || e?.ctrlKey) }) }));
      items.push({ label: [`Create note “${q.trim()}”`], hint: 'new', run: () => api('POST', '/api/file', { path: q.trim() }).then((f) => loadTree().then(() => openFile(f.path))).catch((e) => toast(e.message, 'error')) });
      return items;
    },
  });
}

// Theme picker with live preview; Escape restores the previous theme.
// Starter diagrams; the preview renders ```mermaid blocks (public/diagrams.js).
function diagramTemplates() {
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  return [
    ['Flowchart', 'flowchart LR\n  A[Start] --> B{Decision?}\n  B -- yes --> C[Do it]\n  B -- no --> D[Skip]'],
    ['Sequence diagram', 'sequenceDiagram\n  participant U as User\n  participant S as Service\n  U->>S: Request\n  S-->>U: Response'],
    ['Gantt chart', `gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Work\n  Draft  :a1, ${day(0)}, 5d\n  Review :after a1, 3d\n  Ship   :milestone, after a1, 0d`],
    ['State diagram', 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Draft: changes\n  Review --> Published\n  Published --> [*]'],
    ['Class diagram', 'classDiagram\n  class Note {\n    +title\n    +tags\n    +links()\n  }\n  class Folder\n  Folder "1" --> "*" Note'],
    ['Entity relationship', 'erDiagram\n  PERSON ||--o{ NOTE : writes\n  NOTE }o--o{ TAG : has'],
    ['Mindmap', 'mindmap\n  root((Topic))\n    Idea A\n      Detail\n    Idea B\n    Idea C'],
    ['Pie chart', 'pie title Time spent\n  "Writing" : 50\n  "Research" : 30\n  "Review" : 20'],
    ['Timeline', 'timeline\n  title Project\n  Q1 : Research\n  Q2 : Build : Test\n  Q3 : Launch'],
  ];
}

function pickDiagram() {
  const tab = fileTab();
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note to insert a diagram.', 'error'); return; }
  picker({
    placeholder: 'Insert a Mermaid diagram…',
    source: (q) => diagramTemplates().map(([name, body]) => ({ name, body, m: fuzzy(q, name) })).filter((x) => x.m).map(({ name, body, m }) => ({
      icon: '◇', label: marked(name, m.idx), hint: 'mermaid',
      run: () => setTimeout(() => insertBlock(tab, `\`\`\`mermaid\n${body}\n\`\`\``), 0),
    })),
  });
}

// A ```flow block to start from (the notation: public/flow.js).
function insertFlow(tab = fileTab()) {
  if (!tab?.editor || !isNote(tab.path)) { toast('Open a note to insert a diagram.', 'error'); return; }
  insertBlock(tab, '```flow\nRequest -> Check -> OK?\n  yes -> Save\n  no -> Ask again : says why\n```');
}

// Insert a block at the cursor on its own lines, separated by blank lines.
function insertBlock(tab, block) {
  const ed = tab.editor;
  if (groupMode(tab) === 'preview') setMode('split');
  const v = ed.value;
  const before = v.slice(0, ed.selectionStart);
  const after = v.slice(ed.selectionEnd);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  ed.insert(pre + block + post);
}

function pickTheme() {
  const original = S.settings.theme;
  const pairName = (id) => allThemes().find((t) => t.id === id)?.name || id;
  const all = [{ id: 'system', name: `System (${pairName(S.settings.systemDark)} / ${pairName(S.settings.systemLight)})`, kind: 'auto' }, ...allThemes()];
  const p = picker({
    placeholder: 'Choose a theme…',
    source: (q) => all.map((t) => ({ t, m: fuzzy(q, t.name) })).filter((x) => x.m).map(({ t, m }) => ({
      icon: t.kind === 'light' ? '○' : t.kind === 'dark' ? '●' : '◐',
      label: marked(t.name, m.idx),
      hint: t.id === original ? 'current' : t.kind,
      theme: t.id,
      run: () => setSetting('theme', t.id),
    })),
    onMove: (it) => applyTheme(it.theme, { pair: themePair(), accent: S.settings.accent }),
    onCancel: () => applyTheme(original, { pair: themePair(), accent: S.settings.accent }),
  });
  p.setIndex(Math.max(0, all.findIndex((t) => t.id === original)));
}

function toggleLightDark() {
  const cur = currentTheme();
  setSetting('theme', cur.kind === 'dark' ? (S.settings.lastLight || 'paper') : (S.settings.lastDark || 'midnight'));
  S.settings[cur.kind === 'dark' ? 'lastDark' : 'lastLight'] = cur.id;
  store.setItem('an.settings', JSON.stringify(S.settings));
}

function toggleSidebar() {
  $('#app').classList.toggle('no-sidebar');
  renderActivity();
  const path = (fileTab() || drawingTab())?.path;
  if (S.settings.followTab && path && !$('#app').classList.contains('no-sidebar')) showInTree(path, { quiet: true });
}

function toggleFocusMode() {
  const on = document.documentElement.classList.toggle('focus-mode');
  if (on) toast(`Focus mode — ${kbd('focus') ? `${kbd('focus')} or ` : ''}Esc to exit`);
  fileTab()?.editor.focus();
}

function downloadText(name, text, type = 'application/json') {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function importTheme() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const theme = validateTheme(JSON.parse(await file.text()));
      const list = JSON.parse(store.getItem('an.customThemes') || '[]').filter((t) => validateTheme(t, false)?.id !== theme.id);
      list.push({ name: theme.name, kind: theme.kind, vars: theme.vars });
      store.setItem('an.customThemes', JSON.stringify(list));
      loadCustomThemes();
      setSetting('theme', theme.id);
      toast(`Theme “${theme.name}” imported`);
      openSettings();
    } catch (e) { toast(`Could not import theme: ${e.message}`, 'error'); }
  });
  input.click();
}

function removeCustomTheme(id) {
  const list = JSON.parse(store.getItem('an.customThemes') || '[]').filter((t) => validateTheme(t, false)?.id !== id);
  store.setItem('an.customThemes', JSON.stringify(list));
  loadCustomThemes();
  if (S.settings.theme === id) setSetting('theme', 'system');
  openSettings();
}

// Settings → Keyboard shortcuts: each one's keys, Change (press the new keys),
// ↺ back to the default, and Reset all. Keys another shortcut uses are only
// taken after asking; that one is left without.
function shortcutsSection() {
  const box = h('div', { class: 'keys-list' });
  let recording = null; // { id, why }
  let asking = null; // { id, keys, others }
  const label = (id) => SHORTCUTS.find((d) => d.id === id)?.label || id;
  const defaultOf = (id) => normalize(SHORTCUTS.find((d) => d.id === id)?.keys, isMac) || '';
  const set = async (changes) => { await saveShortcuts({ ...KEYS, ...changes }); render(); };
  const stop = () => {
    window.removeEventListener('keydown', onKey, true);
    desktop?.recordingKeys?.(false);
    recording = null;
  };
  // While recording, every key comes here first, so nothing else runs.
  function onKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(); render(); return; }
    const k = eventKeys(e, isMac);
    if (!k) return; // only a modifier so far
    const why = unusable(k, isMac);
    if (why) { recording.why = `${keyLabel(k, isMac) || k}: ${why}`; render(); return; }
    const { id } = recording;
    stop();
    const others = conflicts(keyDefs(), KEYS, id, k, isMac);
    if (others.length) { asking = { id, keys: k, others }; render(); return; }
    set({ [id]: k });
  }
  const record = (id) => {
    if (recording) stop();
    asking = null;
    recording = { id, why: '' };
    desktop?.recordingKeys?.(true);
    window.addEventListener('keydown', onKey, true);
    render();
  };
  const row = (d) => {
    const k = KEYS[d.id];
    const changed = k !== defaultOf(d.id);
    if (recording?.id === d.id) {
      return h('div', { class: 'key-row recording' },
        h('span', { class: 'key-name' }, d.label),
        h('span', { class: 'key-now' }, h('span', { class: 'key-wait' }, recording.why || 'Press the new keys… (Esc cancels)')),
        h('span', { class: 'key-btns' },
          h('button', { class: 'btn small', onclick: () => { stop(); set({ [d.id]: '' }); } }, 'None'),
          h('button', { class: 'btn small', onclick: () => { stop(); render(); } }, 'Cancel')));
    }
    if (asking?.id === d.id) {
      const names = asking.others.map((o) => `“${label(o)}”`).join(', ');
      return h('div', { class: 'key-row asking' },
        h('span', { class: 'key-name' }, d.label),
        h('span', { class: 'key-now' }, h('span', { class: 'key-warn' }, `${keyLabel(asking.keys, isMac)} is used by ${names}.`)),
        h('span', { class: 'key-btns' },
          h('button', { class: 'btn small primary', title: `${names} is left without a shortcut`, onclick: () => { const a = asking; asking = null; set({ [a.id]: a.keys, ...Object.fromEntries(a.others.map((o) => [o, ''])) }); } }, 'Use here'),
          h('button', { class: 'btn small', onclick: () => { asking = null; render(); } }, 'Cancel')));
    }
    return h('div', { class: `key-row${changed ? ' changed' : ''}` },
      h('span', { class: 'key-name' }, d.label),
      h('span', { class: 'key-now' }, k ? h('kbd', {}, keyLabel(k, isMac)) : h('span', { class: 'key-none' }, 'none'),
        changed ? h('span', { class: 'key-default', title: 'Default' }, `default ${keyLabel(defaultOf(d.id), isMac)}`) : null),
      h('span', { class: 'key-btns' },
        h('button', { class: 'btn small', onclick: () => record(d.id) }, 'Change'),
        h('button', { class: 'icon-btn key-reset', title: 'Back to the default', disabled: !changed, onclick: () => set({ [d.id]: defaultOf(d.id) }) }, '↺')));
  };
  function render() {
    const defs = keyDefs().filter((d) => d.scope !== 'global' || desktop);
    const groups = [...new Set(defs.map((d) => d.group))];
    const anyChanged = defs.some((d) => KEYS[d.id] !== defaultOf(d.id));
    box.replaceChildren(
      h('div', { class: 'keys-head' },
        h('span', { class: 'set-detail grow' }, desktop ? 'Saved in the app’s settings file; the menus follow.' : 'Saved in this browser.'),
        h('button', { class: 'btn small', disabled: !anyChanged, onclick: () => set(Object.fromEntries(defs.map((d) => [d.id, defaultOf(d.id)]))) }, 'Reset all')),
      ...groups.map((g) => h('div', { class: 'keys-group' }, h('div', { class: 'keys-group-name' }, g), defs.filter((d) => d.group === g).map(row))));
  }
  render();
  // Closing Settings while recording stops it.
  new MutationObserver((_, mo) => { if (!box.isConnected) { if (recording) stop(); mo.disconnect(); } }).observe($('#overlay'), { childList: true });
  return box;
}

function openSettings({ keys = false } = {}) {
  const overlay = $('#overlay');
  const close = () => { overlay.hidden = true; overlay.replaceChildren(); };
  const st = S.settings;
  const segRow = (key, options) => h('div', { class: 'seg' }, Object.entries(options).map(([value, label]) =>
    h('button', { class: st[key] === value ? 'on' : '', onclick: () => { setSetting(key, value); openSettings(); } }, label)));
  const toggle = (key, label, detail) => h('label', { class: 'set-toggle' },
    h('input', { type: 'checkbox', checked: !!st[key], onchange: (e) => setSetting(key, e.target.checked) }),
    h('span', {}, h('b', {}, label), detail ? h('span', { class: 'set-detail' }, detail) : null));
  const themeSelect = (key, kind) => h('select', { class: 'theme-select', onchange: (e) => { setSetting(key, e.target.value); openSettings(); } },
    allThemes().filter((t) => t.kind === kind).map((t) => h('option', { value: t.id, selected: st[key] === t.id }, t.name)));
  const swatch = (t) => {
    const vars = t.vars;
    const card = h('button', { class: `swatch${st.theme === t.id ? ' on' : ''}`, title: t.name, onclick: () => { setSetting('theme', t.id); openSettings(); } },
      h('span', { class: 'sw-preview' },
        h('span', { class: 'sw-line sw-h' }), h('span', { class: 'sw-line' }), h('span', { class: 'sw-line sw-short' }), h('span', { class: 'sw-dot' })),
      h('span', { class: 'sw-name' }, t.name,
        t.custom ? h('span', { class: 'sw-remove', title: 'Remove this theme', onclick: (e) => { e.stopPropagation(); removeCustomTheme(t.id); } }, '×') : null));
    const pv = card.firstChild;
    if (vars) {
      pv.style.background = vars.bg;
      pv.style.borderColor = vars.border;
      pv.children[0].style.background = vars['syn-heading'];
      pv.children[1].style.background = vars['fg-dim'];
      pv.children[2].style.background = vars['fg-faint'];
      pv.children[3].style.background = vars.accent;
    } else pv.classList.add('sw-system');
    return card;
  };
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  overlay.replaceChildren(h('div', { class: 'dialog settings', tabindex: '-1' },
    h('div', { class: 'dialog-body' },
      h('h2', {}, 'Settings'),
      h('p', { class: 'sub' }, 'Saved on this device. Changes apply immediately.'),
      h('div', { class: 'set-label' }, 'Theme'),
      h('div', { class: 'swatches' }, swatch({ id: 'system', name: 'System' }), allThemes().map(swatch)),
      h('div', { class: 'theme-tools' },
        h('button', { class: 'btn small', onclick: importTheme }, 'Import theme…'),
        h('button', { class: 'btn small', onclick: () => downloadText(`${currentTheme().name}.theme.json`, exportTheme(currentTheme())) }, 'Export current as JSON'),
        h('span', { class: 'set-detail' }, 'Theme files are plain JSON with color values only.')),
      h('div', { class: 'set-grid' },
        h('div', { class: 'set-label' }, 'System uses'), h('div', { class: 'pair-row' },
          h('span', {}, '☾'), themeSelect('systemDark', 'dark'), h('span', {}, '☀'), themeSelect('systemLight', 'light')),
        h('div', { class: 'set-label' }, 'Accent color'), h('div', { class: 'accent-row' },
          h('button', { class: `accent-dot none${!st.accent ? ' on' : ''}`, title: 'Theme default', onclick: () => { setSetting('accent', ''); openSettings(); } }, '∅'),
          ACCENTS.map((c) => { const b = h('button', { class: `accent-dot${st.accent === c ? ' on' : ''}`, title: c, onclick: () => { setSetting('accent', c); openSettings(); } }); b.style.background = c; return b; }),
          h('input', { type: 'color', class: 'accent-custom', title: 'Custom accent', value: st.accent || currentTheme().vars.accent, onchange: (e) => { setSetting('accent', e.target.value); openSettings(); } })),
        h('div', { class: 'set-label' }, 'Pens'), h('div', { class: 'accent-row' },
          ...[['penMe', 'Yours', '--pen-me'], ['penAgent', 'The agent’s', '--pen']].map(([key, label, v]) => h('label', { class: 'pen-pick', title: `${label} pen: suggestions and comments` }, label,
            h('input', { type: 'color', class: 'accent-custom', value: st[key] || getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#000000', onchange: (e) => { setSetting(key, e.target.value); openSettings(); } }),
            st[key] ? h('button', { class: 'accent-dot none', title: 'Theme default', onclick: (e) => { e.preventDefault(); setSetting(key, ''); openSettings(); } }, '∅') : null))),
        h('div', { class: 'set-label' }, 'Editor font'), segRow('font', Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [k, v.label]))),
        h('div', { class: 'set-label' }, 'Text size'), h('div', { class: 'seg' },
          h('button', { onclick: () => { setSetting('fontSize', Math.max(11, st.fontSize - 1)); openSettings(); } }, '−'),
          h('button', { class: 'on', disabled: true }, `${st.fontSize}px`),
          h('button', { onclick: () => { setSetting('fontSize', Math.min(24, st.fontSize + 1)); openSettings(); } }, '+')),
        h('div', { class: 'set-label' }, 'Line spacing'), h('div', { class: 'seg' }, Object.entries(LINE_HEIGHTS).map(([v, label]) =>
          h('button', { class: Number(v) === Number(st.lineHeight) ? 'on' : '', onclick: () => { setSetting('lineHeight', Number(v)); openSettings(); } }, label))),
        h('div', { class: 'set-label' }, 'Line width'), segRow('width', Object.fromEntries(Object.entries(WIDTHS).map(([k, v]) => [k, v[0]])))),
      h('div', { class: 'set-toggles' },
        toggle('autosave', 'Autosave', 'Save shortly after you stop typing. Conflicts with outside edits are never overwritten.'),
        toggle('highlight', 'Markdown syntax colors', 'Color headings, emphasis, links and code while editing.'),
        toggle('spellcheck', 'Spellcheck', 'Uses the system dictionary; nothing is sent anywhere.'),
        toggle('emacsKeys', 'Emacs keys in the editor', isMac
          ? '⌃ and ⌥ keys move, mark, kill and yank as in Emacs, with ⌃X, ⌃U and registers (ESC then a key is ⌥ and the key). ⌥ then no longer types special characters in notes.'
          : 'Ctrl and Alt keys move, mark, kill and yank as in Emacs, with Ctrl+X, Ctrl+U and registers. Ctrl+C, Ctrl+V and Ctrl+Z still copy, paste and undo; Ctrl+X is Emacs’s (cut: Ctrl+W).'),
        toggle('followTab', 'Tree follows the active tab', 'Selecting a tab opens its folders in the file tree and scrolls to it (also ⇅ at the top of the tree). Off: use ◎ in the tree.')),
      h('div', { class: 'set-label' }, 'Labs'),
      h('p', { class: 'set-detail' }, 'Experiments you can turn on and off. They may change or go away.'),
      h('div', { class: 'set-toggles' },
        toggle('labSteadyDraw', 'Steady live drawing', 'While you type in a ```flow block, keep the picture until the line is whole and you pause, so boxes don’t jump at every key.'),
        toggle('labWheelPans', 'Canvas: the wheel moves', 'Scrolling or two fingers move the canvas; pinch or ⌘/Ctrl + wheel zooms. Off: the wheel zooms.')),
      h('div', { class: 'set-label', id: 'set-keys' }, 'Keyboard shortcuts'),
      h('p', { class: 'set-detail' }, `The keys after the leader (${kbd('leader') || '⌥X'}) are yours to change too: in ${LEADER_FILE}, a note in this folder. `,
        h('button', { class: 'btn small', onclick: () => { close(); editLeaderKeys(); } }, 'Edit leader keys'), ' ',
        h('button', { class: 'btn small', onclick: () => { close(); describeCommand(); } }, 'Describe a command…')),
      shortcutsSection()),
    h('div', { class: 'dialog-foot' }, h('div', { class: 'grow' }, 'Tip: type “theme” in the command palette to switch themes from the keyboard.'), h('button', { class: 'btn primary', onclick: close }, 'Done'))));
  overlay.hidden = false;
  overlay.querySelector('.dialog').focus();
  if (keys) $('#set-keys')?.scrollIntoView({ block: 'start' });
}

// ------------------------------------------------------------------ file operations

function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  document.querySelector('.ctx-menu')?.remove();
  const menu = h('div', { class: 'ctx-menu', role: 'menu' }, items.filter(Boolean).map((it) => (it === '-'
    ? h('div', { class: 'ctx-sep' })
    : h('button', { class: `ctx-item${it.danger ? ' danger' : ''}`, onclick: () => { menu.remove(); it.run(); } }, h('span', {}, 'swatch' in it ? swatch(it.swatch) : null, it.label), it.key ? h('span', { class: 'ctx-key' }, it.key) : null))));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - r.height - 6)}px`;
  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  // Esc closes it; an item's `hotkey` runs it.
  document.addEventListener('keydown', function esc(ev) {
    if (!menu.isConnected) { document.removeEventListener('keydown', esc, true); return; }
    const it = items.find((x) => x && x !== '-' && x.hotkey === ev.key);
    if (ev.key !== 'Escape' && !it) return;
    ev.preventDefault();
    ev.stopPropagation();
    menu.remove();
    document.removeEventListener('keydown', esc, true);
    it?.run();
  }, true);
}

// A colour's dot in a menu ([fill, outline], or null: no colour).
function swatch(c) {
  const dot = h('span', { class: `ctx-swatch${c ? '' : ' none'}` });
  if (c) { dot.style.background = c[0]; dot.style.borderColor = c[1]; }
  return dot;
}

function fileMenu(e, f) {
  contextMenu(e, [
    { label: 'Open', run: () => openFile(f.path) },
    f.note ? { label: 'Open to the side', key: `${MOD}click`, run: () => openFile(f.path, { side: true }) } : null,
    f.note ? { label: 'Copy [[link]]', run: () => navigator.clipboard.writeText(`[[${stem(f.path)}]]`).then(() => toast('Link copied')) } : null,
    { label: 'Copy path', run: () => navigator.clipboard.writeText(f.path).then(() => toast('Path copied')) },
    revealItem(f.path),
    { label: isBookmarked(f.path) ? 'Remove bookmark' : 'Bookmark', run: () => toggleBookmark(f.path) },
    { label: 'Dired: its folder as text…', run: () => openDired(dirname(f.path), f.path) },
    '-',
    { label: 'Rename / move…', key: 'F2', run: () => renameItem(f.path) },
    { label: 'Delete', danger: true, run: () => deleteItem(f.path) },
  ]);
}

function folderMenu(e, dir) {
  contextMenu(e, [
    { label: 'New note here…', run: () => newNote(dir) },
    { label: 'New note from template here…', run: () => pickTemplate((t) => newNote(dir, t)) },
    { label: 'New folder here…', run: () => newFolder(dir) },
    { label: 'New drawing here…', run: () => newDrawing(dir) },
    { label: 'New Mermaid diagram here…', run: () => newMermaidFile(dir) },
    revealItem(dir),
    { label: 'Dired: edit as text…', run: () => openDired(dir) },
    '-',
    { label: 'Rename / move…', run: () => renameItem(dir, true) },
    { label: 'Delete folder', danger: true, run: () => deleteItem(dir, true) },
  ]);
}

async function renameItem(p, isDir = false) {
  const to = await askText({
    title: isDir ? 'Rename or move folder' : 'Rename or move note',
    label: 'Path relative to the workspace. Links pointing here are updated automatically.',
    value: isDir || !isNote(p) ? p : p.replace(/\.md$/i, ''),
    okLabel: 'Rename',
  });
  if (!to || to === p) return;
  try {
    const r = await movePath(p, to, isDir);
    await loadTree();
    persist();
    await syncOpenTabs();
    render();
    toast(`Renamed to ${r.to}${r.updated.length ? ` · updated links in ${r.updated.length} note${r.updated.length === 1 ? '' : 's'}` : ''}`);
  } catch (e) { toast(e.message, 'error'); }
}

// A rename or move (the server updates the links to it), and what goes with
// it here: open tabs, recent notes, bookmarks, the way back, open folders.
async function movePath(p, to, isDir) {
  for (const t of S.tabs) if (t.kind === 'file' && (t.path === p || t.path.startsWith(`${p}/`))) await flushAutosave(t);
  for (const t of S.tabs) if (t.kind === 'drawing' && (t.path === p || t.path.startsWith(`${p}/`))) await saveDrawing(t, { flush: true });
  const r = await api('POST', '/api/rename', { from: p, to });
  for (const t of S.tabs) {
    const next = r.moved[t.path];
    if (!isDoc(t) || !next) continue;
    const grp = S.groups[t.group];
    const wasActive = grp?.active === t.id;
    t.path = next;
    t.id = `${t.kind === 'drawing' ? 'd' : 'f'}:${next}`;
    if (wasActive) grp.active = t.id;
  }
  S.recent = S.recent.map((x) => r.moved[x] || x);
  if (S.bookmarks.some((x) => r.moved[x])) { S.bookmarks = S.bookmarks.map((x) => r.moved[x] || x); saveBookmarks(); }
  navRenamed(r.moved);
  if (isDir) for (const d of [...S.expanded]) if (d === r.from || d.startsWith(`${r.from}/`)) { S.expanded.delete(d); S.expanded.add(r.to + d.slice(r.from.length)); }
  return r;
}

async function deleteItem(p, isDir = false) {
  const tab = S.tabs.find((t) => t.kind === 'file' && t.path === p);
  if (tab && tab.content !== tab.saved && !(await askConfirm(`${p} has unsaved changes. Delete anyway?`, { okLabel: 'Delete', danger: true }))) return;
  try {
    const r = await trashPath(p);
    const { marks } = r;
    await loadTree();
    navPrune();
    updateNavButtons();
    toast(`Deleted ${p}${isDir ? '/' : ''}`, '', { label: 'Undo', run: async () => {
      try {
        await api('POST', '/api/restore', { trash: r.trash, path: r.path });
        if (marks.length) { S.bookmarks = [...S.bookmarks, ...marks.filter((b) => !S.bookmarks.includes(b))]; saveBookmarks(); }
        await loadTree();
        if (!isDir && (isNote(r.path) || isDrawing(r.path))) openFile(r.path);
      } catch (e) { toast(e.message, 'error'); }
    } });
  } catch (e) { toast(e.message, 'error'); }
}

// To the trash (it can come back): its tabs close, its bookmarks go with it.
async function trashPath(p) {
  const r = await api('POST', '/api/delete', { path: p });
  const marks = S.bookmarks.filter((b) => b === p || b.startsWith(`${p}/`));
  if (marks.length) { S.bookmarks = S.bookmarks.filter((b) => !marks.includes(b)); saveBookmarks(); }
  for (const t of [...S.tabs]) if (isDoc(t) && (t.path === p || t.path.startsWith(`${p}/`))) { t.saved = t.kind === 'drawing' ? t.text : t.content; t.discard = true; await closeTab(t.id); }
  return { ...r, marks };
}

async function newFolder(base = '') {
  const name = await askText({ title: 'New folder', value: base ? `${base}/` : '', okLabel: 'Create' });
  if (!name || name.endsWith('/')) return;
  try {
    const r = await api('POST', '/api/folder', { path: name });
    S.expanded.add(r.path);
    await loadTree();
  } catch (e) { toast(e.message, 'error'); }
}

function openImage(p) {
  let tab = S.tabs.find((t) => t.kind === 'image' && t.path === p);
  if (!tab) { tab = { id: `i:${p}`, kind: 'image', path: p, group: S.focus }; S.tabs.push(tab); }
  activate(tab.id);
}

// ------------------------------------------------------------------ drawings (Excalidraw)
// The editor itself runs isolated in an iframe (public/drawing.js); here are
// the tab, saving, conflicts and embeds.

const isDarkTheme = () => currentTheme().kind === 'dark';
const escAttr = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMPTY_DRAWING = `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://github.com/kpiljoong/margin', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2)}\n`;

async function openDrawing(path, { focus = true, group, side = false } = {}) {
  let tab = S.tabs.find((t) => t.kind === 'drawing' && t.path === path);
  // Open as text: that tab is saved and closed first (unless the user keeps its edits).
  const asText = !tab && S.tabs.find((t) => t.kind === 'file' && t.path === path);
  if (asText) {
    group ??= asText.group;
    await closeTab(asText.id);
    if (S.tabs.includes(asText)) return;
  }
  const target = side ? ensureSecondGroup() && (S.focus === 1 && S.groups.length > 1 ? 0 : 1) : (group ?? S.focus);
  if (!tab) {
    try {
      const f = await api('GET', `/api/file?path=${encodeURIComponent(path)}`);
      // Obsidian drawings are read-only for now: writing them back must keep the plugin's format.
      const readonly = drawingFormat(path) === 'obsidian';
      tab = { id: `d:${path}`, kind: 'drawing', path, text: f.content, saved: f.content, hash: f.hash, readonly, view: readonly, group: target };
      S.tabs.push(tab);
    } catch (e) { toast(e.message, 'error'); return; }
  } else if (side && tab.group !== target) moveTab(tab, target, false);
  activate(tab.id);
  if (focus) requestAnimationFrame(() => tab.frame?.el.focus());
  for (let d = dirname(path); d; d = dirname(d)) S.expanded.add(d);
  S.recent = [path, ...S.recent.filter((p) => p !== path)].slice(0, 30);
  store.setItem(`an.recent.${S.info?.root}`, JSON.stringify(S.recent));
}

async function newDrawing(folder) {
  const base = folder ?? (activeTab()?.path ? dirname(activeTab().path) : '');
  let name = await askText({ title: 'New drawing', label: 'Path relative to the workspace. “.excalidraw” is added if missing.', value: base ? `${base}/` : '', placeholder: 'folder/Sketch', okLabel: 'Create' });
  if (!name || name.endsWith('/')) return;
  if (!/\.excalidraw$/i.test(name)) name = `${name}.excalidraw`;
  if (S.files.some((f) => f.path === name)) { toast('A file with that name already exists', 'error'); return; }
  try {
    const r = await api('PUT', '/api/file', { path: name, content: EMPTY_DRAWING });
    await loadTree();
    openFile(r.path);
  } catch (e) { toast(e.message, 'error'); }
}

// A .mmd file from a starter diagram, opened with its source beside the picture.
function newMermaidFile(folder) {
  const base = folder ?? (activeTab()?.path ? dirname(activeTab().path) : '');
  picker({
    placeholder: 'New Mermaid diagram — start from…',
    source: (q) => diagramTemplates().map(([name, body]) => ({ name, body, m: fuzzy(q, name) })).filter((x) => x.m).map(({ name, body, m }) => ({
      icon: '◈', label: marked(name, m.idx), hint: '.mmd',
      run: () => setTimeout(async () => {
        let path = await askText({ title: 'New Mermaid diagram', label: 'Path relative to the workspace. “.mmd” is added if missing.', value: base ? `${base}/` : '', placeholder: 'folder/Diagram', okLabel: 'Create' });
        if (!path || path.endsWith('/')) return;
        if (!/\.(mmd|mermaid)$/i.test(path)) path = `${path}.mmd`;
        if (S.files.some((f) => f.path === path)) { toast('A file with that name already exists', 'error'); return; }
        try {
          const r = await api('PUT', '/api/file', { path, content: `${body}\n` });
          await loadTree();
          await openFile(r.path);
          const tab = S.tabs.find((t) => t.kind === 'file' && t.path === r.path);
          if (tab) { tab.mmdMode = 'split'; renderContent(tab.group); }
        } catch (e) { toast(e.message, 'error'); }
      }, 0),
    })),
  });
}

function drawingFrame(tab) {
  if (!tab.frame) {
    tab.frame = new DrawingFrame({
      mode: 'edit', text: tab.text, format: drawingFormat(tab.path), name: stem(tab.path),
      theme: isDarkTheme() ? 'dark' : 'light', view: tab.view, readonly: tab.readonly,
    }, (m) => onDrawingMessage(tab, m));
  }
  return tab.frame;
}

// App shortcuts pressed inside the drawing: the frame passes on a few
// ⌘/Ctrl keys ("shift+p", see FORWARD in the frame); the shortcut now on
// those keys runs. Others reach the app through the desktop menu.
const drawingKey = (combo) => appKeys.get(normalize(`CmdOrCtrl+${combo}`, isMac));

function onDrawingMessage(tab, m) {
  if (m.type === 'change') {
    tab.text = m.text;
    renderTabs();
    scheduleDrawingSave(tab);
  } else if (m.type === 'focus') {
    if (S.focus !== tab.group) focusGroup(tab.group);
  } else if (m.type === 'key') {
    if (m.combo === 'copy-png') copyPicture(drawingPicture(tab));
    else if (ACTIONS[drawingKey(m.combo)]) runCommand(drawingKey(m.combo));
  } else if (m.type === 'link') {
    openDrawingLink(tab, String(m.url || ''));
  } else if (m.type === 'error') {
    if (m.fatal) { tab.fatal = m.message; tab.frame?.destroy(); tab.frame = null; if (activeIn(tab.group) === tab) renderContent(tab.group); }
    else toast(m.message, 'error');
  }
}

// Links on drawing elements: web links open in the browser, [[note]] in the app.
function openDrawingLink(tab, url) {
  const wiki = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(url.trim());
  if (wiki) {
    followLink(wiki[1], tab.path).then((found) => { if (!found) toast(`Not found: ${wiki[1]}`, 'error'); });
  } else if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
}

function scheduleDrawingSave(tab) {
  if (!S.settings.autosave || tab.conflict || tab.readonly) return;
  clearTimeout(tab.autosaveTimer);
  tab.autosaveTimer = setTimeout(() => saveDrawing(tab), 700);
}

// Ask the frame for edits it hasn't sent yet.
async function flushDrawing(tab) {
  if (!tab.frame?.ready || tab.readonly) return;
  try {
    const r = await tab.frame.request({ type: 'flush' }, 3000);
    if (r.text) tab.text = r.text;
  } catch { /* closed or busy: keep what we have */ }
}

async function saveDrawing(tab, { force = false, flush = false } = {}) {
  if (!tab || tab.readonly || !S.tabs.includes(tab)) return;
  if (flush) await flushDrawing(tab);
  clearTimeout(tab.autosaveTimer);
  if (!force && tab.text === tab.saved) return;
  if (tab.saving) { tab.saveAgain = true; return tab.saving; }
  const text = tab.text;
  tab.saving = (async () => {
    try {
      const r = await api('PUT', '/api/file', { path: tab.path, content: text, baseHash: tab.hash, force });
      Object.assign(tab, { hash: r.hash, saved: text, conflict: false, missing: false });
      refreshEmbeds(tab.path);
    } catch (e) {
      if (e.status === 409) { tab.conflict = true; toast('Drawing changed on disk — choose how to resolve it (banner above the drawing).', 'error'); }
      else toast(`Save failed: ${e.message}`, 'error');
    }
  })();
  await tab.saving;
  tab.saving = null;
  renderTabs();
  renderDrawingBanner(tab);
  if (tab.saveAgain) { tab.saveAgain = false; if (tab.text !== tab.saved && !tab.conflict) await saveDrawing(tab); }
}

// The same file in a text tab instead: the drawing tab is saved and closed so
// the two never edit the file at the same time.
async function openDrawingAsText(tab) {
  const { path, group } = tab;
  await closeTab(tab.id);
  if (S.tabs.includes(tab)) return; // kept: unsaved changes
  openFile(path, { text: true, group: S.groups[group] ? group : undefined });
}

async function reloadDrawing(tab) {
  try {
    const f = await api('GET', `/api/file?path=${encodeURIComponent(tab.path)}`);
    Object.assign(tab, { text: f.content, saved: f.content, hash: f.hash, conflict: false, missing: false });
    tab.frame?.post({ type: 'load', text: f.content });
  } catch (e) { toast(e.message, 'error'); }
  renderTabs();
  renderDrawingBanner(tab);
}

function renderDrawingBanner(tab) {
  const slot = tab.bannerEl;
  if (!slot?.isConnected) return;
  const before = slot.childElementCount;
  if (tab.missing) {
    slot.replaceChildren(h('div', { class: 'banner' }, h('span', { class: 'grow' }, 'This drawing no longer exists on disk. Saving will recreate it.')));
  } else if (tab.conflict) {
    slot.replaceChildren(h('div', { class: 'banner' },
      h('span', { class: 'grow' }, 'This drawing changed on disk while you had unsaved edits.'),
      h('button', { class: 'btn small', onclick: () => reloadDrawing(tab) }, 'Load disk version'),
      h('button', { class: 'btn small danger', onclick: () => saveDrawing(tab, { force: true, flush: true }) }, 'Keep mine & overwrite')));
  } else slot.replaceChildren();
  if (before !== slot.childElementCount) placeFramesSoon();
}

function drawingView(tab, c) {
  const toolbar = h('div', { class: 'toolbar' },
    ...navButtons(),
    h('span', { class: 'crumbs' }, tab.path.split('/').join('  ›  ')),
    tab.readonly
      ? h('span', { class: 'badge', title: 'Drawings from Obsidian (.excalidraw.md) open read-only for now' }, 'Read-only')
      : h('div', { class: 'seg' }, ...[['edit', 'Edit'], ['view', 'View']].map(([m, label]) =>
        h('button', { class: (tab.view ? 'view' : 'edit') === m ? 'on' : '', title: m === 'view' ? 'Look without changing anything' : 'Draw and edit', onclick: () => {
          tab.view = m === 'view';
          tab.frame?.post({ type: 'view', view: tab.view });
          renderContent(tab.group);
        } }, label))),
    h('button', { class: 'icon-btn', title: 'Copy as image (PNG) — the selection, or the whole drawing (⇧⌥C)', onclick: () => copyPicture(drawingPicture(tab)) }, '⧉'),
    h('button', { class: 'icon-btn', title: S.groups.length > 1 ? 'Move to the other pane' : withKey('Open to the side', 'split'), onclick: () => (S.groups.length > 1 ? moveTab(tab, tab.group === 0 ? 1 : 0) : splitRight()) }, '◫'),
    h('button', { class: 'icon-btn', title: 'More actions', onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); contextMenu({ preventDefault() {}, stopPropagation() {}, clientX: r.right - 200, clientY: r.bottom + 4 }, [
      { label: 'Copy as PNG', key: '⇧⌥C', run: () => copyPicture(drawingPicture(tab)) },
      { label: 'Copy as SVG', run: () => copyPicture(drawingPicture(tab), 'svg') },
      { label: 'Save as PNG…', run: () => savePicture(drawingPicture(tab)) },
      { label: 'Save as SVG…', run: () => savePicture(drawingPicture(tab), 'svg') },
      '-',
      { label: 'Copy embed ![[…]]', run: () => navigator.clipboard.writeText(`![[${basename(tab.path)}]]`).then(() => toast('Embed copied — paste it into a note')) },
      { label: tab.readonly ? 'Open as Markdown' : 'Open as text (JSON)', run: () => openDrawingAsText(tab) },
      revealItem(tab.path),
      '-',
      { label: 'Rename / move…', run: () => renameItem(tab.path) },
      { label: 'Delete drawing', danger: true, run: () => deleteItem(tab.path) },
    ]); } }, '⋯'));
  const banner = h('div', { class: 'banner-slot' });
  tab.bannerEl = banner;
  if (tab.slot) slotObserver.unobserve(tab.slot);
  if (tab.fatal) {
    tab.slot = null;
    c.replaceChildren(toolbar, banner, h('div', { class: 'drawing-error' },
      h('p', {}, `This drawing can’t be shown: ${tab.fatal}`),
      h('button', { class: 'btn', onclick: () => openDrawingAsText(tab) }, 'Open as text')));
    return;
  }
  tab.slot = h('div', { class: 'drawing-slot' });
  c.replaceChildren(toolbar, banner, tab.slot);
  slotObserver.observe(tab.slot);
  drawingFrame(tab);
  renderDrawingBanner(tab);
}

// Frames sit in a fixed layer above the panes (moving an iframe reloads it).
const slotObserver = new ResizeObserver(() => placeFrames());
function placeFrames() {
  for (const t of S.tabs) if (t.kind === 'drawing' && t.frame) t.frame.place(activeIn(t.group) === t ? t.slot : null);
}
let placeQueued = false;
function placeFramesSoon() {
  if (placeQueued) return;
  placeQueued = true;
  requestAnimationFrame(() => { placeQueued = false; placeFrames(); });
}

// ![[…]] in a note: a drawing or a Mermaid file, shown as a picture (click to open).
function fileEmbed(target, label, fromPath) {
  const rel = resolveLink(target, fromPath);
  // A note (or a section of one), but not in a note already shown inside
  // another, nor in itself.
  if (rel && isNote(rel)) return noteEmbedDepth || rel === fromPath ? null : noteEmbed(rel, target);
  if (rel && isMermaidFile(rel)) return mermaidEmbed(rel, label || target);
  if (rel && isDrawing(rel)) return drawingEmbed(rel, label, target);
  // ![[shot.png]]: the picture, as ![](shot.png) shows it.
  if (rel && IMAGE_FILE.test(rel)) return `<img src="${escAttr(`/api/raw?path=${encodeURIComponent(rel)}&t=${token}`)}" alt="${escAttr(label || stem(rel))}">`;
  return null;
}

// ![[Note]] / ![[Note#Section]]: the note, or that section, shown in place.
// A placeholder first; fillNoteEmbeds puts the text in — at once when it is
// known (open, or read before), so typing doesn't make it flicker.
const noteSources = new Map();
let noteEmbedDepth = 0;
const noteEmbed = (rel, target) => `<span class="note-embed loading" data-path="${escAttr(rel)}" data-target="${escAttr(target)}">↳ ${escAttr(target)}…</span>`;

function fillNoteEmbeds(root) {
  const waits = [];
  for (const el of [...root.querySelectorAll('.note-embed.loading')]) {
    const path = el.dataset.path;
    const src = S.tabs.find((t) => t.kind === 'file' && t.path === path && t.content != null)?.content ?? noteSources.get(path);
    if (src != null) { fillNoteEmbed(el, src); continue; }
    waits.push(api('GET', `/api/file?path=${encodeURIComponent(path)}`)
      .then((f) => { noteSources.set(path, f.content); fillNoteEmbed(el, f.content); })
      .catch((e) => { el.textContent = `↳ ${el.dataset.target}: ${e.message}`; el.classList.replace('loading', 'error'); }));
  }
  return Promise.all(waits);
}

function fillNoteEmbed(el, src) {
  const path = el.dataset.path;
  const { heading } = splitLink(el.dataset.target);
  const part = linkSection(src, heading);
  const body = h('div', { class: 'note-embed-body' });
  if (!part) body.append(h('div', { class: 'empty' }, `No section “${heading}”.`));
  else {
    noteEmbedDepth++;
    try { body.innerHTML = renderMarkdown(part.text, { image: (url) => localImage(url, path), embed: (t, l) => fileEmbed(t, l, path) }); } finally { noteEmbedDepth--; }
    // Its lines, heading ids and checkboxes belong to the other note.
    body.querySelectorAll('[data-line]').forEach((x) => x.removeAttribute('data-line'));
    body.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    body.querySelectorAll('input.task').forEach((x) => { x.disabled = true; });
  }
  const box = h('div', { class: 'note-embed', 'data-path': path, 'data-target': el.dataset.target },
    h('div', { class: 'note-embed-head', title: `Open ${path}` }, `↳ ${stem(path)}${heading ? ` › ${heading}` : ''}`), body);
  // On a line of its own it comes wrapped in a paragraph: take its place.
  const p = el.parentElement;
  const alone = p?.tagName === 'P' && p.childNodes.length === 1;
  if (alone && p.dataset.line) box.dataset.line = p.dataset.line;
  (alone ? p : el).replaceWith(box);
}

// Diagram sources by path, so a note re-renders its embeds without waiting.
const mmdSources = new Map();
function mermaidEmbed(rel, label) {
  const attrs = `data-path="${escAttr(rel)}" data-label="${escAttr(label)}" title="${escAttr(rel)} — click to open"`;
  const src = mmdSources.get(rel);
  return src != null
    ? `<pre class="mmd-embed" data-lang="mermaid" ${attrs}>${escAttr(src)}</pre>`
    : `<div class="mmd-embed loading" ${attrs}>◈ ${escAttr(basename(rel))}…</div>`;
}
async function fillMermaidEmbeds(root) {
  for (const el of [...root.querySelectorAll('.mmd-embed.loading')]) {
    const p = el.dataset.path;
    try {
      if (!mmdSources.has(p)) mmdSources.set(p, (await api('GET', `/api/file?path=${encodeURIComponent(p)}`)).content);
      const pre = h('pre', { class: 'mmd-embed', 'data-lang': 'mermaid', 'data-path': p, 'data-label': el.dataset.label, title: el.title });
      pre.textContent = mmdSources.get(p);
      el.replaceWith(pre);
    } catch (e) { el.textContent = `◈ ${p}: ${e.message}`; el.classList.replace('loading', 'error'); }
  }
}

function drawingEmbed(rel, label, target) {
  const cached = cachedEmbed(rel, isDarkTheme());
  const title = `${escAttr(rel)} — click to open`;
  return cached
    ? `<span class="drawing-embed ready" data-path="${escAttr(rel)}" title="${title}"><img src="${escAttr(cached)}" alt="${escAttr(label || target)}"></span>`
    : `<span class="drawing-embed" data-path="${escAttr(rel)}" data-label="${escAttr(label || target)}" title="${title}">◇ ${escAttr(basename(rel))}…</span>`;
}

const fillDrawingEmbeds = (el) => renderDrawingEmbeds(el, { readFile: (path) => api('GET', `/api/file?path=${encodeURIComponent(path)}`), dark: isDarkTheme() });

// ---- pictures: copy, save as a file, view larger

// A picture is what these act on: svg() → SVG text, png() → PNG Blob,
// from → the file it belongs to (saved images go to assets/ next to it),
// name → the saved file's name, what() → how the toast calls it.
const readWorkspaceFile = (path) => api('GET', `/api/file?path=${encodeURIComponent(path)}`);
const themeBackground = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();

// A rendered diagram (an SVG <img>). PNG is 3×, on the theme's background so
// light lines stay readable when pasted.
function diagramPicture(img, from, name) {
  return {
    from, name, url: img.src,
    svg: async () => { const svg = svgFromDataUrl(img.src); if (!svg) throw new Error('not an SVG image'); return svg; },
    png: () => imageToPng(img.src, { scale: 3, background: themeBackground() }),
  };
}

// A picture with its ```ink marks drawn on, at its own size: an SVG holding
// the picture and the marks, and a PNG made from it. from: the note (where
// Save puts it, in assets/).
function inkPicture(fig, from) {
  const img = fig.querySelector(':scope > img');
  const m = /[?&]path=([^&]+)/.exec(img?.getAttribute('src') || '');
  const file = m ? decodeURIComponent(m[1]) : '';
  let made = null;
  const svg = () => (made ||= (async () => {
    if (!img?.naturalWidth) throw new Error('the picture isn’t loaded');
    // A sketch's page is a data: URL already (which the page may not fetch).
    const data = img.src.startsWith('data:') ? img.src : await blobDataUrl(await (await fetch(img.src)).blob());
    const w = img.naturalWidth;
    const hh = img.naturalHeight;
    const marks = fig.querySelector(':scope > .ink-marks')?.cloneNode(true);
    marks?.querySelectorAll('.ink-hit, .ink-draft').forEach((x) => x.remove());
    const body = marks ? new XMLSerializer().serializeToString(marks).replace(/^<svg[^>]*>|<\/svg>$/g, '') : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}"><image href="${data}" width="${w}" height="${hh}"/>${body}</svg>`;
  })());
  return {
    from, name: fig.dataset.board != null ? `${stem(from)}-sketch` : `${stem(file || from)}-marked`, what: () => 'the picture with its marks',
    svg,
    png: async () => imageToPng(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(await svg())}`, { scale: 1 }),
  };
}

const blobDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// What an agent is shared of pictures with hidden parts (```ink `hide`
// lines, the scope's `hidden`: path → [[x, y, w, h]]): copies with those
// parts covered, base64 by path. One that can't be covered (a GIF, a
// picture that won't load) gets none, and the server withholds it.
async function maskedPictures(hidden = {}) {
  const out = {};
  let total = 0;
  for (const [p, rects] of Object.entries(hidden)) {
    let data = null;
    try { data = await coverPicture(p, rects); } catch { /* withheld */ }
    if (data && (total += data.length) < 30 * 1024 * 1024) out[p] = data;
  }
  return out;
}

const PICTURE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const coverable = (p) => /\.svg$/i.test(p) || !!PICTURE_TYPES[(/\.[^./]+$/.exec(p.toLowerCase()) || [''])[0]];

async function coverPicture(p, rects) {
  const url = `/api/raw?path=${encodeURIComponent(p)}&t=${token}`;
  const img = new Image();
  img.src = url;
  await img.decode();
  const w = img.naturalWidth;
  const ht = img.naturalHeight;
  const fill = COLORS.gray[1];
  if (/\.svg$/i.test(p)) {
    // The marks' pixels → the SVG's own units, on top of everything in it.
    const doc = new DOMParser().parseFromString(await (await fetch(url)).text(), 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.localName !== 'svg' || doc.querySelector('parsererror')) return null;
    const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const [vx, vy, vw, vh] = box.length === 4 && box.every(Number.isFinite) ? box : [0, 0, w, ht];
    if (Math.abs(vw / vh - w / ht) > 0.01) return null; // scaled unevenly: can't be sure where
    const ns = 'http://www.w3.org/2000/svg';
    for (const [x, y, rw, rh] of rects) {
      const r = doc.createElementNS(ns, 'rect');
      for (const [k, v] of Object.entries({ x: vx + x * vw / w, y: vy + y * vh / ht, width: rw * vw / w, height: rh * vh / ht, fill })) r.setAttribute(k, v);
      svg.append(r);
    }
    return (await blobDataUrl(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }))).split(',')[1];
  }
  const type = PICTURE_TYPES[(/\.[^./]+$/.exec(p.toLowerCase()) || [''])[0]];
  if (!type) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = ht;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = fill;
  for (const [x, y, rw, rh] of rects) ctx.fillRect(x, y, rw, rh);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
  return blob && blob.type === type ? (await blobDataUrl(blob)).split(',')[1] : null;
}

// An embedded drawing, in its own colours like a copy made in the drawing.
function drawingFilePicture(path) {
  let url = null;
  const get = () => (url ||= drawingImageUrl(path, { readFile: readWorkspaceFile }));
  return { from: path, name: stem(path), svg: async () => svgFromDataUrl(await get()), png: async () => imageToPng(await get(), { scale: 2 }) };
}

// The selection in an open drawing (or all of it).
function drawingPicture(tab) {
  let last = null;
  const ask = (format) => tab.frame.request({ type: 'export', format }).then((r) => (last = r));
  return {
    from: tab.path,
    name: () => (last?.selection ? `${stem(tab.path)}-selection` : stem(tab.path)),
    what: () => (last?.selection ? `${last.count} selected element${last.count > 1 ? 's' : ''}` : 'the drawing'),
    svg: () => ask('svg').then((r) => r.svg),
    png: () => ask('png').then((r) => r.blob),
  };
}

// A .mmd file's diagram, even when only its source is on screen.
async function mermaidFilePicture(tab) {
  const box = h('div', {}, h('pre', { 'data-lang': 'mermaid' }, tab.content));
  await renderDiagrams(box);
  const img = box.querySelector('pre.diagram img');
  if (!img) throw new Error('fix the diagram first — it has errors');
  return diagramPicture(img, tab.path, stem(tab.path));
}

// pic: a picture or a promise of one. The PNG goes to the clipboard as a
// promise so the click that asked for it still counts while it is made.
async function copyPicture(pic, format = 'png') {
  try {
    const ready = Promise.resolve(pic);
    if (format === 'svg') await copySvg(await (await ready).svg());
    else await copyPng(ready.then((p) => p.png()));
    const p = await ready;
    toast(p.what ? `Copied ${p.what()} as ${format.toUpperCase()}` : format === 'svg' ? 'Copied as SVG' : 'Copied as image');
  } catch (e) { toast(`Could not copy: ${e.message}`, 'error'); }
}

const blobBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// Save into assets/ next to the picture's file (a new name if taken).
async function savePicture(pic, format = 'png') {
  try {
    const p = await pic;
    const blob = format === 'svg' ? new Blob([await p.svg()], { type: 'image/svg+xml' }) : await p.png();
    const name = typeof p.name === 'function' ? p.name() : p.name;
    const r = await api('POST', '/api/asset', { note: p.from, name: `${name}.${format}`, data: await blobBase64(blob) });
    loadTree();
    toast(`Saved ${r.workspacePath}`, '', { label: 'Open', run: () => openFile(r.workspacePath) });
  } catch (e) { toast(`Could not save: ${e.message}`, 'error'); }
}

// An image from a note, fitted to the window but never enlarged past its own
// size; 100% (or a double-click) for every pixel.
function viewImage(img) {
  const m = /[?&]path=([^&]+)/.exec(img.getAttribute('src') || '');
  const path = m ? decodeURIComponent(m[1]) : '';
  const v = openViewer({ src: img.currentSrc || img.src, title: img.alt || basename(path) || 'Image', maxFit: 1,
    actions: path ? [{ label: 'Open', title: `Open ${path}`, run: () => { v.close(); openImage(path); } }] : [] });
}

function viewPicture(pic, title) {
  Promise.resolve(pic).then(async (p) => {
    const src = p.url || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await p.svg())}`;
    openViewer({ src, title, actions: [
      { label: 'Copy', title: 'Copy as image (PNG)', run: () => copyPicture(p) },
      { label: 'Save', title: `Save as PNG in ${dirname(p.from) ? `${dirname(p.from)}/` : ''}assets/`, run: () => savePicture(p) },
    ] });
  }).catch((e) => toast(e.message, 'error'));
}

// Menu items for a picture: copy, save, and (optionally) view larger.
const pictureItems = (pic, { view } = {}) => [
  view ? { label: 'View larger', run: view } : null,
  view ? '-' : null,
  { label: 'Copy as image (PNG)', run: () => copyPicture(pic()) },
  { label: 'Copy as SVG', run: () => copyPicture(pic(), 'svg') },
  { label: 'Save as PNG…', run: () => savePicture(pic()) },
  { label: 'Save as SVG…', run: () => savePicture(pic(), 'svg') },
];

// The diagram or embedded drawing under an element in a preview.
function previewPicture(target) {
  const fig = target.closest?.('.ink-figure');
  if (fig && (target.closest('.diagram-copy') || !target.closest('.canvas-card'))) {
    const tab = S.tabs.find((t) => t.previewEl?.contains(fig) || t.canvas?.el.contains(fig)) || fileTab();
    const img = fig.querySelector(':scope > img');
    return img && { box: fig, path: null, title: img.alt || 'Picture', pic: () => inkPicture(fig, tab?.path || '') };
  }
  const box = target.closest?.('pre.diagram, .drawing-embed.ready');
  const img = box?.querySelector('img');
  if (!img) return null;
  const tab = S.tabs.find((t) => t.previewEl?.contains(box));
  const path = box.dataset.path;
  if (box.classList.contains('drawing-embed')) return { box, path, title: basename(path), pic: () => drawingFilePicture(path) };
  const from = path || tab?.path || '';
  const name = path || (tab && isMermaidFile(tab.path)) ? stem(from) : `${stem(from)}-diagram`;
  return { box, path, title: basename(path || from), pic: () => diagramPicture(img, from, name) };
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.diagram-copy');
  if (btn) {
    e.preventDefault();
    e.stopPropagation();
    const found = previewPicture(btn);
    if (found) copyPicture(found.pic());
    return;
  }
  // A click on a diagram (not an embed, which opens its file) shows it larger.
  const img = e.target.closest?.('.md pre.diagram:not(.mmd-embed) > img');
  if (!img || e.button !== 0) return;
  const found = previewPicture(img);
  if (found) { e.preventDefault(); e.stopPropagation(); viewPicture(found.pic(), found.title); }
}, true);
// A numbered dot on a picture and its list item in the text (ink.js
// linkCallouts): pointing at one lights the other; a click on the dot shows
// its item.
function hotCallout(fig, num) {
  document.querySelectorAll('.ink-mark.ink-hot, li.callout-hot').forEach((x) => x.classList.remove('ink-hot', 'callout-hot'));
  if (!fig || num == null) return;
  for (const g of fig.querySelectorAll(':scope > .ink-marks > .ink-mark[data-num]')) if (g.dataset.num === num) g.classList.add('ink-hot');
  fig.callouts?.get(num)?.classList.add('callout-hot');
}
document.addEventListener('pointerover', (e) => {
  const dot = e.target.closest?.('.md .ink-mark[data-num]');
  const li = dot ? null : e.target.closest?.('li[data-callout]');
  const hot = !!document.querySelector('.ink-mark.ink-hot, li.callout-hot');
  if (dot || li?.calloutFig?.isConnected) hotCallout(dot?.closest('.ink-figure') || li.calloutFig, dot?.dataset.num ?? li.dataset.callout);
  else if (hot) hotCallout(null);
});
document.addEventListener('click', (e) => {
  const dot = e.target.closest?.('.md .ink-mark[data-num]');
  const li = dot && !dot.closest('.canvas-stage, .pen-doc') && dot.closest('.ink-figure')?.callouts?.get(dot.dataset.num);
  if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});

document.addEventListener('contextmenu', (e) => {
  const found = previewPicture(e.target);
  if (!found) return;
  const { path } = found;
  const flow = found.box.matches('pre[data-lang="flow" i]') ? found.box : null;
  contextMenu(e, [
    ...pictureItems(found.pic, { view: () => viewPicture(found.pic(), found.title) }),
    flow ? '-' : null,
    flow ? { label: 'Copy as Mermaid code', run: () => navigator.clipboard.writeText(flowToMermaid(flow.dataset.source)).then(() => toast('Mermaid code copied')) } : null,
    flow ? { label: 'Convert to a ```mermaid block', run: () => convertFlow(flow) } : null,
    path ? '-' : null,
    path ? { label: `Open ${basename(path)}`, run: () => openFile(path) } : null,
  ]);
});

// The whole note as Markdown for places that show ```mermaid but don't know
// ```flow (GitHub, GitLab, …): each flow block written as Mermaid.
function copyWithMermaid(tab = fileTab()) {
  if (!tab || !isNote(tab.path)) { toast('Open a note first'); return; }
  const { md, converted, failed } = flowsAsMermaid(tab.content);
  const kept = failed ? ` · ${failed} left as written (nothing to draw)` : '';
  navigator.clipboard.writeText(md)
    .then(() => toast(converted ? `Note copied with ${converted} flow ${converted === 1 ? 'block' : 'blocks'} as Mermaid${kept}` : `Note copied (no flow blocks to convert)${kept}`))
    .catch((e) => toast(`Could not copy: ${e.message}`, 'error'));
}

// Replace a ```flow block in the note with the Mermaid it stands for (for
// places that show ```mermaid but don't know this notation, like GitHub).
function convertFlow(pre) {
  const tab = S.tabs.find((t) => t.previewEl?.contains(pre));
  if (!tab?.editor) return;
  const lines = tab.content.split('\n');
  const at = Number(pre.dataset.line);
  const fence = /^(\s*)(`{3,}|~{3,})\s*flow\s*$/i.exec(lines[at] || '');
  if (!fence) { toast('Could not find this block in the note — edit it by hand.', 'error'); return; }
  let end = at + 1;
  while (end < lines.length && !lines[end].trim().startsWith(fence[2])) end++;
  let code;
  try { code = flowToMermaid(lines.slice(at + 1, end).join('\n')); } catch (e) { toast(e.message, 'error'); return; }
  const from = lines.slice(0, at).reduce((n, l) => n + l.length + 1, 0);
  const to = lines.slice(0, Math.min(end + 1, lines.length)).reduce((n, l) => n + l.length + 1, 0) - 1;
  tab.editor.replace(from, Math.min(to, tab.content.length), `${fence[1]}${fence[2]}mermaid\n${code}\n${fence[1]}${fence[2]}`);
  toast('Converted to Mermaid');
}

// A drawing, diagram or note changed: redraw the notes that show it.
function refreshEmbeds(path) {
  forgetEmbed(path);
  mmdSources.delete(path);
  noteSources.delete(path);
  for (const t of S.tabs) {
    if (t.kind === 'file' && t.previewEl?.isConnected && [...t.previewEl.querySelectorAll('.drawing-embed, .mmd-embed, .note-embed')].some((el) => el.dataset.path === path)) renderPreview(t);
  }
}

// ------------------------------------------------------------------ git

async function loadGit() {
  try { S.git = await api('GET', '/api/git/status'); } catch { S.git = { repo: false }; }
  S.gitMap = new Map((S.git.files || []).map((f) => [f.path, f.code]));
  if (S.view === 'git' || S.view === 'files') renderSidebar();
  const badge = $('#git-badge');
  if (badge) { badge.hidden = !S.git.files?.length; badge.textContent = S.git.files?.length > 99 ? '99+' : String(S.git.files?.length || ''); }
}
const loadGitSoon = debounce(loadGit, 400);

function gitPanel() {
  const g = S.git || { repo: false };
  const out = [h('div', { class: 'panel-head' }, h('span', { class: 'title' }, 'Git'),
    g.repo ? h('span', { class: 'git-branch', title: 'Current branch' }, `⎇ ${g.branch}`) : null,
    h('button', { class: 'icon-btn', title: 'Refresh', onclick: loadGit }, '↻'))];
  const body = h('div', { class: 'panel-body' });
  if (!g.repo) {
    body.append(h('div', { class: 'agent-card' },
      h('p', {}, 'This folder is not a git repository. Git keeps a full history of your notes locally — commits never leave this machine unless you push them yourself.'),
      h('button', { class: 'btn primary small', onclick: async () => {
        try { await api('POST', '/api/git/init'); toast('Initialized a git repository'); await loadGit(); } catch (e) { toast(e.message, 'error'); }
      } }, 'Initialize repository')));
    out.push(body);
    return out;
  }
  S.gitSel ||= new Set();
  const files = g.files || [];
  for (const p of [...S.gitSel]) if (!files.some((f) => f.path === p)) S.gitSel.delete(p);
  const msg = h('textarea', { class: 'git-msg', placeholder: `Commit message (${MOD}↵ to commit)`, value: S.gitMsg || '', rows: 3,
    oninput: (e) => { S.gitMsg = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitNow(); } } });
  const chosen = () => (S.gitSel.size ? [...S.gitSel] : files.map((f) => f.path));
  const commitNow = async () => {
    const message = msg.value.trim() || defaultCommitMessage(chosen());
    try {
      const r = await api('POST', '/api/git/commit', { message, paths: S.gitSel.size ? [...S.gitSel] : undefined });
      S.gitMsg = '';
      S.gitSel.clear();
      toast(`Committed ${r.hash}`);
      await loadGit();
    } catch (e) { toast(e.message, 'error'); }
  };
  body.append(h('div', { class: 'git-commit' }, msg,
    h('button', { class: 'btn primary small', disabled: !files.length, onclick: commitNow },
      files.length ? `Commit ${S.gitSel.size || files.length} file${(S.gitSel.size || files.length) === 1 ? '' : 's'}` : 'No changes')));
  body.append(h('div', { class: 'section-label' }, `Changes (${files.length})`));
  if (!files.length) body.append(h('div', { class: 'empty' }, 'Working tree clean.'));
  for (const f of files) {
    body.append(h('div', { class: 'git-row', title: f.path },
      h('input', { type: 'checkbox', checked: S.gitSel.has(f.path), title: 'Commit only selected files', onchange: (e) => { e.target.checked ? S.gitSel.add(f.path) : S.gitSel.delete(f.path); renderSidebar(); } }),
      h('span', { class: `git-code gc-${f.code}` }, f.code),
      h('span', { class: 'git-path', onclick: () => openGitDiff(f.path) }, f.path)));
  }
  body.append(h('div', { class: 'section-label' }, 'Recent commits'));
  const hist = h('div', { class: 'git-history' }, h('div', { class: 'empty' }, '…'));
  body.append(hist);
  api('GET', '/api/git/log?limit=15').then((r) => {
    hist.replaceChildren(...(r.commits.length ? r.commits.map((c) => h('div', { class: 'git-commit-row', title: `${c.hash.slice(0, 7)} · ${c.author} · ${new Date(c.date).toLocaleString()}` },
      c.agent ? h('span', { class: 'git-agent', title: 'Authored by an agent' }, '✦') : null,
      h('span', { class: 'git-subject' }, c.subject), h('span', { class: 'git-when' }, timeAgo(c.date))))
      : [h('div', { class: 'empty' }, 'No commits yet.')]));
  }).catch(() => hist.replaceChildren());
  out.push(body);
  return out;
}

function defaultCommitMessage(paths) {
  if (paths.length === 1) return `Update ${stem(paths[0])}`;
  return `Update ${paths.length} notes`;
}

function openGitDiff(p) {
  let tab = S.tabs.find((t) => t.kind === 'gitdiff' && t.path === p);
  if (!tab) { tab = { id: `g:${p}`, kind: 'gitdiff', path: p, group: S.focus }; S.tabs.push(tab); }
  tab.data = null;
  activate(tab.id);
  api('GET', `/api/git/diff?path=${encodeURIComponent(p)}`).then((d) => { tab.data = d; renderContent(tab.group); }).catch((e) => toast(e.message, 'error'));
}

function openHistory(p) {
  let tab = S.tabs.find((t) => t.kind === 'history' && t.path === p);
  if (!tab) { tab = { id: `h:${p}`, kind: 'history', path: p, group: S.focus, commits: null, sel: 0, version: null }; S.tabs.push(tab); }
  activate(tab.id);
  // Commits, and the versions Margin kept itself (server.js, local history).
  Promise.all([
    api('GET', `/api/git/log?path=${encodeURIComponent(p)}`).catch(() => ({ repo: false, commits: [] })),
    api('GET', `/api/history?path=${encodeURIComponent(p)}`),
  ]).then(([g, l]) => {
    const kept = l.versions.map((v) => ({ local: true, id: v.id, date: new Date(v.date).toISOString(), subject: KEPT_BECAUSE[v.reason] || 'Kept' }));
    tab.commits = [...g.commits, ...kept].sort((a, b) => new Date(b.date) - new Date(a.date));
    tab.repo = g.repo;
    renderContent(tab.group);
    if (tab.commits.length) selectVersion(tab, 0);
  }).catch((e) => toast(e.message, 'error'));
}
const KEPT_BECAUSE = { save: 'Before later edits', outside: 'Before a change from another program', agent: 'Before agent changes were applied', links: 'Before links were updated', restore: 'Before restoring an earlier version' };

async function selectVersion(tab, i) {
  tab.sel = i;
  const c = tab.commits[i];
  try {
    const [old, cur] = await Promise.all([
      c.local ? api('GET', `/api/history/version?path=${encodeURIComponent(tab.path)}&id=${c.id}`) : api('GET', `/api/git/show?rev=${c.hash}&path=${encodeURIComponent(c.gitPath)}`),
      api('GET', `/api/file?path=${encodeURIComponent(tab.path)}`).catch(() => ({ content: '' })),
    ]);
    tab.version = { commit: c, content: old.content, hunks: lineHunks(old.content, cur.content) };
  } catch (e) { tab.version = { commit: c, error: e.message }; }
  renderContent(tab.group);
}

// Client-side line diff (same shape as the server's hunks) for history views.
function lineHunks(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const x = A.slice(pre, A.length - suf);
  const y = B.slice(pre, B.length - suf);
  if (!x.length && !y.length) return [];
  if (x.length * y.length > 4e6) return [{ baseStart: pre, baseEnd: pre + x.length, removed: x, added: y, before: A.slice(Math.max(0, pre - 3), pre), after: A.slice(pre + x.length, pre + x.length + 3) }];
  const w = y.length + 1;
  const dp = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const hunks = [];
  let i = 0; let j = 0; let cur = null;
  const flush = () => { if (cur) { cur.baseEnd = pre + i; cur.after = A.slice(cur.baseEnd, cur.baseEnd + 3); hunks.push(cur); cur = null; } };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { flush(); i++; j++; continue; }
    cur ||= { baseStart: pre + i, removed: [], added: [], before: A.slice(Math.max(0, pre + i - 3), pre + i) };
    if (j >= y.length || (i < x.length && dp[(i + 1) * w + j] >= dp[i * w + j + 1])) cur.removed.push(x[i++]);
    else cur.added.push(y[j++]);
  }
  flush();
  return hunks;
}

function staticHunk(hk) {
  const rows = [];
  let ln = hk.baseStart - hk.before.length + 1;
  for (const l of hk.before) rows.push(diffLine('ctx', ln++, ' ', l));
  const paired = hk.removed.length === hk.added.length && hk.removed.length <= 20;
  hk.removed.forEach((l, k) => { const wd = paired ? wordDiff(l, hk.added[k]) : null; rows.push(diffLine('del', ln++, '−', wd ? wd[0] : l)); });
  hk.added.forEach((l, k) => { const wd = paired ? wordDiff(hk.removed[k], l) : null; rows.push(diffLine('add', '', '+', wd ? wd[1] : l)); });
  for (const l of hk.after) rows.push(diffLine('ctx', ln++, ' ', l));
  return h('div', { class: 'hunk' }, h('div', { class: 'hunk-head static' }, `line ${hk.baseStart + 1} · −${hk.removed.length} +${hk.added.length}`), h('div', { class: 'diff' }, rows));
}

function gitDiffView(tab) {
  const d = tab.data;
  const wrap = h('div', { class: 'review' });
  wrap.append(h('div', { class: 'review-head' }, h('span', { class: 'badge st-modified' }, 'working tree vs last commit'), h('div', { class: 'task' }, tab.path)));
  if (!d) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  wrap.append(h('div', { class: 'review-actions' },
    h('span', { class: 'grow' }, d.status === 'unchanged' ? 'No changes since the last commit.' : `${d.status}${d.hunks ? ` · ${d.hunks.length} change${d.hunks.length === 1 ? '' : 's'}` : ''}`),
    d.status !== 'deleted' ? h('button', { class: 'btn', onclick: () => openFile(tab.path) }, 'Open note') : null,
    h('button', { class: 'btn', onclick: () => openHistory(tab.path) }, 'History'),
    d.status === 'modified' ? h('button', { class: 'btn danger', onclick: () => restoreVersion(tab.path, 'HEAD') }, 'Discard changes…') : null));
  const card = h('div', { class: 'file-card' }, h('div', { class: 'file-card-head' }, h('span', { class: `badge st-${d.status}` }, d.status), h('span', { class: 'path' }, tab.path)));
  if (d.hunks) card.append(...d.hunks.map(staticHunk));
  else if (d.lines) card.append(h('div', { class: 'diff' }, d.lines.map((l, i) => diffLine(d.status === 'added' ? 'add' : 'del', i + 1, d.status === 'added' ? '+' : '−', l))));
  wrap.append(card);
  return wrap;
}

function historyView(tab) {
  const wrap = h('div', { class: 'history' });
  const list = h('div', { class: 'history-list' }, h('div', { class: 'section-label' }, `History · ${stem(tab.path)}`));
  if (!tab.commits) list.append(h('div', { class: 'empty' }, 'Loading…'));
  else if (!tab.commits.length) list.append(h('div', { class: 'empty' }, 'No earlier versions yet. Margin keeps one when this note is saved after a while, changed by another program or an agent, or restored.'));
  else tab.commits.forEach((c, i) => list.append(h('div', { class: `history-row${i === tab.sel ? ' sel' : ''}`, onclick: () => selectVersion(tab, i) },
    h('div', { class: 'git-subject' }, c.agent ? h('span', { class: 'git-agent' }, '✦ ') : null, c.subject),
    h('div', { class: 'git-meta' }, c.local ? `kept by Margin · ${timeAgo(c.date)}` : `${c.hash.slice(0, 7)} · ${c.author} · ${timeAgo(c.date)}`))));
  if (tab.commits && tab.repo === false) list.append(h('div', { class: 'history-foot' }, 'Not a git repository: these are the versions Margin kept (up to 50 per note, 30 days).'));
  const detail = h('div', { class: 'history-detail review' });
  const v = tab.version;
  if (v?.error) detail.append(h('div', { class: 'review-note warn' }, v.error));
  else if (v) {
    detail.append(h('div', { class: 'review-actions' },
      h('span', { class: 'grow' }, v.hunks.length ? `This version differs from the current note in ${v.hunks.length} place${v.hunks.length === 1 ? '' : 's'} (− this version, + current).` : 'Identical to the current note.'),
      v.hunks.length ? h('button', { class: 'btn primary', onclick: () => restoreVersion(tab.path, v.commit.hash || '', v.content, v.commit.local ? timeAgo(v.commit.date) : null) }, 'Restore this version') : null));
    detail.append(h('div', { class: 'file-card' }, v.hunks.map(staticHunk)));
  }
  wrap.append(list, detail);
  return wrap;
}

// Restoring writes the old text as a normal save, with an Undo that puts
// back exactly what was there before.
async function restoreVersion(p, rev, content, when = null) {
  try {
    let text = content;
    if (text == null) {
      const log = await api('GET', `/api/git/log?path=${encodeURIComponent(p)}&limit=1`);
      const c = log.commits[0];
      if (!c) throw new Error('No committed version');
      text = (await api('GET', `/api/git/show?rev=${c.hash}&path=${encodeURIComponent(c.gitPath)}`)).content;
    }
    if (!(await askConfirm(rev === 'HEAD' ? `Discard your uncommitted changes to ${p}?` : `Replace ${p} with the version from ${when || rev.slice(0, 7)}?`, { okLabel: rev === 'HEAD' ? 'Discard' : 'Replace', danger: true }))) return;
    const cur = await api('GET', `/api/file?path=${encodeURIComponent(p)}`);
    await api('PUT', '/api/file', { path: p, content: text, baseHash: cur.hash, reason: 'restore' });
    const open = S.tabs.find((t) => t.kind === 'file' && t.path === p);
    if (open) await syncTabs([open]);
    toast(`Restored ${stem(p)}`, '', { label: 'Undo', run: async () => {
      const now = await api('GET', `/api/file?path=${encodeURIComponent(p)}`);
      await api('PUT', '/api/file', { path: p, content: cur.content, baseHash: now.hash, reason: 'restore' });
      if (open) await syncTabs([open]);
      loadGit();
    } });
    loadGit();
    for (const t of S.tabs) if ((t.kind === 'gitdiff' || t.kind === 'history') && t.path === p) (t.kind === 'gitdiff' ? openGitDiff(p) : openHistory(p));
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ export

// A note as HTML for export and print; a .mmd file is its diagram.
const documentHtml = (tab) => (isMermaidFile(tab.path)
  ? `<pre data-lang="mermaid">${escAttr(tab.content)}</pre>`
  : renderMarkdown(tab.content, { image: (url) => localImage(url, tab.path), embed: (target, label) => fileEmbed(target, label, tab.path) }));

// Standalone HTML: rendered note + the current theme's reading styles, with
// local images inlined so the file works anywhere (and fetches nothing).
async function exportHtml(tab = fileTab()) {
  if (!tab) return;
  const body = h('div', { class: 'md', html: documentHtml(tab) });
  await fillNoteEmbeds(body);
  await fillMermaidEmbeds(body);
  await renderDiagrams(body);
  await fillDrawingEmbeds(body);
  for (const img of body.querySelectorAll('img')) {
    if (img.getAttribute('src')?.startsWith('data:')) continue; // already inline (drawings)
    try {
      const blob = await (await fetch(img.getAttribute('src'))).blob();
      img.src = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    } catch { img.remove(); }
  }
  body.querySelectorAll('a.internal, a.tag').forEach((a) => a.removeAttribute('href'));
  body.querySelectorAll('.drawing-embed, .mmd-embed, .note-embed').forEach((e) => { for (const k of ['title', 'data-path', 'data-label', 'data-target']) e.removeAttribute(k); });
  body.querySelectorAll('.note-embed-head').forEach((e) => e.removeAttribute('title'));
  body.querySelectorAll('.diagram-copy').forEach((b) => b.remove());
  body.querySelectorAll('pre[data-source]').forEach((pre) => { pre.removeAttribute('data-source'); pre.querySelector('img')?.removeAttribute('title'); });
  body.querySelectorAll('input.task').forEach((i) => i.setAttribute('disabled', ''));
  const vars = getComputedStyle(document.documentElement);
  const pick = ['bg', 'bg-2', 'bg-3', 'fg', 'fg-dim', 'fg-faint', 'border', 'accent', 'accent-2', 'ok', 'warn', 'bad', 'syn-tag', 'syn-comment', 'syn-string', 'syn-number', 'syn-keyword', 'syn-link', 'sans', 'mono'];
  const rootVars = pick.map((k) => `--${k}:${vars.getPropertyValue(`--${k}`).trim()};`).join('');
  const css = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } })
    .map((r) => r.cssText).filter((t) => /^\.md\b|^\.tk-/.test(t)).join('\n');
  const title = stem(tab.path);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title><style>:root{${rootVars}}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 var(--sans)}
main{max-width:760px;margin:0 auto;padding:48px 24px}${css}</style></head><body><main class="md">${body.innerHTML}</main></body></html>`;
  const a = h('a', { href: URL.createObjectURL(new Blob([html], { type: 'text/html' })), download: `${title}.html` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Print / "Save as PDF" through the system dialog, using the rendered note.
async function printNote(tab = fileTab()) {
  if (!tab) return;
  const sheet = h('div', { id: 'print-sheet', class: 'md', html: documentHtml(tab) });
  await fillNoteEmbeds(sheet);
  await fillMermaidEmbeds(sheet);
  await renderDiagrams(sheet);
  await fillDrawingEmbeds(sheet);
  document.body.append(sheet);
  document.documentElement.classList.add('printing');
  const done = () => { document.documentElement.classList.remove('printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

// ------------------------------------------------------------------ agent: delegate

// Unsaved edits are written first: the agent works on the files on disk.
async function savedForAgent(tab) {
  if (!tab || (tab.content === tab.saved && !tab.saving)) return true;
  if (!S.settings.autosave && !(await askConfirm('Save your unsaved changes first? The agent works on the saved files.', { okLabel: 'Save' }))) return false;
  if (tab.saving) await tab.saving;
  if (tab.content !== tab.saved) await saveTab(tab);
  if (tab.content !== tab.saved) { toast('Could not save the note; resolve the conflict first.', 'error'); return false; }
  return true;
}

// presetTask: the task to start from; scope and recipe: a recipe's.
async function openTaskDialog(presetTask = '', { scope: presetScope = null, recipe = null } = {}) {
  if (!S.info?.agent?.configured) { showView('agent'); toast('No agent configured — see the Agent panel.', 'error'); return; }
  const focus = fileTab() && isNote(fileTab().path) ? fileTab().path : null;
  const tab = fileTab();
  if (!(await savedForAgent(tab))) return;
  const overlay = $('#overlay');
  let scope = presetScope && (presetScope !== 'file' || focus) ? presetScope : focus ? 'file' : 'workspace';
  let recipeName = recipe;
  const ed = tab?.editor;
  const selection = ed && isNote(tab.path) ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : '';
  const useSel = h('input', { type: 'checkbox', checked: !!selection.trim() });
  const agents = S.info.agents || [];
  const lastAgent = store.getItem('an.lastAgent');
  let agentId = agents.some((a) => a.id === lastAgent) ? lastAgent : S.info.agent.id;
  const agentPicker = agents.length > 1 ? h('select', { class: 'agent-select', onchange: (e) => { agentId = e.target.value; syncAgent(); } },
    agents.map((a) => h('option', { value: a.id, selected: a.id === agentId }, a.label))) : null;
  // Model per task, for agents whose CLI we know (the server only accepts listed models).
  const agentOf = () => agents.find((a) => a.id === agentId);
  const modelKey = () => `an.model.${agentOf()?.label || ''}`;
  let model = '';
  const modelPicker = h('select', { class: 'agent-select model-select', title: 'Model for this task',
    onchange: (e) => { model = e.target.value; store.setItem(modelKey(), model); } });
  const agentNote = h('div', { hidden: true });
  function syncAgent() {
    const a = agentOf();
    const models = a?.models || [];
    const saved = store.getItem(modelKey()) || '';
    model = models.some((m) => m.id === saved) ? saved : '';
    modelPicker.replaceChildren(h('option', { value: '' }, `Default model${a?.model ? ` (${a.model})` : ''}`),
      ...models.map((m) => h('option', { value: m.id, selected: m.id === model }, m.label)));
    modelPicker.hidden = !models.length;
    const st = (S.agentStatus || []).find((x) => x.id === agentId);
    agentNote.hidden = !(a && st && st.ok === false);
    agentNote.replaceChildren(...(agentNote.hidden ? [] : [signInWarning(a, st)]));
  }
  syncAgent();
  loadAgentStatus(true).then(syncAgent);
  const task = h('textarea', { placeholder: 'What should the agent do? e.g. “Turn my meeting notes into a decision log”', value: presetTask });
  const filesBox = h('div', { class: 'scope-files' });
  const shareLine = h('div', { class: 'grow' });
  const runBtn = h('button', { class: 'btn primary', onclick: submit }, 'Run on staged copy');
  const close = () => { overlay.hidden = true; overlay.replaceChildren(); };

  let asked = 0;
  async function refreshScope() {
    const n = ++asked;
    if (!filesBox.childElementCount) filesBox.replaceChildren('…');
    try {
      const r = await scopeFor(scope, focus, task.value);
      if (n !== asked) return;
      const pics = (r.pictures || []).filter((p) => !r.hidden?.[p] || coverable(p));
      const shut = (r.pictures || []).filter((p) => !pics.includes(p)).map((p) => ({ path: p, reason: 'parts hidden, could not cover them' }));
      r.excluded = [...r.excluded, ...shut];
      filesBox.replaceChildren(
        r.instructions ? h('div', { class: 'instr', title: 'The folder’s instructions for agents, sent with every task' }, `${r.instructions}  (instructions)`) : '',
        ...r.included.map((p) => h('div', {}, p)),
        ...pics.map((p) => (r.hidden?.[p]
          ? h('div', { class: 'instr', title: 'A picture the notes show, shared with the parts its hide marks cover covered' }, `${p}  (picture, parts hidden)`)
          : h('div', { class: 'instr', title: 'A picture the notes show, shared because the task is about pictures' }, `${p}  (picture)`))),
        ...r.excluded.map((x) => h('div', { class: 'ex', title: `withheld: ${x.reason}` }, `${x.path}  (${x.reason.startsWith('parts hidden') ? 'withheld' : 'private'})`)));
      shareLine.textContent = `${r.included.length} note${r.included.length === 1 ? '' : 's'}${pics.length ? ` and ${pics.length} picture${pics.length === 1 ? '' : 's'}` : ''} will be shared${r.excluded.length ? `, ${r.excluded.length} withheld` : ''}${r.instructions ? `, with ${r.instructions}` : ''}.`;
      runBtn.disabled = !r.included.length;
    } catch (e) { filesBox.replaceChildren(e.message); runBtn.disabled = true; }
  }

  async function submit() {
    if (!task.value.trim()) { task.focus(); return; }
    runBtn.disabled = true;
    try {
      store.setItem('an.lastAgent', agentId);
      const r = recipeName && recipes.list.find((x) => x.name === recipeName);
      const masked = await maskedPictures((await scopeFor(scope, focus, task.value)).hidden);
      const run = await api('POST', '/api/runs', { task: task.value, scope, focus, selection: useSel.checked ? selection : '', agentId, model, recipe: r && r.prompt === task.value ? r.name : '', masked });
      close();
      await loadRuns();
      openReview(run.id);
    } catch (e) { toast(e.message, 'error'); runBtn.disabled = false; }
  }

  const scopeOpt = (value, label, disabled) => h('label', {},
    h('input', { type: 'radio', name: 'scope', value, checked: scope === value, disabled, onchange: () => { scope = value; refreshScope(); } }), label);

  const refreshSoon = debounce(refreshScope, 300);
  task.addEventListener('input', refreshSoon);
  task.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') close();
  });
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.replaceChildren(h('div', { class: 'dialog' },
    h('div', { class: 'dialog-body' },
      agentPicker ? h('h2', {}, 'Delegate to ', agentPicker, modelPicker) : h('h2', {}, `Delegate to ${S.info.agent.label}`, modelPicker),
      h('p', { class: 'sub' }, 'The agent edits a staged copy of the notes below. You review every change before it touches your files.'),
      agentNote,
      task,
      selection.trim() ? h('label', { class: 'sel-context' }, useSel,
        h('span', {}, `Focus on the selected text (${selection.length} chars) — `, h('i', {}, `“${selection.trim().slice(0, 60)}${selection.trim().length > 60 ? '…' : ''}”`))) : null,
      h('div', { class: 'recipes' }, recipes.list.map((r) => h('button', { class: 'chip', title: r.prompt, onclick: () => {
        task.value = r.prompt;
        recipeName = r.name;
        if (r.scope && (r.scope !== 'file' || focus)) { scope = r.scope; overlay.querySelectorAll('input[name=scope]').forEach((x) => { x.checked = x.value === scope; }); }
        refreshScope();
        task.focus();
      } }, r.name)),
      h('button', { class: 'chip add', title: `Your own recipes, as commands: ${RECIPES_FILE}`, onclick: () => { close(); editRecipes(); } }, '＋')),
      h('div', { class: 'scope-row' },
        scopeOpt('file', focus ? `This note (${basename(focus)})` : 'This note', !focus),
        scopeOpt('folder', focus && dirname(focus) ? `This folder (${dirname(focus)}/)` : 'Top folder', false),
        scopeOpt('workspace', 'Whole workspace', false)),
      filesBox),
    h('div', { class: 'dialog-foot' }, shareLine, h('button', { class: 'btn', onclick: close }, 'Cancel'), runBtn)));
  overlay.hidden = false;
  task.focus();
  refreshScope();
}

// ------------------------------------------------------------------ agent: review

async function loadRuns() {
  const was = new Map(S.runs.map((r) => [r.id, r.status]));
  try { S.runs = (await api('GET', '/api/runs')).runs; } catch { S.runs = []; }
  if (S.view === 'agent') renderSidebar(); else renderActivity();
  redrawSpecial('runs');
  for (const r of S.runs) if (was.get(r.id) === 'running' && r.status !== 'running') runFinished(r);
  proofsSettled();
  renderStatus();
}

// Delegate and keep writing: a run that ends says so — here, and as a
// system notification while Margin is in the background.
function runFinished(r) {
  if (r.status === 'cancelled') return;
  const here = activeTab()?.kind === 'review' && activeTab().runId === r.id;
  const what = r.status === 'review' ? 'is done — ready for review' : r.status === 'failed' ? 'failed' : r.status;
  const task = r.recipe || r.task.replace(/\s+/g, ' ').slice(0, 70);
  if (!here) toast(`Agent ${what}: ${task}`, r.status === 'failed' ? 'error' : '', { label: 'Review', run: () => openReview(r.id) });
  if (!document.hasFocus() && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const n = new Notification('Margin', { body: `Agent ${what}: ${task}` });
    n.onclick = () => { window.focus(); openReview(r.id); };
  }
}

function openReview(id) {
  let tab = S.tabs.find((t) => t.kind === 'review' && t.runId === id);
  if (!tab) {
    const r = S.runs.find((x) => x.id === id);
    tab = { id: `r:${id}`, kind: 'review', runId: id, title: (r?.recipe || r?.task || id).slice(0, 28), run: null, decisions: {}, group: S.focus };
    S.tabs.push(tab);
  }
  tab.wantFocus = true;
  activate(tab.id);
  refreshReview(tab);
}

// AGENTS.md at the top of the folder goes with every task (server.js): how
// agents should write here. Opened, or made from a start.
async function editAgentInstructions() {
  const p = 'AGENTS.md';
  if (!S.files.some((f) => f.path === p)) {
    try {
      await api('POST', '/api/file', { path: p, content: '# Instructions for agents\n\nMargin sends this note with every task you give an agent here (Claude Code and Codex read it too when they work in this folder).\n\n- Write in the language of the note.\n- Keep my headings and the order of the sections.\n- Tags look like #area/topic; dates like 2026-10-03.\n' });
      await loadTree();
    } catch (e) { toast(e.message, 'error'); return; }
  }
  openFile(p);
}

// ------------------------------------------------------------------ recipes
// Tasks for the agent run by name (recipes.js): Margin's own, and the user's
// from RECIPES.md, each a command (M-x, ⌥X r). Whatever they do comes back as
// a run to review.

const recipes = { list: mergeRecipes(), errors: [], text: null };
async function loadRecipes() {
  let text = '';
  if (S.files.some((f) => f.path === RECIPES_FILE)) {
    try { text = (await api('GET', `/api/file?path=${encodeURIComponent(RECIPES_FILE)}`)).content; } catch { text = ''; }
  }
  if (text === recipes.text) return;
  const first = recipes.text == null;
  recipes.text = text;
  const parsed = parseRecipes(text);
  recipes.list = mergeRecipes(parsed.recipes);
  recipes.errors = parsed.errors;
  if (first && !parsed.errors.length) return;
  const e = parsed.errors[0];
  if (e) toast(`${RECIPES_FILE} line ${e.line}: ${e.msg}${parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : ''}`, 'error');
  else toast(`${parsed.recipes.length} recipe${parsed.recipes.length === 1 ? '' : 's'} from ${RECIPES_FILE} — ⌥X r, or by name with M-x`);
}

const recipeLabel = (r) => (runsDirectly(r) ? r.name : `${r.name}…`);

// What a task would share (/api/scope): a task about pictures also shares
// the pictures the notes show.
const scopeFor = (scope, focus, task) => api('GET', `/api/scope?scope=${scope}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}&task=${encodeURIComponent(String(task).slice(0, 500))}`);

// Straight to the agent (in the background; a message says when it is
// ready for review), or the task dialog filled in (recipes.js runsDirectly).
async function runRecipe(r) {
  if (!runsDirectly(r)) { openTaskDialog(r.prompt, { scope: r.scope, recipe: r.name }); return; }
  if (!S.info?.agent?.configured) { showView('agent'); toast('No agent configured — see the Agent panel.', 'error'); return; }
  const tab = fileTab();
  const focus = tab && isNote(tab.path) ? tab.path : null;
  if (r.scope === 'file' && !focus) { toast(`“${r.name}” works on the note in view: open a note first.`, 'error'); return; }
  if (!(await savedForAgent(tab))) return;
  const ed = focus && tab.editor;
  const selection = ed ? ed.value.slice(ed.selectionStart, ed.selectionEnd) : '';
  const { agentId, model } = agentNow();
  try {
    const masked = await maskedPictures((await scopeFor(r.scope || 'file', focus, r.prompt)).hidden);
    const run = await api('POST', '/api/runs', { task: r.prompt, scope: r.scope || 'file', focus, selection, agentId, model, recipe: r.name, masked });
    await loadRuns();
    toast(`${r.name}: the agent is on it (a staged copy of ${r.scope === 'file' ? stem(focus) : r.scope === 'folder' ? 'this folder' : 'the workspace'})`, '', { label: 'Watch', run: () => openReview(run.id) });
  } catch (e) { toast(e.message, 'error'); }
}

// The agent (and model) last chosen in the task dialog.
function agentNow() {
  const agents = S.info.agents || [];
  const last = store.getItem('an.lastAgent');
  const agent = agents.find((a) => a.id === last) || agents.find((a) => a.id === S.info.agent.id);
  const saved = store.getItem(`an.model.${agent?.label || ''}`) || '';
  return { agentId: agent?.id, model: agent?.models?.some((m) => m.id === saved) ? saved : '' };
}

// Margin changed by asking: what a command should do, or how one should
// change, said in words; the agent writes it where Margin keeps your own —
// LEADER.md (keys), RECIPES.md (tasks for the agent), MACROS.md (editing
// steps) — and it comes back as a run to review like any other. Applied,
// the notes are read again and it works at once. Text only: no code runs.
async function changeByAgent(topic = null) {
  if (!S.info?.agent?.configured) { showView('agent'); toast('No agent configured — see the Agent panel.', 'error'); return; }
  const L = kbd('leader') || '⌥X';
  const what = (await askText({
    title: topic ? `Change “${topic.name}”` : 'Make or change a command',
    label: topic ? 'How should it change? Its keys, what it does, a version of your own…'
      : `What should it do, and on which keys? The agent writes it in ${LEADER_FILE}, ${RECIPES_FILE} or ${MACROS_FILE}, and you review it before anything changes.`,
    placeholder: topic ? `Put it on ${L} o s` : `Turn the line into a task and go to the next one, on ${L} o t`,
    multiline: true, okLabel: 'Ask the agent',
  }))?.trim();
  if (!what) return;
  let task = what;
  if (topic) {
    const where = [...(topic.leaders || []).map((p) => `${L} ${p.keys.join(' ')}`), topic.shortcut && kbd(topic.shortcut), topic.emacsKey && `${topic.emacsKey} (Emacs keys)`].filter(Boolean);
    task = `About “${topic.name}” (${topic.unbound ? 'a key with no command on it' : 'a command'}${where.length ? `, on ${where.join(', ')}` : ''}): ${what}`;
  }
  // The keys as they are, and the names a key or a macro can run besides
  // the ones the key map shows already.
  const keymap = keymapLines();
  const shown = new Set(keymap.map((l) => norm(l.replace(/^- (``.*?``|`[^`]*`) /, ''))));
  const commands = [...new Set(allCommands().filter((c) => !c.emacsOnly && !c.inBuffer && !shown.has(norm(c.name))).map((c) => c.name))];
  try {
    const run = await api('POST', '/api/runs', { task, scope: 'commands', commands, keymap, ...agentNow() });
    await loadRuns();
    toast(`The agent is on it (a staged copy of ${LEADER_FILE}, ${RECIPES_FILE} and ${MACROS_FILE})`, '', { label: 'Watch', run: () => openReview(run.id) });
  } catch (e) { toast(e.message, 'error'); }
}

// The leader's keys as LEADER.md would write them: `n w` Widen: show the whole note.
function keymapLines() {
  const out = [];
  // Each by its name in M-x (where that is not the menu's own).
  const named = new Map(allCommands().filter((c) => c.leader).map((c) => [c.leader.join(' '), c.name]));
  const walk = (items, path, group) => {
    for (const it of items) {
      const keys = [...path, it.key];
      const at = keys.includes('`') ? `- \`\` ${keys.join(' ')} \`\`` : `- \`${keys.join(' ')}\``;
      if (it.items) { out.push(`${at} +${it.label}`); walk(it.items, keys, it.label); }
      else if (it.recipe) out.push(`${at} Recipe: ${it.recipe.name}`);
      else if (it.mx !== false) out.push(`${at} ${named.get(keys.join(' ')) || leafName(it, group)}`);
      else out.push(`${at} (${it.label})`);
    }
  };
  walk(leaderTree(), [], '');
  return out;
}

// A run's changes to LEADER.md, RECIPES.md or MACROS.md, checked as Margin
// will read them (commandcheck.js): lines it would leave out, and the keys.
function commandNotesCheck(run) {
  const after = Object.fromEntries((run.changes || []).filter((c) => COMMAND_NOTES.includes(c.path) && (c.after != null || c.status === 'deleted')).map((c) => [c.path, c.after ?? '']));
  if (!Object.keys(after).length) return null;
  const before = { [LEADER_FILE]: leaderKeys.text || '', [RECIPES_FILE]: recipes.text || '', [MACROS_FILE]: kept.text || '' };
  const known = (name) => !/^(recipe|macro):/i.test(name) && !!commandRun(name);
  const { problems, keys } = checkCommandNotes({ after, before, tree: defaultLeaderTree(), known });
  const L = kbd('leader') || '⌥X';
  const items = [
    ...problems.map((p) => h('li', { class: 'bad' }, `${p.file} line ${p.line}: ${p.msg} — Margin would leave it out.`)),
    ...keys.map((k) => h('li', { class: k.rename || k.was || k.off ? 'warn' : '' }, h('kbd', {}, `${L} ${k.keys.join(' ')}`), ' ',
      k.off ? `taken away${k.was ? ` (was ${k.was})` : ''}`
        : k.rename ? `renames Margin’s group “${k.rename}” to “${k.what.slice(1)}”`
          : `${k.what}${k.was ? ` — replaces ${k.was}` : ''}`)),
  ];
  const ok = !problems.length;
  return h('div', { class: `review-note${ok ? '' : ' warn'} cmd-check` },
    h('div', {}, ok ? `Margin can read every line of ${Object.keys(after).join(', ')}${keys.length ? '; on the keys:' : '.'}` : `Margin checked ${Object.keys(after).join(', ')}:`),
    items.length ? h('ul', {}, items) : null,
    !ok && run.status === 'review' ? h('button', { class: 'btn small', onclick: () => fixCommandNotes(run, problems) }, 'Ask the agent to fix these') : null);
}
async function fixCommandNotes(run, problems) {
  const task = `Margin can't read these lines and would leave them out:\n${problems.map((p) => `- ${p.file} line ${p.line}: ${p.msg}`).join('\n')}\nFix them.`;
  try {
    const next = await api('POST', `/api/runs/${run.id}/followup`, { task });
    await loadRuns();
    const tab = S.tabs.find((t) => t.kind === 'review' && t.runId === run.id);
    if (tab) closeTab(tab.id);
    openReview(next.id);
  } catch (e) { toast(e.message, 'error'); }
}

async function editRecipes() {
  if (!S.files.some((f) => f.path === RECIPES_FILE)) {
    try { await api('POST', '/api/file', { path: RECIPES_FILE, content: RECIPES_STARTER }); await loadTree(); } catch (e) { toast(e.message, 'error'); return; }
  }
  openFile(RECIPES_FILE);
}

// The run that waits longest for a look (the oldest in review), else the newest.
function reviewNext() {
  const waiting = S.runs.filter((r) => r.status === 'review');
  const open = activeTab()?.kind === 'review' ? activeTab().runId : null;
  const next = waiting.filter((r) => r.id !== open).at(-1) || waiting[0] || S.runs[0];
  if (next) openReview(next.id);
  else toast('No agent runs yet.');
}

// ------------------------------------------------------------------ changes from outside
// An agent can also work in the folder directly (Claude Code or Codex in a
// terminal), as can any other editor. What they changed is reviewed here like
// a run: pick the changes to keep, the others are undone.

async function loadOutside() {
  const before = S.outside?.length || 0;
  try { S.outside = (await api('GET', '/api/outside')).changes; } catch { S.outside = []; }
  if (S.outside.length !== before && nav.ready) renderStatus();
  const tab = S.tabs.find((t) => t.kind === 'outside');
  if (tab) refreshOutside(tab);
}

function openOutside() {
  refreshOutside(openSpecial('outside', { title: 'Changed outside', run: null, decisions: {} }));
}

async function refreshOutside(tab) {
  if (penFirst()) await loadPen();
  let list;
  try { list = (await api('GET', '/api/outside')).changes; } catch (e) { toast(e.message, 'error'); return; }
  S.outside = list;
  const old = new Map((tab.run?.changes || []).map((c) => [c.path, c]));
  const changes = (await Promise.all(list.map((x) => api('GET', `/api/outside/diff?path=${encodeURIComponent(x.path)}`).then((c) => ({ ...c, at: x.at }), () => null)))).filter(Boolean);
  const decisions = {};
  // A note that changed again starts over: all of it kept.
  for (const c of changes) {
    decisions[c.path] = old.get(c.path)?.hash === c.hash && old.get(c.path)?.status === c.status ? tab.decisions[c.path]
      : { file: true, hunks: new Set((c.hunks || []).map((_, i) => i)) };
  }
  tab.run = { status: 'review', changes };
  tab.decisions = decisions;
  renderStatus();
  if (S.groups[tab.group]?.active === tab.id) renderContent(tab.group);
}

function outsideView(tab) {
  const wrap = h('div', { class: 'review' });
  wrap.append(h('div', { class: 'review-head' },
    h('span', { class: 'badge st-review' }, 'outside'),
    h('div', { class: 'task' }, 'Changed outside Margin'),
    h('div', { class: 'meta' }, h('span', {}, 'Notes another program changed while Margin was open — an agent in a terminal, another editor. Every change is kept until you undo it; earlier versions are also in each note’s history.'))));
  const changes = tab.run?.changes;
  if (!changes) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  if (!changes.length) { wrap.append(h('div', { class: 'review-note ok' }, 'Nothing changed outside since you last looked.')); return wrap; }
  const total = changes.reduce((n, c) => n + (c.hunks ? c.hunks.length : 1), 0);
  const kept = changes.reduce((n, c) => n + (c.hunks ? tab.decisions[c.path].hunks.size : tab.decisions[c.path].file ? 1 : 0), 0);
  const undo = total - kept;
  wrap.append(h('div', { class: 'review-actions' },
    h('span', { class: 'grow' }, `${changes.length} note${changes.length === 1 ? '' : 's'} · keeping ${kept} of ${total} change${total === 1 ? '' : 's'}`,
      h('span', { class: 'review-keys', title: keysHint('outside') }, penFirst() ? 'j k · y keep · n undo · a done · v diff' : 'j k · x · a done · v red pen')),
    h('button', { class: 'btn', onclick: () => refreshOutside(tab) }, 'Refresh'),
    h('button', { class: `btn ${undo ? 'danger' : 'primary'}`, onclick: () => keepOutside(tab) }, undo ? `Undo ${undo}, keep ${kept}` : 'Keep all')));
  for (const c of [...changes].sort((a, b) => b.at - a.at)) {
    wrap.append(h('div', { class: 'outside-when' }, `${{ added: 'made', deleted: 'deleted' }[c.status] || 'changed'} ${timeAgo(c.at)}`));
    wrap.append(fileCard(c, tab, false));
  }
  return wrap;
}

// ------------------------------------------------------------------ tasks
// Every "- [ ]" in the workspace in one list (org-mode's agenda, Obsidian
// Tasks): overdue, today and upcoming by their date (📅 2026-10-05 or
// due:2026-10-05), the rest by note. Keys as in a review: j/k, x checks it
// off, o opens it, a hands it to the agent.

function openTasks() {
  refreshTasks(openSpecial('tasks', { title: 'Tasks', tasks: null, showDone: false }));
}

async function refreshTasks(tab) {
  try { tab.tasks = (await api('GET', '/api/tasks')).tasks; } catch (e) { toast(e.message, 'error'); return; }
  if (S.groups[tab.group]?.active === tab.id) renderContent(tab.group);
}
const refreshTasksSoon = debounce(() => { const t = S.tabs.find((x) => x.kind === 'tasks'); if (t) refreshTasks(t); }, 200);

const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function tasksView(tab) {
  const wrap = h('div', { class: 'review tasks' });
  const all = tab.tasks;
  if (!all) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  const open = all.filter((t) => !t.done);
  const list = tab.showDone ? all : open;
  const notes = new Set(open.map((t) => t.path)).size;
  wrap.append(h('div', { class: 'review-head' },
    h('div', { class: 'task' }, 'Tasks'),
    h('div', { class: 'meta' },
      h('span', {}, `${open.length} open in ${notes} note${notes === 1 ? '' : 's'}${all.length > open.length ? ` · ${all.length - open.length} done` : ''}`),
      h('span', { class: 'review-keys', title: keysHint('tasks') }, 'j k · x done · o open · a agent · h done'))));
  if (!list.length) { wrap.append(h('div', { class: 'review-note ok' }, all.length ? 'Nothing left to do.' : 'No tasks yet: a line like “- [ ] call Alex 📅 2026-10-05” in any note shows here.')); return wrap; }
  const now = today();
  const groups = [['Overdue', (t) => t.due && t.due < now && !t.done], ['Today', (t) => t.due === now], ['Upcoming', (t) => t.due && t.due > now]];
  const shown = new Set();
  const row = (t) => h('div', { class: `task-row kb-item${t.done ? ' done' : ''}`, 'data-path': t.path, 'data-hunk': t.line, 'data-line': t.line },
    h('input', { type: 'checkbox', checked: t.done, onclick: (e) => { e.preventDefault(); toggleTaskAt(tab, t); } }),
    h('span', { class: 'task-text' }, t.text.replace(/(?:📅\s*|\bdue:\s*)\d{4}-\d{2}-\d{2}/u, '').trim()),
    t.due ? h('span', { class: `task-due${t.due < now && !t.done ? ' overdue' : t.due === now ? ' today' : ''}` }, t.due) : null,
    h('a', { class: 'task-note', href: '#', onclick: (e) => { e.preventDefault(); openFile(t.path, { line: t.line }); } }, stem(t.path)));
  for (const [name, test] of groups) {
    const items = list.filter((t) => !shown.has(t) && test(t)).sort((a, b) => a.due.localeCompare(b.due));
    if (!items.length) continue;
    items.forEach((t) => shown.add(t));
    wrap.append(h('div', { class: 'task-group' }, h('h3', {}, name), items.map(row)));
  }
  const rest = new Map();
  for (const t of list) if (!shown.has(t)) { if (!rest.has(t.path)) rest.set(t.path, []); rest.get(t.path).push(t); }
  for (const [p, items] of rest) wrap.append(h('div', { class: 'task-group' }, h('h3', { title: p }, stem(p)), items.map(row)));
  return wrap;
}

async function toggleTaskAt(tab, t) {
  if (S.tabs.some((x) => x.kind === 'file' && x.path === t.path && x.content !== x.saved)) { toast(`${t.path} has unsaved edits; save it first.`, 'error'); return; }
  try { await api('POST', '/api/tasks/toggle', { path: t.path, line: t.line, text: t.text }); } catch (e) { toast(e.message, 'error'); }
  await syncOpenTabs();
  await refreshTasks(tab);
}

const taskOf = (tab, el) => el && tab.tasks?.find((x) => x.path === el.dataset.path && x.line === Number(el.dataset.line));
function openTaskAt(tab, el) {
  const t = taskOf(tab, el);
  if (t) openFile(t.path, { line: t.line });
}

function tasksOwnKeys(e, tab, { wrap, i, cur }) {
  const t = taskOf(tab, cur);
  const k = e.key;
  if ((k === 'x' || k === ' ') && t) {
    // Stay on the same place in the list: the next one moves up into it.
    toggleTaskAt(tab, t).then(() => { const next = reviewItems(bufferEl(tab) || wrap); if (next.length) setReviewCur(tab, next[Math.min(i, next.length - 1)]); });
  } else if (k === 'a' && t) {
    openFile(t.path, { line: t.line }).then(() => openTaskDialog(`Do this task from the note (line ${t.line}): “${t.text}”. When it is done, check it off (- [x]).`));
  } else if (k === 'h') { tab.showDone = !tab.showDone; renderContent(tab.group); }
  else return k === 'x' || k === ' ' || k === 'a';
  return true;
}

// Undo the changes that are not kept; all of them are looked at, then.
async function keepOutside(tab) {
  const changes = tab.run?.changes || [];
  if (!changes.length) return;
  const seen = [];
  let undone = 0;
  for (const c of changes) {
    const d = tab.decisions[c.path];
    const undo = c.hunks ? c.hunks.length - d.hunks.size : d.file ? 0 : 1;
    if (undo) {
      const open = S.tabs.find((t) => t.kind === 'file' && t.path === c.path && t.content !== t.saved);
      if (open) { toast(`${c.path} has unsaved edits here; save or revert them first.`, 'error'); continue; }
      try {
        // A note it made goes to the trash; one it deleted comes back.
        if (c.status === 'added') await api('POST', '/api/delete', { path: c.path });
        else if (c.status === 'deleted') await api('PUT', '/api/file', { path: c.path, content: c.before, reason: 'restore' });
        else await api('PUT', '/api/file', { path: c.path, content: applySelected(c.base, c.hunks, d.hunks), baseHash: c.hash, reason: 'restore' });
        undone += undo;
      } catch (e) { toast(`${c.path}: ${e.status === 409 ? 'it changed again — look at it once more' : e.message}`, 'error'); continue; }
    }
    seen.push(c.path);
  }
  try { await api('POST', '/api/outside/seen', { paths: seen }); } catch (e) { toast(e.message, 'error'); }
  if (seen.length) toast(undone ? `Undid ${undone} change${undone === 1 ? '' : 's'} from outside.` : `Kept the changes in ${seen.length} note${seen.length === 1 ? '' : 's'}.`);
  await Promise.all([loadTree(), syncOpenTabs()]);
  await refreshOutside(tab);
}

async function refreshReview(tab) {
  const prevStatus = tab.run?.status;
  try { tab.run = await api('GET', `/api/runs/${tab.runId}`); }
  catch (e) { toast(e.message, 'error'); return; }
  const run = tab.run;
  const marked = penFirst() || run.comments?.length;
  if (marked && run.status !== 'running') await loadPen();
  // Default: everything that can be applied is selected.
  // Applied/undone runs show what was actually applied.
  const appliedBy = new Map((run.applied?.files || []).map((f) => [f.path, f]));
  const finished = !['review', 'failed', 'cancelled', 'running'].includes(run.status);
  for (const c of run.changes) {
    if (finished) {
      const f = appliedBy.get(c.path);
      tab.decisions[c.path] = { file: !!f, hunks: new Set(f?.hunks || (f && c.hunks ? c.hunks.map((_, i) => i) : [])) };
      continue;
    }
    if (tab.decisions[c.path]) continue;
    const conflicts = new Set(c.conflicts || []);
    // On the red pen's proof each mark waits for a yes or a no.
    tab.decisions[c.path] = isBlocked(c) || (penFirst() && penable(c))
      ? { file: false, hunks: new Set() }
      : { file: true, hunks: new Set((c.hunks || []).map((_, i) => i).filter((i) => !conflicts.has(i))) };
  }
  if (run.status === 'running' && !tab.timer) {
    tab.timer = setInterval(() => refreshReview(tab), 1000);
  } else if (run.status !== 'running' && tab.timer) {
    clearInterval(tab.timer);
    tab.timer = null;
    loadRuns();
  }
  if (S.groups[tab.group]?.active === tab.id) {
    const pane = paneEl(tab.group);
    const scroller = pane?.querySelector('.review');
    // The log follows new output while it is scrolled to the end, like a terminal.
    const oldLog = pane?.querySelector('details.log .log-body');
    const logAt = oldLog && { top: oldLog.scrollTop, end: oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 24 };
    const placeLog = (pre) => { pre.scrollTop = !logAt || logAt.end ? pre.scrollHeight : logAt.top; };
    if (run.status === 'running' && prevStatus === 'running' && oldLog) {
      // Still working: only the log changes, so update it in place.
      const key = `${run.log.length}:${run.activity?.length}`;
      if (oldLog.dataset.key !== key) {
        oldLog.dataset.key = key;
        oldLog.replaceChildren(...logContent(run));
        oldLog.parentElement.querySelector('summary').textContent = logTitle(run);
        placeLog(oldLog);
      }
      return;
    }
    const top = scroller?.scrollTop;
    renderContent(tab.group);
    if (scroller && top) pane.querySelector('.review').scrollTop = top;
    const log = pane.querySelector('details.log .log-body');
    if (log) placeLog(log);
  }
}

const isBlocked = (c) => c.reserved || (c.stale && !c.mergeable);

// Word-level highlight for a removed/added line pair.
function wordDiff(a, b) {
  const A = a.match(/\s+|[\p{L}\p{N}_]+|./gu) || [];
  const B = b.match(/\s+|[\p{L}\p{N}_]+|./gu) || [];
  if (A.length * B.length > 40000) return null;
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const left = []; const right = [];
  let i = 0; let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { left.push(A[i]); right.push(B[j]); i++; j++; }
    else if (j >= B.length || (i < A.length && dp[i + 1][j] >= dp[i][j + 1])) left.push(h('s', {}, A[i++]));
    else right.push(h('ins', {}, B[j++]));
  }
  return [left, right];
}

function diffLine(cls, n, sign, content) {
  return h('div', { class: cls }, h('span', { class: 'n' }, n ?? ''), h('span', { class: 's' }, sign), h('span', {}, content === '' ? ' ' : content));
}

function hunkView(c, hunk, i, dec, lockedAll, tab) {
  // Conflicts only matter while a run can still be applied.
  const conflict = !lockedAll && (c.conflicts || []).includes(i);
  const show = c.plain || ((l) => l);
  const locked = lockedAll || conflict;
  const on = dec.hunks.has(i);
  const rows = [];
  let ln = hunk.baseStart - hunk.before.length + 1;
  for (const l of hunk.before) rows.push(diffLine('ctx', ln++, ' ', show(l)));
  const paired = hunk.removed.length === hunk.added.length && hunk.removed.length <= 20;
  hunk.removed.forEach((l, k) => {
    const wd = paired ? wordDiff(show(l), show(hunk.added[k])) : null;
    rows.push(diffLine('del', ln++, '−', wd ? wd[0] : show(l)));
  });
  hunk.added.forEach((l, k) => {
    const wd = paired ? wordDiff(show(hunk.removed[k]), show(l)) : null;
    rows.push(diffLine('add', '', '+', wd ? wd[1] : show(l)));
  });
  for (const l of hunk.after) rows.push(diffLine('ctx', ln++, ' ', show(l)));
  const toggle = () => {
    if (locked) return;
    on ? dec.hunks.delete(i) : dec.hunks.add(i);
    renderContent(tab.group);
  };
  const what = [hunk.removed.length && `−${hunk.removed.length}`, hunk.added.length && `+${hunk.added.length}`].filter(Boolean).join(' ');
  return h('div', { class: `hunk kb-item${on ? '' : ' off'}`, 'data-path': c.path, 'data-hunk': i, 'data-line': hunk.baseStart + 1 },
    h('div', { class: 'hunk-head', onclick: toggle },
      h('input', { type: 'checkbox', checked: on, disabled: locked, onclick: (e) => e.stopPropagation(), onchange: toggle }),
      h('span', {}, `Change ${i + 1} of ${c.hunks.length} · line ${hunk.baseStart + 1} · ${what}`),
      conflict ? h('span', { class: 'st-failed' }, `· ${c.problems?.[i] || 'overlaps your edit'} — cannot apply`) : null,
      c.says?.[i] ? h('span', { class: 'hunk-says' }, `· ${c.says[i]}`) : null),
    h('div', { class: 'diff' }, rows));
}

function fileCard(c, tab, locked) {
  const dec = tab.decisions[c.path];
  // Finished runs are a record: compare against the snapshot, without the
  // "changed since" warnings that only matter before applying.
  const blocked = !locked && isBlocked(c);
  const lock = locked || blocked;
  const conflicts = new Set(c.conflicts || []);
  const selectable = c.hunks ? c.hunks.map((_, i) => i).filter((i) => !conflicts.has(i)) : [];
  const selectedAll = c.hunks ? dec.hunks.size === selectable.length && selectable.length > 0 : dec.file;
  const toggleFile = () => {
    if (lock) return;
    if (c.hunks) dec.hunks = selectedAll ? new Set() : new Set(selectable);
    else dec.file = !dec.file;
    renderContent(tab.group);
  };
  tab.views ||= {};
  const canPreview = (c.listing || isNote(c.path)) && !c.binary && (c.base != null || c.status === 'added');
  const canPen = penable(c) && !!pen;
  const view = canPreview ? tab.views[c.path] || (canPen && penFirst() ? 'pen' : 'diff') : 'diff';
  const head = h('div', { class: 'file-card-head' },
    h('input', { type: 'checkbox', checked: selectedAll, indeterminate: !!c.hunks && dec.hunks.size > 0 && !selectedAll, disabled: lock, onchange: toggleFile }),
    h('span', { class: `badge st-${c.status}` }, c.badge || c.status),
    h('span', { class: 'path' }, c.path),
    c.hunks ? h('span', { class: 'meta' }, `${dec.hunks.size}/${c.hunks.length} changes`) : null,
    canPreview ? h('div', { class: 'seg' }, [...(penable(c) ? ['pen'] : []), 'diff', 'result'].map((v) => h('button', { class: view === v ? 'on' : '',
      onclick: () => { tab.views[c.path] = v; loadPen().then(() => renderContent(tab.group)); } }, { pen: 'Red pen', diff: 'Diff', result: 'Result' }[v]))) : null,
    canOpen(c, tab) ? h('button', { class: 'btn small', onclick: () => openFile(c.path) }, 'Open') : null);
  const body = [];
  if (blocked) {
    body.push(h('div', { class: 'review-note warn' }, c.reserved ? 'The agent wrote to a reserved path; this change cannot be applied.'
      : c.status === 'added' ? 'A file with this name now exists in your workspace, so it will not be overwritten.'
        : 'This file changed in your workspace after the agent started and every proposed change overlaps your edits. Nothing here can be applied safely.'));
  } else if (c.stale && !locked) {
    body.push(h('div', { class: 'review-note warn' },
      `You edited this file while the agent worked. ${c.hunks.length - conflicts.size} of ${c.hunks.length} changes merge cleanly with your edits and can be applied; overlapping ones are locked.`));
  }
  if (view === 'pen' && pen) body.push(penPage(c, tab, lock));
  else if (view === 'result') {
    // Render the note as it would read with exactly the selected changes.
    const text = c.status === 'added' ? c.lines.join('\n') : applySelected(c.base, c.hunks, dec.hunks);
    const result = h('div', { class: 'preview md result-preview', html: renderMarkdown(text, { image: (url) => localImage(url, c.path) }) });
    renderDiagrams(result);
    body.push(result);
  } else if (c.binary) body.push(h('div', { class: 'review-note' }, 'Binary file — shown as a whole-file change.'));
  else if (c.hunks) body.push(...c.hunks.map((hk, i) => hunkView(c, hk, i, dec, lock, tab)));
  else {
    const sign = c.status === 'added' ? '+' : '−';
    const cls = c.status === 'added' ? 'add' : 'del';
    body.push(h('div', { class: 'diff' }, c.lines.map((l, i) => diffLine(cls, i + 1, sign, l))));
  }
  // Without hunks in view, the file itself is what the keys pick.
  const whole = !(c.hunks && (view === 'diff' || view === 'pen') && !c.binary);
  return h('div', { class: `file-card${blocked ? ' stale' : ''}${whole ? ' kb-item' : ''}`, 'data-path': c.path }, head, body);
}

// ------------------------------------------------------------------ red pen
// The changes drawn on the note as an editor marks a proof (redpen.js):
// struck through, written in above a caret, the agent's reasons in the
// margin. Each mark is a change of the run — y takes it, n leaves it — and
// is applied as from the diff. v switches every review between the two.

let pen = null;
const loadPen = () => (pen ? Promise.resolve(pen) : import('./redpen.js').then((m) => (pen = m)));
const penFirst = () => store.getItem('an.reviewView') !== 'diff';
const penable = (c) => (c.listing || isNote(c.path)) && !c.binary && c.status === 'modified' && c.base != null && !!c.hunks?.length;
const SVG_NS = 'http://www.w3.org/2000/svg';

// y taken, n left, open still to decide. Outside changes are kept until
// undone: open ones there are kept, but not looked at yet.
function markState(tab, path, m, lock) {
  const said = tab.pen?.[path]?.[m.key];
  if (m.kind === 'note') return said || 'open';
  const on = !!tab.decisions[path]?.hunks.has(m.i);
  if (tab.kind === 'outside') return !on ? 'n' : said === 'y' ? 'y' : 'open';
  return on ? 'y' : lock || said === 'n' ? 'n' : 'open';
}

function penPage(c, tab, lock) {
  const notes = (tab.run.comments || []).map((x, n) => ({ ...x, n })).filter((x) => x.file === c.path);
  // Changes inside a ```flow or ```ink block are drawn on its picture
  // (public/penpic.js); the rest of the note is marked as text.
  const hunks = c.hunks || [];
  const pics = pictureHunks(c.base, hunks);
  const placed = penPlaces(c.base, hunks, pics);
  const { text, marks, general } = pen.penSource(placed.base, placed.hunks, notes);
  for (const m of marks) m.line = m.kind === 'hunk' ? hunks[m.i].baseStart : placed.back[m.line] ?? m.line;
  const doc = pen.decorate(h('div', { class: 'pen-doc md', html: renderMarkdown(text, { image: (url) => localImage(url, c.path) }) }));
  const conflicts = new Set(lock ? [] : c.conflicts || []);
  const cards = marks.map((m) => {
    const st = markState(tab, c.path, m, lock);
    for (const el of doc.querySelectorAll(`[data-mark="${m.key}"]`)) el.classList.add(`pen-${st}`);
    const stuck = lock || conflicts.has(m.i);
    const what = m.kind === 'note' ? ['Noted', 'Dismiss'] : tab.kind === 'outside' ? ['Keep', 'Undo'] : ['Accept', 'Reject'];
    const drawn = m.picture != null;
    return h('div', { class: `pen-card kb-item pen-${st}${m.notes.length || drawn ? ' noted' : ''}`, 'data-path': c.path, 'data-hunk': m.key, 'data-mark': m.key, 'data-line': m.line + 1 },
      stuck ? null : h('div', { class: 'pen-acts' },
        h('button', { class: 'pen-yes', title: `${what[0]} (y)`, onclick: () => penDecide(tab, c.path, m.key, 'y', false) }, '✓'),
        h('button', { class: 'pen-no', title: `${what[1]} (n)`, onclick: () => penDecide(tab, c.path, m.key, 'n', false) }, '✗')),
      drawn ? h('div', { class: 'pen-note pen-pic-what' }, pictureSummary(pics[m.picture], m.i)) : null,
      m.notes.map((x) => h('div', { class: 'pen-note', title: x.comment || x.suggest },
        x.speaker ? h('span', { class: 'pen-who' }, `@${x.speaker}`) : null, x.time ? h('span', { class: 'pen-when' }, hhmm(x.time)) : null,
        x.comment || `→ ${x.suggest}`, x.replies?.length ? h('span', { class: 'pen-when' }, ` +${x.replies.length}`) : null)),
      conflicts.has(m.i) ? h('div', { class: 'pen-stuck' }, c.problems?.[m.i] || 'overlaps your edit') : null);
  });
  const page = h('div', { class: 'pen-page' },
    general.length ? h('div', { class: 'pen-general' }, general.map((x) => h('div', { class: 'pen-note' }, x.comment || x.suggest))) : null,
    h('div', { class: 'pen-body' }, doc, h('div', { class: 'pen-margin' }, cards)));
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('pen-lines');
  page.querySelector('.pen-body').append(svg);
  // A mark picks its margin note; links here only show where they go.
  doc.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.preventDefault();
    const mark = e.target.closest('[data-mark]');
    const card = mark && page.querySelector(`.pen-card[data-mark="${mark.dataset.mark}"]`);
    if (card) setReviewCur(tab, card, false);
  });
  // The pictures, where their placeholders are.
  const state = (key) => { const m = marks.find((x) => x.key === key); return m ? markState(tab, c.path, m, lock) : 'open'; };
  const body = page.querySelector('.pen-body');
  for (const p of [...doc.querySelectorAll('p')]) {
    const k = new RegExp(`^${PLACE}(\\d+)${PLACE}$`).exec(p.textContent.trim())?.[1];
    if (k != null && pics[k]) showPicture(p, pics[k], { state, render: renderDiagrams, drawn: () => pen.layoutMargin(body) });
  }
  pen.watchMargin(body);
  return page;
}

// A note the agent only wrote margin notes on (no change to it).
function remarksCard(path, base, tab) {
  return h('div', { class: 'file-card', 'data-path': path },
    h('div', { class: 'file-card-head' },
      h('span', { class: 'badge st-review' }, 'notes'),
      h('span', { class: 'path' }, path),
      h('button', { class: 'btn small', onclick: () => openFile(path) }, 'Open')),
    pen ? penPage({ path, base, hunks: [] }, tab, false) : null);
}

// y / n on a mark: a change taken or left (as x in the diff), a margin note
// seen or dismissed. From the keys it goes on to the next mark.
function penDecide(tab, path, key, said, next = true) {
  const finished = tab.kind === 'review' && !['review', 'failed', 'cancelled'].includes(tab.run?.status);
  if (finished) return;
  if (key[0] === 'h') {
    const c = tab.run.changes.find((x) => x.path === path);
    const i = Number(key.slice(1));
    if (!c || isBlocked(c) || (c.conflicts || []).includes(i)) { toast(c?.problems?.[i] ? `This one can’t be done: ${c.problems[i]}.` : 'This change overlaps your edit; it cannot be applied.', 'error'); return; }
    const d = tab.decisions[path];
    if (said === 'y') d.hunks.add(i); else d.hunks.delete(i);
  }
  ((tab.pen ||= {})[path] ||= {})[key] = said;
  const wrap = bufferEl(tab);
  if (next && wrap) {
    const items = reviewItems(wrap);
    const at = items.findIndex((el) => itemKey(el) === `${path}#${key}`);
    if (items[at + 1]) tab.cur = itemKey(items[at + 1]);
  }
  renderContent(tab.group);
  const cur = wrap && reviewItems(bufferEl(tab)).find((el) => itemKey(el) === tab.cur);
  if (cur) setReviewCur(tab, cur);
}

// The mark of the margin note in view stands out on the page.
function markCur(el) {
  const wrap = el.closest('[data-tab]') || el.closest('.review');
  wrap?.querySelectorAll('.pen-on').forEach((x) => x.classList.remove('pen-on'));
  if (el.dataset.mark) el.closest('.pen-page')?.querySelectorAll(`.pen-doc [data-mark="${el.dataset.mark}"]`).forEach((x) => x.classList.add('pen-on'));
  // The margin note in view shows all of itself: the ones below make room.
  const body = el.closest('.pen-body');
  if (pen && body && wrap) for (const b of wrap.querySelectorAll('.pen-body')) pen.layoutMargin(b);
}

// A run's new notes aren't in the workspace yet; notes deleted outside are gone.
const canOpen = (c, tab) => !c.listing && (tab.kind === 'outside' ? c.status !== 'deleted' : c.status !== 'added');

function applySelected(base, hunks, selected) {
  const a = base.split('\n');
  const out = [];
  let pos = 0;
  hunks.forEach((hk, i) => {
    out.push(...a.slice(pos, hk.baseStart), ...(selected.has(i) ? hk.added : a.slice(hk.baseStart, hk.baseEnd)));
    pos = hk.baseEnd;
  });
  return out.concat(a.slice(pos)).join('\n');
}

function selectedCount(tab) {
  let n = 0;
  for (const c of tab.run.changes) {
    const d = tab.decisions[c.path];
    if (isBlocked(c)) continue;
    n += c.hunks ? d.hunks.size : d.file ? 1 : 0;
  }
  return n;
}

const logTitle = (run) => (run.activity?.length ? `Activity · ${run.activity.length} step${run.activity.length === 1 ? '' : 's'}` : 'Agent log');
function logContent(run) {
  if (!run.activity?.length) return [h('pre', {}, run.log || (run.status === 'running' ? 'Waiting for output…' : '(no output)'))];
  const icon = { say: '💬', tool: '›', error: '⚠', text: '·' };
  return [h('ol', { class: 'activity' }, run.activity.map((a) => h('li', { class: `act-${a.kind}` }, h('span', { class: 'ic' }, icon[a.kind] || '·'), h('span', {}, a.text)))),
    h('details', { class: 'raw' }, h('summary', {}, 'Raw output'), h('pre', {}, run.log))];
}

// ------------------------------------------------------------------ dired
// A folder as text (Emacs's dired and wdired, dired.js): its names one to a
// line. j/k and Enter as in any buffer (a folder opens in place, ^ goes up);
// e edits the lines — a name changed renames, a path changed moves, a line
// deleted goes to the trash, a new line is a new note. ⌘S or C-c C-c shows
// what that would do as a review (red pen or diff, y/n each, a applies);
// nothing happens before. Links follow a renamed note, as with F2.

const diredPlace = (tab) => (tab.dir ? `${tab.dir}/` : `${S.info?.name || 'workspace'}/`);

async function openDired(dir = '', at = null) {
  const open = S.tabs.find((t) => t.kind === 'dired');
  if (open && open.mode !== 'list' && open.dir !== dir) {
    openSpecial('dired');
    toast(`Dired is being edited in ${diredPlace(open)}: ${kbd('save') || '⌘S'} to see the plan, C-c C-k to leave it`, 'error');
    return;
  }
  const tab = openSpecial('dired', { dir, mode: 'list', entries: null });
  if (tab.dir !== dir) { tab.dir = dir; tab.cur = null; }
  tab.mode = 'list';
  await refreshDired(tab, at);
}

function diredHere() {
  const doc = fileTab() || drawingTab();
  openDired(doc ? dirname(doc.path) : '', doc?.path || null);
}

function pickDiredFolder() {
  const here = dirname((fileTab() || drawingTab())?.path || '');
  const dirs = [...new Set(['', ...S.files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))), ...S.dirs])];
  dirs.sort((a, b) => (a === here ? -1 : b === here ? 1 : a.localeCompare(b)));
  picker({
    placeholder: 'Dired: which folder? (edit it as text)',
    source: (q) => dirs.map((d) => ({ d, name: d ? `${d}/` : `${S.info?.name || 'workspace'}/ (the top)`, m: fuzzy(q, d || '/') })).filter((x) => x.m)
      .sort((a, b) => (q ? b.m.score - a.m.score : 0)).slice(0, 200)
      .map((x) => ({ icon: '▤', label: x.name, hint: x.d === here ? 'this note’s folder' : '', run: () => openDired(x.d) })),
  });
}

async function refreshDired(tab, at = null) {
  if (tab.mode === 'plan') { await planDiredEdits(tab); return; }
  try { await loadTree(); } catch (e) { toast(e.message, 'error'); }
  tab.entries = dirListing(S.files.map((f) => f.path), S.dirs || [], tab.dir);
  try { tab.private = (await api('POST', '/api/private', { paths: tab.entries.map((e) => e.path) })).private; } catch { tab.private = {}; }
  if (at) tab.cur = `${at}#`;
  if (tab.mode === 'list' && S.groups[tab.group]?.active === tab.id) renderContent(tab.group);
}

function diredView(tab) {
  const wrap = h('div', { class: `review dired dired-${tab.mode}` });
  const hint = { list: 'j k · ↵ open · ^ up · e edit as text · R rename · g · q', edit: `${kbd('save') || '⌘S'} or C-c C-c: see the plan · C-c C-k: never mind`, plan: 'y n · A all · a apply · v red pen / diff · q back to editing' }[tab.mode];
  wrap.append(h('div', { class: 'review-head' },
    h('span', { class: 'badge st-review' }, 'dired'),
    h('div', { class: 'task' }, diredPlace(tab)),
    h('div', { class: 'meta' }, h('span', { class: 'review-keys', title: keysHint('dired') }, hint))));
  if (!tab.entries) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  if (tab.mode === 'edit') {
    wrap.append(h('div', { class: 'review-note' }, 'Edit the names as text. A name changed renames; a path changed moves (', h('code', {}, '../x.md'), ', ', h('code', {}, '/x.md'), ' from the top, ', h('code', {}, 'archive/'), ' into that folder); a line deleted goes to the trash; a new line is a new note (a folder, ending in /). Nothing happens until you have seen the plan.'),
      tab.ed.el);
    requestAnimationFrame(() => { if (tab.ed.el.isConnected && (tab.focusEd || document.activeElement === bufferEl(tab))) { tab.focusEd = false; tab.ed.focus(); } });
    return wrap;
  }
  if (tab.mode === 'plan') {
    const c = tab.run.changes[0];
    const dec = tab.decisions[c.path];
    const can = c.hunks.length - (c.conflicts?.length || 0);
    wrap.append(h('div', { class: 'review-actions' },
      h('span', { class: 'grow' }, `${c.hunks.length} change${c.hunks.length === 1 ? '' : 's'} · ${dec.hunks.size} taken${can < c.hunks.length ? ` · ${c.hunks.length - can} can’t be done` : ''}`),
      h('button', { class: 'btn', onclick: () => backToDiredEdit(tab) }, 'Back to editing'),
      h('button', { class: 'btn primary', disabled: !dec.hunks.size, onclick: () => applyDired(tab) }, `Apply ${dec.hunks.size}`)));
    wrap.append(fileCard(c, tab, false));
    return wrap;
  }
  const row = (e, up = false) => h('div', { class: `dired-row kb-item${e.folder ? ' folder' : ''}`, 'data-path': e.path, 'data-hunk': '', 'data-up': up ? '1' : null,
    ondblclick: () => diredOpen(tab, bufferEl(tab)?.querySelector('.kb-cur')) },
  h('span', { class: 'dired-icon' }, up ? '↰' : e.folder ? '▸' : isNote(e.path) ? '·' : '◦'),
  h('span', { class: 'dired-name' }, up ? '../' : e.name),
  tab.private?.[e.path] ? h('span', { class: 'dired-private', title: `Withheld from agents: ${tab.private[e.path]}` }, 'private') : null);
  const list = h('div', { class: 'dired-list' });
  if (tab.dir) list.append(row({ path: dirname(tab.dir), folder: true }, true));
  for (const e of tab.entries) list.append(row(e));
  if (!tab.entries.length) list.append(h('div', { class: 'empty' }, 'Nothing here yet. e: write names to make notes.'));
  wrap.append(list);
  return wrap;
}

function diredOpen(tab, el) {
  if (!el || tab.mode !== 'list') return;
  const e = el.dataset.up ? { path: el.dataset.path, folder: true } : tab.entries.find((x) => x.path === el.dataset.path);
  if (!e) return;
  if (e.folder) { const from = tab.dir; tab.dir = e.path; tab.cur = el.dataset.up ? `${from}#` : null; refreshDired(tab); return; }
  openFile(e.path);
}

function diredKeys(e, tab, at) {
  const k = e.key;
  const { cur } = at;
  if (tab.mode === 'plan') {
    if (k === 'q' || k === 'Escape' || k === 'e') { backToDiredEdit(tab); return true; }
    return reviewOwnKeys(e, tab, at);
  }
  if (tab.mode !== 'list') return false;
  if (k === '^' || k === '-' || k === 'Backspace') { if (tab.dir) { const from = tab.dir; tab.dir = dirname(tab.dir); tab.cur = `${from}#`; refreshDired(tab); } return true; }
  if (k === 'e' || k === 'i' || k === 'R') { editDired(tab, k === 'R' ? cur?.dataset.path : null); return true; }
  return false;
}

// wdired: the listing as text in an editor of its own.
function editDired(tab, select = null) {
  if (!tab.entries) return;
  tab.base = tab.entries.map((x) => x.name).join('\n');
  if (!tab.ed) {
    tab.ed = new MarkdownEditor({});
    tab.ed.setOptions({ highlight: false, spellcheck: false });
    tab.ed.el.classList.add('dired-ed');
    tab.ed.el.addEventListener('keydown', (e) => diredEditKeys(e, tab), true);
  }
  tab.ed.value = tab.entries.length ? `${tab.base}\n` : '';
  tab.mode = 'edit';
  tab.focusEd = true;
  renderContent(tab.group);
  // On the line the cursor was on (R: its name picked, as for F2).
  const at = tab.entries.findIndex((x) => `${x.path}#` === tab.cur);
  requestAnimationFrame(() => {
    if (at < 0) return;
    const start = tab.entries.slice(0, at).reduce((n, x) => n + x.name.length + 1, 0);
    const name = tab.entries[at].name;
    const end = select ? start + (tab.entries[at].folder ? name.length - 1 : name.replace(/\.[^.]+$/, '').length) : start;
    tab.ed.selectRange(start, end);
  });
}

function diredEditKeys(e, tab) {
  // C-c C-c: the plan; C-c C-k: never mind (as in wdired). The first C-c
  // is left alone (it copies, off a Mac).
  const ctrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (ctrl && tab.cc && Date.now() - tab.cc < 2000 && (e.code === 'KeyC' || e.code === 'KeyK')) {
    e.preventDefault();
    e.stopPropagation();
    tab.cc = 0;
    if (e.code === 'KeyC') planDiredEdits(tab); else leaveDiredEdit(tab);
    return;
  }
  tab.cc = ctrl && e.code === 'KeyC' ? Date.now() : 0;
  if (e.key === 'Escape' && !e.isComposing && !tab.ed.find.open) {
    e.preventDefault();
    if (tab.ed.value.trim() === tab.base.trim()) leaveDiredEdit(tab);
    else toast(`${kbd('save') || '⌘S'} or C-c C-c: see the plan · C-c C-k: never mind the edits`);
  }
}

function leaveDiredEdit(tab) {
  tab.mode = 'list';
  tab.run = null;
  tab.wantFocus = true;
  refreshDired(tab);
}

function backToDiredEdit(tab) {
  tab.mode = 'edit';
  tab.focusEd = true;
  renderContent(tab.group);
}

// The edits as a plan, looked at as a run is (fileCard): each change a
// hunk of the listing, what it does in the margin.
async function planDiredEdits(tab) {
  if (!tab.ed) return;
  try { await loadTree(); } catch { /* the list as it was */ }
  const all = new Set([...S.files.map((f) => f.path.toLowerCase()), ...(S.dirs || []).map((d) => d.toLowerCase())]);
  for (const f of S.files) { const parts = f.path.toLowerCase().split('/'); for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/')); }
  const plan = planDired(tab.dir, tab.entries, tab.ed.value, (p) => all.has(p.toLowerCase()));
  if (!plan.hunks.length) { toast('Nothing to do: the names are as they were'); leaveDiredEdit(tab); return; }
  // A note leaving a place .agentnotesignore keeps from agents (or coming into one).
  const moves = plan.hunks.flatMap((hk) => hk.ops).filter((o) => o.from && o.to);
  let priv = {};
  if (moves.length) try { priv = (await api('POST', '/api/private', { paths: [...new Set(moves.flatMap((o) => [o.from, o.to]))] })).private; } catch { priv = {}; }
  const path = diredPlace(tab);
  const says = {};
  const problems = {};
  const comments = [];
  const baseLines = plan.base.split('\n');
  plan.hunks.forEach((hk, i) => {
    let text = describeOps(hk.ops, tab.dir);
    for (const o of hk.ops) {
      if (!o.to || !o.from) continue;
      const was = priv[o.from] === '.agentnotesignore';
      const will = priv[o.to] === '.agentnotesignore';
      if (was && !will) text += ` · ⚠ withheld from agents now (.agentnotesignore), it wouldn’t be at ${o.to}`;
      if (!was && will) text += ' · it will be withheld from agents there (.agentnotesignore)';
    }
    if (hk.problem) problems[i] = hk.problem;
    says[i] = hk.problem ? '' : text;
    // On its mark in the margin: by the line it changes, when that line is only there.
    const comment = hk.problem ? `Can’t: ${hk.problem}` : text;
    const quote = hk.removed[0];
    if (quote && !baseLines.slice(0, hk.baseStart).some((l) => l.includes(quote))) comments.push({ file: path, quote, comment });
    else if (!quote && plan.hunks.findIndex((x) => x.added.join('\n').includes(hk.added[0])) === i) comments.push({ file: path, suggest: hk.added[0], comment });
    else comments.push({ file: path, comment: `Change ${i + 1}: ${comment}` });
  });
  const c = { path, status: 'modified', badge: 'plan', listing: true, base: plan.base, hunks: plan.hunks, plain: plainLine,
    conflicts: Object.keys(problems).map(Number), problems, says };
  tab.run = { status: 'review', changes: [c], comments };
  const pick = penFirst() ? [] : plan.hunks.map((_, i) => i).filter((i) => !problems[i]);
  tab.decisions = { [path]: { file: false, hunks: new Set(pick) } };
  tab.pen = {};
  tab.views = {};
  tab.cur = null;
  tab.mode = 'plan';
  tab.wantFocus = true;
  await loadPen();
  renderContent(tab.group);
  const first = reviewItems(bufferEl(tab) || document.createElement('div'))[0];
  if (first) setReviewCur(tab, first);
}

async function applyDired(tab) {
  const c = tab.run?.changes[0];
  if (!c) return;
  const picked = [...tab.decisions[c.path].hunks].filter((i) => !c.problems[i]).sort((a, b) => a - b);
  const ops = orderOps(picked.flatMap((i) => c.hunks[i].ops));
  if (!ops.length) { toast(penFirst() ? 'Nothing taken yet: y takes a change, A takes all' : 'Nothing picked: x picks a change'); return; }
  let done = 0;
  let links = 0;
  const failed = [];
  const trashed = [];
  for (const o of ops) {
    try {
      if (o.op === 'trash') {
        const open = S.tabs.find((t) => t.kind === 'file' && (t.path === o.from || t.path.startsWith(`${o.from}/`)) && t.content !== t.saved);
        if (open) throw new Error(`${open.path} has edits not saved yet`);
        trashed.push(await trashPath(o.from));
      } else if (o.op === 'folder') await api('POST', '/api/folder', { path: o.to });
      else if (o.op === 'note') await api('POST', '/api/file', { path: o.to });
      else links += (await movePath(o.from, o.to, o.folder)).updated.length;
      done++;
    } catch (e) { failed.push(`${o.from || o.to}: ${e.status === 409 ? 'something there already' : e.message}`); }
  }
  await loadTree();
  navPrune();
  updateNavButtons();
  persist();
  await syncOpenTabs();
  render();
  const msg = [`Dired: ${done} of ${ops.length} done`, links && `links updated in ${links} note${links === 1 ? '' : 's'}`, trashed.length && `${trashed.length} in the trash`, failed.length && `not done: ${failed.join('; ')}`].filter(Boolean).join(' · ');
  toast(msg, failed.length ? 'error' : '', trashed.length ? { label: 'Undo trash', run: () => restoreTrashed(trashed) } : null);
  tab.mode = 'list';
  tab.run = null;
  tab.wantFocus = true;
  await refreshDired(tab);
}

async function restoreTrashed(list) {
  for (const r of list) {
    try {
      await api('POST', '/api/restore', { trash: r.trash, path: r.path });
      if (r.marks.length) { S.bookmarks = [...S.bookmarks, ...r.marks.filter((b) => !S.bookmarks.includes(b))]; saveBookmarks(); }
    } catch (e) { toast(`${r.path}: ${e.message}`, 'error'); }
  }
  await loadTree();
  const t = S.tabs.find((x) => x.kind === 'dired');
  if (t?.mode === 'list') refreshDired(t);
}

// ------------------------------------------------------------------ describe
// Emacs's C-h k and C-h f: what a key does, or a command — what it is for,
// its keys (a shortcut, its ⌥X path, a buffer's key) and how to change
// them. Every command has a line on what it does (docs.js).

// What M-x knows about a command → what the help buffer shows.
function topicOf(cmd) {
  const kind = cmd.inBuffer ? cmd.ctx?.[0] : null;
  return {
    name: cmd.name,
    doc: commandDoc(cmd),
    shortcut: cmd.shortcut || null,
    prefix: cmd.prefix || null,
    leaders: leaderPaths(cmd.name, cmd.recipe ? cmd.name.replace(/^Recipe: /, '') : null),
    inBuffer: kind ? { kind, key: cmd.inBuffer } : null,
    recipe: !!cmd.recipe,
    macro: !!cmd.macro,
    alias: cmd.alias || null,
    emacsKey: cmd.emacsKey || null,
    emacsOnly: !!cmd.emacsOnly,
    run: cmd.run,
  };
}

function commandDoc(cmd) {
  if (cmd.recipe) {
    const r = recipes.list.find((x) => `Recipe: ${x.name}` === cmd.name);
    return r ? `Asks the agent, on a staged copy (${({ file: 'the note in view', folder: 'its folder', workspace: 'the workspace' })[r.scope] || 'you choose what it sees'}): “${r.prompt.length > 300 ? `${r.prompt.slice(0, 300)}…` : r.prompt}” What comes back is reviewed before it is applied.` : '';
  }
  if (cmd.inBuffer) {
    const kind = cmd.ctx?.[0];
    const own = docOf(cmd.name);
    return own || `In the ${SPECIAL[kind]?.title || kind} buffer, the key ${cmd.inBuffer}: ${cmd.name.replace(/^[^:]+: /, '').replace(/…$/, '')}.`;
  }
  return docOf(cmd.name) || cmd.doc || '';
}

// Where a command is under the leader: every path (yours from LEADER.md too).
function leaderPaths(name, recipe = null) {
  const out = [];
  const n = norm(name);
  const walk = (items, path, group) => {
    for (const it of items) {
      const keys = [...path, it.key];
      if (it.items) { walk(it.items, keys, it.label); continue; }
      const names = [it.cmd, it.label, group ? `${upper(group)}: ${it.label}` : null];
      if (names.some((x) => x && norm(x) === n) || (recipe && it.recipe?.name === recipe)) out.push({ keys, custom: it.custom || null, off: !!(it.when && !it.when()) });
    }
  };
  walk(leaderTree(), [], '');
  return out;
}

function openHelp(topic) {
  const had = S.tabs.find((t) => t.kind === 'help');
  if (had) had.topic = topic;
  const tab = openSpecial('help', { topic });
  renderContent(tab.group);
}

function runTopic(topic) {
  if (!topic?.run) { toast('This one is not a command to run from here'); return; }
  remember(topic.name, topic.run);
  topic.run();
}

// The command a shortcut runs, as M-x names it (or the shortcut's own).
function shortcutTopic(id) {
  const cmd = allCommands().find((c) => c.shortcut === id);
  if (cmd) return topicOf(cmd);
  const d = SHORTCUTS.find((x) => x.id === id);
  const name = d?.label || id;
  return {
    name, doc: docOf(name) || docOf(id) || `${name}.`, shortcut: id, leaders: leaderPaths(name),
    where: d?.scope === 'editor' ? 'in the editor' : d?.scope === 'find' ? 'while finding in a note' : d?.scope === 'menu' ? 'in the app menu' : null,
    run: ACTIONS[id] && d?.scope !== 'editor' && d?.scope !== 'find' ? () => runCommand(id) : null,
  };
}

// The item a leader path chose → its command.
function leaderTopic(it, keys) {
  const names = [it.cmd, it.label].filter(Boolean).map(norm);
  const cmd = allCommands().find((c) => names.includes(norm(c.name)) || (it.recipe && c.name === `Recipe: ${it.recipe.name}`) || (c.leader && c.leader.join(' ') === keys.join(' ')));
  if (cmd) return topicOf(cmd);
  return { name: it.label, doc: docOf(it.label) || docOf(it.cmd || '') || '', leaders: [{ keys, custom: it.custom || null }], run: it.run };
}

// ⌥X h k: the next key, described. The leader opens its menu, whose keys are
// then described instead of run.
function describeKey() {
  toast(`Describe a key: press it (${kbd('leader') || '⌥X'} for the leader’s keys; Esc: never mind)`);
  desktop?.recordingKeys?.(true);
  // With Emacs keys on, in the editor: their keys first, a prefix (C-x, ESC)
  // waiting for the rest.
  const inEditor = emacs.on && editorShown(activeTab());
  const seq = [];
  const onKey = (e) => {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key) || e.isComposing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (inEditor && !(e.key === 'Escape' && !seq.length)) {
      let name = emacsKeyName(e, isMac);
      if (name === 'C-g') { done(); return; }
      if (name && seq.at(-1) === 'ESC') { seq.pop(); name = name.startsWith('M-') ? null : `M-${name}`; }
      const keys = name && [...seq, name].join(' ');
      const cmd = keys && emacsCommandOf(keys);
      if (cmd && (EMACS_PREFIXES[cmd] || cmd === 'meta-prefix')) {
        seq.push(name);
        toast(`Describe a key: ${seq.join(' ')} …`);
        return;
      }
      if (cmd) { done(); openHelp(emacsTopic(cmd, keys)); return; }
      if (seq.length) { done(); openHelp({ name: [...seq, name || e.key].join(' '), unbound: true, doc: 'Nothing is on these keys in the editor.', leaders: [] }); return; }
    }
    done();
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Escape' && plain && !e.shiftKey) return;
    const k = eventKeys(e, isMac);
    if (k && k === KEYS.leader) { describeLeader(); return; }
    const ids = keyDefs().filter((d) => k && KEYS[d.id] === k).map((d) => d.id);
    if (ids.length) {
      // The note's own (find bar) keys only while finding: the other first.
      openHelp(shortcutTopic(ids.find((id) => SHORTCUTS.find((d) => d.id === id)?.scope !== 'find') || ids[0]));
      return;
    }
    const tab = activeTab();
    const pair = plain && tab && SPECIAL[tab.kind] && [...BUFFER_KEYS[tab.kind], ...COMMON_KEYS].find(([x]) => x === e.key);
    if (pair) {
      const cmd = allCommands().find((c) => c.inBuffer === pair[0]);
      if (cmd) { openHelp(topicOf(cmd)); return; }
    }
    openHelp({ name: keyLabel(k || '', isMac) || e.key, unbound: true, doc: 'Nothing is on this key here.', leaders: [] });
  };
  const done = () => {
    window.removeEventListener('keydown', onKey, true);
    desktop?.recordingKeys?.(false);
    $('#toast').hidden = true;
  };
  window.addEventListener('keydown', onKey, true);
}

// An Emacs key's command, for help: run on the note in view.
function emacsTopic(cmd, keys) {
  const tab = fileTab();
  const name = emacsName(cmd);
  // A Margin command of its own (save-buffer is Save): that one, with the key.
  const own = allCommands().find((c) => c.alias === name);
  if (own) return { ...topicOf(own), emacsKey: keys };
  return { name, doc: COMMAND_DOCS[cmd] || '', emacsKey: keys, emacsOnly: true, leaders: [], run: tab?.editor ? () => emacsRun(tab, cmd) : null };
}

function describeLeader() {
  const map = (items, path) => items.map((it) => (it.items ? { ...it, items: map(it.items, [...path, it.key]) }
    : { ...it, run: () => openHelp(leaderTopic(it, [...path, it.key])) }));
  openLeader(map(leaderTree(), []), {
    title: `Describe: ${kbd('leader') || 'Commands'}`,
    isLeader: (e) => !!KEYS.leader && eventKeys(e, isMac) === KEYS.leader,
    onLeader: () => openHelp(shortcutTopic('leader')),
  });
}

// ⌥X h c: a command by name (M-x's list), described.
function describeCommand() {
  const tab = activeTab();
  const context = tab?.kind === 'file' ? 'file' : tab?.kind || '';
  picker({
    placeholder: 'Describe a command…',
    source: (q) => rankCommands(allCommands(), q, { recent: mxRecent, context }).slice(0, 200).map(({ cmd, m }) => {
      const doc = commandDoc(cmd);
      return { icon: cmd.inBuffer ? '◆' : cmd.recipe ? '✦' : '', label: marked(cmd.name, m.idx), hint: doc.length > 70 ? `${doc.slice(0, 68)}…` : doc, run: () => openHelp(topicOf(cmd)) };
    }),
  });
}

function helpView(tab) {
  const t = tab.topic || { name: 'Help', doc: '', leaders: [] };
  const L = kbd('leader') || '⌥X';
  const wrap = h('div', { class: 'review help' });
  wrap.append(h('div', { class: 'review-head' },
    h('span', { class: 'badge st-review' }, t.unbound ? 'key' : t.recipe ? 'recipe' : t.macro ? 'macro' : 'command'),
    h('div', { class: 'task' }, t.name),
    h('div', { class: 'meta' }, h('span', { class: 'review-keys', title: keysHint('help') }, `${t.run ? 'o run it · ' : ''}a change it · k a key · c a command · l leader keys · q`))));
  wrap.append(h('p', { class: 'help-doc' }, t.doc || 'No description yet.'));
  const keys = [];
  if (t.shortcut && kbd(t.shortcut)) keys.push(h('li', {}, h('kbd', {}, kbd(t.shortcut)), t.where ? ` ${t.where}` : '', ' — a shortcut: change it in Settings › Keyboard shortcuts.'));
  if (t.prefix) keys.push(h('li', {}, 'Quick open with ', h('kbd', {}, t.prefix), ' first.'));
  if (t.emacsKey) keys.push(h('li', {}, h('kbd', {}, t.emacsKey), ' — in the editor, with Emacs keys on (Settings).'));
  if (t.alias) keys.push(h('li', {}, h('kbd', {}, `${L} : ${t.alias}`), ' — by its name in Emacs (M-x).'));
  for (const p of t.leaders || []) {
    keys.push(h('li', {}, h('kbd', {}, `${L} ${p.keys.join(' ')}`),
      p.custom ? ` — yours, from ${LEADER_FILE} line ${p.custom}.` : ` — under the leader${p.off ? ' (not here: it needs a note, or a selection, in view)' : ''}.`));
  }
  if (t.inBuffer) keys.push(h('li', {}, h('kbd', {}, t.inBuffer.key), ` — in the ${SPECIAL[t.inBuffer.kind]?.title || t.inBuffer.kind} buffer.`));
  if (!t.unbound) keys.push(h('li', {}, h('kbd', {}, `${L} :`), ' — by name, as every command (M-x).'));
  wrap.append(h('h3', {}, 'Keys'), keys.length ? h('ul', { class: 'help-keys' }, keys) : h('p', {}, 'None.'));
  const example = `- \`o x\` ${t.name}`;
  wrap.append(h('h3', {}, 'To change them'),
    h('p', {}, t.emacsOnly ? 'Emacs keys are as Emacs has them, not changed one by one: turn them all off in Settings › Editor.'
      : t.unbound ? `Put a command on it: a shortcut in Settings › Keyboard shortcuts, or a key after ${L} in ${LEADER_FILE}.`
        : `A key after ${L} of your own (or one taken away, or moved) is a line in ${LEADER_FILE}, a note in this folder:`),
    ...(t.unbound || t.emacsOnly ? [] : [h('pre', { class: 'help-example' }, example)]),
    h('div', { class: 'help-actions' },
      t.run ? h('button', { class: 'btn primary', onclick: () => runTopic(t) }, 'Run it') : null,
      h('button', { class: 'btn', title: `Say how, and the agent writes it in ${LEADER_FILE}, ${RECIPES_FILE} or ${MACROS_FILE}: you review it first`, onclick: () => changeByAgent(t) }, 'Change it… (ask the agent)'),
      h('button', { class: 'btn', onclick: editLeaderKeys }, `Edit leader keys (${LEADER_FILE})`),
      h('button', { class: 'btn', onclick: () => openSettings({ keys: true }) }, 'Keyboard shortcuts…'),
      h('button', { class: 'btn', onclick: describeKey }, 'Describe a key…'),
      h('button', { class: 'btn', onclick: describeCommand }, 'Describe a command…')));
  return wrap;
}

function helpOwnKeys(e, tab) {
  if (e.key === 'k') { describeKey(); return true; }
  if (e.key === 'c') { describeCommand(); return true; }
  if (e.key === 'l') { editLeaderKeys(); return true; }
  if (e.key === 'a') { changeByAgent(tab?.topic); return true; }
  return false;
}

// ------------------------------------------------------------------ special buffers
// What Margin shows that isn't a file — a run to review, changes from
// outside, tasks, search results, agent runs, messages, a note's history —
// is a buffer as a note is (Emacs's *special* buffers): a tab, in the buffer
// list (⌥X b b, which opens the ones not open yet too) and in ⌥X `. They
// take the same keys: j/k (n/p, ↑↓) move, < > (Home, End, G) go to the first
// and the last, Enter or o opens, g refreshes, q closes. Their own keys are
// in M-x while one is in view. A redraw keeps the place, the scroll and the
// focus.
const SPECIAL = {
  review: { name: (t) => `Review: ${t.title}`, title: 'Review', view: reviewView, refresh: refreshReview, keys: reviewOwnKeys, open: openChangeAt },
  outside: { name: () => '↯ Changed outside', title: 'Changed outside', view: outsideView, refresh: refreshOutside, keys: reviewOwnKeys, open: openChangeAt, make: openOutside },
  tasks: { name: () => '☐ Tasks', title: 'Tasks', view: tasksView, refresh: refreshTasks, keys: tasksOwnKeys, open: openTaskAt, make: openTasks },
  search: { name: () => `⌕ ${S.searchQuery.trim() ? `Search: ${S.searchQuery.trim()}` : 'Search'}`, title: 'Search', view: searchView, refresh: () => runSearch(), keys: searchOwnKeys, open: (t, el) => el && openSearchHit(Number(el.dataset.hunk)), make: openSearchBuffer },
  runs: { name: () => '✦ Agent runs', title: 'Agent runs', view: runsView, refresh: () => loadRuns(), keys: runsOwnKeys, open: (t, el) => el && openReview(el.dataset.path), make: openRuns },
  messages: { name: () => '✉ Messages', title: 'Messages', view: messagesView, refresh: (t) => renderContent(t.group), open: copyMessageAt, make: openMessages },
  history: { name: (t) => `History: ${stem(t.path)}`, title: 'History', view: historyView, refresh: (t) => openHistory(t.path), keys: historyOwnKeys, open: (t) => openFile(t.path) },
  gitdiff: { name: (t) => `Δ ${basename(t.path)}`, title: 'Changes since commit', view: gitDiffView, refresh: (t) => openGitDiff(t.path), open: (t) => t.data?.status !== 'deleted' && openFile(t.path) },
  dired: { name: (t) => `▤ ${t.dir ? `${t.dir}/` : 'Dired'}`, title: 'Dired', view: diredView, refresh: (t) => refreshDired(t), keys: diredKeys, open: diredOpen, make: () => diredHere() },
  help: { name: (t) => `? ${t.topic?.name || 'Help'}`, title: 'Help', view: helpView, refresh: (t) => renderContent(t.group), keys: helpOwnKeys, open: (t) => runTopic(t.topic) },
  occur: { name: (t) => `≡ Occur: ${t.query}`, title: 'Occur', view: occurView, refresh: refreshOccur, open: openOccurAt },
};
// Each one's own keys, for M-x and the hint in its head.
const BUFFER_KEYS = {
  review: [['y', 'Red pen: accept the change'], ['n', 'Red pen: reject the change'], ['v', 'Red pen / diff'], ['x', 'Pick / unpick the change'], ['X', 'Pick / unpick the whole note'], ['A', 'Pick all'], ['U', 'Pick none'], ['a', 'Apply the picked changes'], ['d', 'Discard the run'], ['f', 'Follow up…'], ['u', 'Revert the applied run'], ['=', 'Diff / result'], ['l', 'Show / hide the log'], ['J', 'Next note'], ['K', 'Previous note']],
  outside: [['y', 'Red pen: keep the change'], ['n', 'Red pen: undo the change'], ['v', 'Red pen / diff'], ['x', 'Keep / undo the change'], ['X', 'Keep / undo the whole note'], ['A', 'Keep all'], ['U', 'Keep none'], ['a', 'Done: undo the ones not kept'], ['=', 'Diff / result'], ['J', 'Next note'], ['K', 'Previous note']],
  tasks: [['x', 'Check off / again'], ['a', 'Ask the agent to do it'], ['h', 'Show / hide done ones']],
  search: [['/', 'Search for…']],
  runs: [['t', 'New task…'], ['v', 'Review the next run']],
  messages: [],
  history: [['R', 'Restore this version…']],
  gitdiff: [],
  dired: [['^', 'Up a folder'], ['e', 'Edit the names as text (wdired)'], ['R', 'Rename this one (edit, its name picked)'], ['y', 'Plan: take the change'], ['n', 'Plan: leave the change'], ['A', 'Plan: take all'], ['a', 'Plan: apply what is taken']],
  help: [['a', 'Change it… (ask the agent)'], ['k', 'Describe a key…'], ['c', 'Describe a command…'], ['l', 'Edit leader keys']],
  occur: [],
};
const COMMON_KEYS = [['o', 'Open'], ['g', 'Refresh'], ['q', 'Close']];

function openSpecial(kind, init = {}) {
  let tab = S.tabs.find((t) => t.kind === kind);
  if (!tab) { tab = { id: kind, kind, group: S.focus, ...init }; S.tabs.push(tab); }
  tab.wantFocus = true;
  activate(tab.id);
  return tab;
}

function showSpecial(c, tab) {
  const old = c.firstElementChild;
  const same = old?.dataset.tab === tab.id;
  const had = old?.contains(document.activeElement);
  const top = old?.scrollTop;
  const wrap = SPECIAL[tab.kind].view(tab);
  wrap.dataset.tab = tab.id;
  wrap.tabIndex = 0;
  wrap.addEventListener('keydown', (e) => bufferKeys(e, tab));
  wrap.addEventListener('mousedown', (e) => { const it = e.target.closest('.kb-item'); if (it) setReviewCur(tab, it, false); });
  c.replaceChildren(wrap);
  if (pen) wrap.querySelectorAll('.pen-body').forEach(pen.layoutMargin);
  if (same) wrap.scrollTop = top;
  const cur = reviewItems(wrap).find((el) => itemKey(el) === tab.cur);
  if (cur) { cur.classList.add('kb-cur'); markCur(cur); }
  if ((same && had) || tab.wantFocus) { tab.wantFocus = false; wrap.focus({ preventScroll: true }); }
}
// Drawn again if in view (a list that changed underneath).
function redrawSpecial(kind) {
  for (const t of S.tabs) if (t.kind === kind && S.groups[t.group]?.active === t.id) renderContent(t.group);
}
const bufferEl = (tab) => paneEl(tab.group)?.querySelector(`[data-tab="${CSS.escape(tab.id)}"]`);
// A buffer's key, from M-x: as if pressed in it.
function pressBufferKey(tab, key) {
  const el = bufferEl(tab);
  el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
const keysHint = (kind) => ['j / k  next / previous', '< / >  first / last', ...[...COMMON_KEYS, ...BUFFER_KEYS[kind]].map(([k, l]) => `${k}  ${l}`)].join('\n');

const reviewItems = (wrap) => [...wrap.querySelectorAll('.kb-item')];
const itemKey = (el) => `${el.dataset.path}#${el.dataset.hunk ?? ''}`;

function setReviewCur(tab, el, reveal = true) {
  const wrap = el.closest('[data-tab]') || el.closest('.review');
  wrap.querySelectorAll('.kb-cur').forEach((x) => x.classList.remove('kb-cur'));
  el.classList.add('kb-cur');
  markCur(el);
  tab.cur = itemKey(el);
  if (!reveal) return;
  // The head of the change in view, below the sticky actions bar.
  const bar = wrap.querySelector('.review-actions')?.getBoundingClientRect().bottom ?? wrap.getBoundingClientRect().top;
  const r = el.getBoundingClientRect();
  const view = wrap.getBoundingClientRect();
  if (r.top < bar + 4) wrap.scrollTop -= bar + 8 - r.top;
  else if (r.top > view.bottom - 80) wrap.scrollTop += r.top - bar - 8;
}

function bufferKeys(e, tab) {
  const wrap = e.currentTarget;
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if (e.target !== wrap && (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || ((e.key === 'Enter' || e.key === ' ') && /BUTTON|SUMMARY|A/.test(e.target.tagName)))) return;
  const spec = SPECIAL[tab.kind];
  const items = reviewItems(wrap);
  const i = items.findIndex((el) => itemKey(el) === tab.cur);
  const at = { wrap, items, i, cur: items[i] };
  if (spec.keys?.(e, tab, at)) { e.preventDefault(); return; }
  const go = (el) => { if (el) setReviewCur(tab, el); };
  const k = e.key;
  if (k === 'j' || k === 'n' || k === 'ArrowDown') { if (items.length) go(items[Math.min(i + 1, items.length - 1)]); else wrap.scrollBy({ top: 60 }); }
  else if (k === 'k' || k === 'p' || k === 'ArrowUp') { if (items.length) go(items[Math.max(i - 1, 0)]); else wrap.scrollBy({ top: -60 }); }
  else if (k === '<' || k === 'Home') { if (items.length) go(items[0]); else wrap.scrollTop = 0; }
  else if (k === '>' || k === 'End' || k === 'G') { if (items.length) go(items.at(-1)); else wrap.scrollTop = wrap.scrollHeight; }
  else if (k === 'Enter' || k === 'o') spec.open?.(tab, at.cur);
  else if (k === 'g' || k === 'r') spec.refresh?.(tab);
  else if (k === 'q') closeTab(tab.id).then(focusEditor);
  else return;
  e.preventDefault();
}

// Reviewing by keyboard (as in magit): x picks a change, a applies.
function reviewOwnKeys(e, tab, { wrap, items, cur }) {
  const reviewable = ['review', 'failed', 'cancelled'].includes(tab.run?.status);
  const outside = tab.kind === 'outside';
  const own = tab.kind !== 'review'; // changes from outside, a dired plan: not a run
  const go = (el) => { if (el) setReviewCur(tab, el); };
  const fileOf = (el) => el?.closest('.file-card');
  const onPen = cur?.classList.contains('pen-card');
  switch (e.key) {
    case 'y': case 'n':
      if (!onPen) return e.key === 'y';
      penDecide(tab, cur.dataset.path, cur.dataset.mark, e.key);
      return true;
    case 'v':
      store.setItem('an.reviewView', penFirst() ? 'diff' : 'pen');
      tab.views = {};
      loadPen().then(() => renderContent(tab.group));
      return true;
    case 'J': case 'K': {
      const cards = [...wrap.querySelectorAll('.file-card')];
      const at = cards.indexOf(fileOf(cur));
      const card = cards[e.key === 'J' ? Math.min(at + 1, cards.length - 1) : Math.max(at - 1, 0)];
      go(card && (card.classList.contains('kb-item') ? card : card.querySelector('.kb-item')));
      return true;
    }
    case 'x': case ' ':
      if (!cur) { go(items[0]); return true; }
      if (onPen) penDecide(tab, cur.dataset.path, cur.dataset.mark, cur.classList.contains('pen-y') ? 'n' : 'y', false);
      else if (cur.classList.contains('hunk')) cur.querySelector('.hunk-head').click();
      else fileOf(cur)?.querySelector('.file-card-head input[type=checkbox]')?.click();
      return true;
    case 'X': fileOf(cur)?.querySelector('.file-card-head input[type=checkbox]')?.click(); return true;
    case 'A': case 'U': {
      if (!reviewable) return true;
      for (const c of tab.run.changes) {
        const d = tab.decisions[c.path];
        if (isBlocked(c)) continue;
        if (c.hunks) d.hunks = e.key === 'A' ? new Set(c.hunks.map((_, k) => k).filter((k) => !(c.conflicts || []).includes(k))) : new Set();
        else d.file = e.key === 'A';
        // On the proof: all taken, or all waiting again.
        const said = tab.pen?.[c.path];
        if (said) for (const k of Object.keys(said)) if (k[0] === 'h') delete said[k];
        if (e.key === 'A' && c.hunks) for (const k of d.hunks) ((tab.pen ||= {})[c.path] ||= {})[`h${k}`] = 'y';
      }
      renderContent(tab.group);
      return true;
    }
    case 'a': if (outside) keepOutside(tab); else if (tab.kind === 'dired') applyDired(tab); else if (reviewable && tab.run.changes.length && selectedCount(tab)) applyRun(tab); return true;
    case 'd': if (reviewable && !own) discardRun(tab); return true;
    case 'f': if (reviewable && !own) followUp(tab); return true;
    case 'u': if (tab.run?.status === 'applied') revertRun(tab); return true;
    case 'l': { const log = wrap.querySelector('details.log'); if (log) log.open = !log.open; return true; }
    case '=': {
      const seg = fileOf(cur)?.querySelector('.seg button:not(.on)');
      if (!seg) return true;
      const c = tab.run.changes.find((x) => x.path === cur.dataset.path);
      tab.cur = `${c.path}#${seg.textContent === 'Diff' && c.hunks?.length ? 0 : seg.textContent === 'Red pen' ? 'h0' : ''}`;
      seg.click();
      return true;
    }
    default: return false;
  }
}

function historyOwnKeys(e, tab) {
  const n = tab.commits?.length || 0;
  const to = { j: 1, n: 1, ArrowDown: 1, k: -1, p: -1, ArrowUp: -1 }[e.key];
  const at = to ? tab.sel + to : ['<', 'Home'].includes(e.key) ? 0 : ['>', 'End', 'G'].includes(e.key) ? n - 1 : null;
  if (at != null) {
    if (n) selectVersion(tab, Math.max(0, Math.min(n - 1, at))).then(() => bufferEl(tab)?.querySelector('.history-row.sel')?.scrollIntoView({ block: 'nearest' }));
    return true;
  }
  const v = tab.version;
  if (e.key === 'R') { if (v?.hunks?.length) restoreVersion(tab.path, v.commit.hash || '', v.content, v.commit.local ? timeAgo(v.commit.date) : null); return true; }
  return false;
}

// The workspace search as a buffer: the same search as the sidebar's (F8
// steps through it), with room for the results.
function openSearchBuffer() {
  const tab = openSpecial('search');
  if (!S.searchQuery.trim()) requestAnimationFrame(() => bufferEl(tab)?.querySelector('input')?.focus());
}
function searchView(tab) {
  const wrap = h('div', { class: 'review buffer-list search-buffer' });
  const input = h('input', { class: 'input', placeholder: 'Search the workspace', value: S.searchQuery, spellcheck: false,
    oninput: (e) => { S.searchQuery = e.target.value; runSearch(); },
    onkeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        wrap.focus({ preventScroll: true });
        const first = reviewItems(wrap)[0];
        if (first && e.key !== 'Escape') setReviewCur(tab, first);
      }
    } });
  wrap.append(h('div', { class: 'review-head' },
    h('div', { class: 'task' }, 'Search'),
    h('div', { class: 'search-box' }, input),
    h('div', { class: 'meta' }, h('span', { class: 'search-count' }), h('span', { class: 'review-keys', title: keysHint('search') }, 'j k · o open · / search · g again · q close'))),
  h('div', { class: 'search-buffer-list' }));
  fillSearchList(tab, wrap);
  return wrap;
}
function fillSearchList(tab, wrap) {
  const list = wrap.querySelector('.search-buffer-list');
  const r = S.searchResults;
  const rows = [];
  let n = 0;
  for (const f of r?.results || []) {
    rows.push(h('div', { class: 'search-file', title: f.path }, h('span', {}, f.path), h('span', { class: 'count' }, f.matches.length || '')));
    for (const m of f.matches) {
      const i = n++;
      rows.push(h('div', { class: 'search-hit kb-item', 'data-path': f.path, 'data-hunk': i, 'data-line': m.line, onclick: () => openSearchHit(i) },
        h('span', { class: 'ln' }, m.line), highlight(m.text.trim(), S.searchQuery)));
    }
  }
  if (!rows.length) rows.push(h('div', { class: 'empty' }, !r ? 'Type to search file names and contents.' : 'No matches.'));
  if (r?.truncated) rows.push(h('div', { class: 'empty' }, 'Results truncated — refine your query.'));
  list.replaceChildren(...rows);
  wrap.querySelector('.search-count').textContent = r ? `${n} result${n === 1 ? '' : 's'} in ${r.results.length} file${r.results.length === 1 ? '' : 's'}` : '';
  const cur = reviewItems(wrap).find((el) => itemKey(el) === tab.cur);
  if (cur) cur.classList.add('kb-cur');
}
// New results: in the search buffer too, without drawing its box again.
function searchChanged() {
  const tab = S.tabs.find((t) => t.kind === 'search');
  if (!tab) return;
  renderTabs();
  const el = bufferEl(tab);
  if (el) fillSearchList(tab, el);
}
function searchOwnKeys(e, tab) {
  if (e.key !== '/') return false;
  const input = bufferEl(tab)?.querySelector('input');
  input?.focus();
  input?.select();
  return true;
}

// The agent's runs, newest first; o opens one for review.
function openRuns() { openSpecial('runs'); loadRuns(); }
function runsView() {
  const wrap = h('div', { class: 'review buffer-list runs-buffer' });
  const waiting = S.runs.filter((r) => r.status === 'review').length;
  wrap.append(h('div', { class: 'review-head' },
    h('div', { class: 'task' }, 'Agent runs'),
    h('div', { class: 'meta' }, h('span', {}, `${S.runs.length} run${S.runs.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} waiting for review` : ''}`),
      h('span', { class: 'review-keys', title: keysHint('runs') }, 'j k · o review · t new task · v next · q close'))));
  if (!S.runs.length) wrap.append(h('div', { class: 'review-note' }, `No runs yet. ${kbd('delegate') || '⌥X a a'} gives the agent a task; recipes are in ⌥X r.`));
  for (const r of S.runs) {
    wrap.append(h('div', { class: 'run-row kb-item', 'data-path': r.id, onclick: () => openReview(r.id) },
      h('div', { class: 'task', title: r.task }, r.recipe ? h('b', {}, `${r.recipe} · `) : null, r.task.replace(/\s+/g, ' ').slice(0, 200)),
      h('div', { class: 'meta' }, h('span', { class: `badge st-${r.status}` }, r.status), h('span', {}, r.focus ? stem(r.focus) : r.scope), h('span', {}, r.agent || ''), h('span', {}, timeAgo(r.startedAt)))));
  }
  return wrap;
}
function runsOwnKeys(e) {
  if (e.key === 't') { openTaskDialog(); return true; }
  if (e.key === 'v') { reviewNext(); return true; }
  return false;
}

// Every message shown (Emacs's *Messages*), newest first; o copies one.
function openMessages() { openSpecial('messages'); }
function messagesView() {
  const wrap = h('div', { class: 'review buffer-list messages-buffer' });
  wrap.append(h('div', { class: 'review-head' },
    h('div', { class: 'task' }, 'Messages'),
    h('div', { class: 'meta' }, h('span', {}, `${messages.length} this session (kept in memory only)`),
      h('span', { class: 'review-keys', title: keysHint('messages') }, 'j k · o copy · q close'))));
  if (!messages.length) wrap.append(h('div', { class: 'review-note' }, 'No messages yet.'));
  for (const m of messages.slice().reverse()) {
    wrap.append(h('div', { class: `message-row kb-item${m.kind === 'error' ? ' error' : ''}`, 'data-path': String(m.seq) },
      h('span', { class: 'message-time' }, m.at.toTimeString().slice(0, 8)), h('span', { class: 'message-text' }, m.msg)));
  }
  return wrap;
}
function copyMessageAt(tab, el) {
  const m = el && messages.find((x) => String(x.seq) === el.dataset.path);
  if (m) navigator.clipboard.writeText(m.msg).then(() => { el.classList.add('copied'); setTimeout(() => el.classList.remove('copied'), 600); });
}

function openChangeAt(tab, cur) {
  const c = cur && tab.run?.changes.find((x) => x.path === cur.dataset.path);
  if (c && canOpen(c, tab)) openFile(c.path, { line: Number(cur.dataset.line) || undefined });
}

function reviewView(tab) {
  const run = tab.run;
  const wrap = h('div', { class: `review${run?.kind === 'proof' ? ' mine' : ''}` });
  if (!run) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  const reviewable = ['review', 'failed', 'cancelled'].includes(run.status);
  const took = run.finishedAt ? `${Math.max(1, Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000))}s` : null;

  const proof = run.kind === 'proof';
  wrap.append(h('div', { class: 'review-head' },
    h('span', { class: `badge st-${run.status}` }, run.status),
    h('div', { class: 'task' }, run.task),
    proof ? h('div', { class: 'meta' }, h('span', {}, 'by you (suggesting)'), h('span', {}, `started ${timeAgo(run.startedAt)}`)) : h('div', { class: 'meta' },
      h('span', {}, `agent: ${run.agent}`),
      run.liveModel || run.resolvedModel || run.model ? h('span', {}, `model: ${run.liveModel || run.resolvedModel || run.model}`) : null,
      run.usage ? h('span', { title: usageTitle(run.usage) }, usageText(run.usage)) : null,
      h('span', {}, `scope: ${run.scope}${run.focus ? ` (${run.focus})` : ''}`),
      run.selection ? h('span', {}, `selection: ${run.selection} chars`) : null,
      h('span', { title: [...run.files, ...(run.pictures || [])].join('\n') }, `shared ${run.files.length} note${run.files.length === 1 ? '' : 's'}${run.pictures?.length ? `, ${run.pictures.length} picture${run.pictures.length === 1 ? '' : 's'}` : ''}`),
      run.excluded?.length ? h('span', { title: run.excluded.map((x) => x.path).join('\n') }, `withheld ${run.excluded.length} private`) : null,
      h('span', {}, `started ${timeAgo(run.startedAt)}`),
      took ? h('span', {}, `took ${took}`) : null,
      run.exitCode != null ? h('span', {}, `exit ${run.exitCode}`) : null,
      run.parent ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); openReview(run.parent); } }, 'previous round') : null)));

  if (run.status === 'running') {
    wrap.append(h('div', { class: 'review-actions' },
      h('span', { class: 'grow' }, 'Agent is working on a staged copy… your notes are untouched.'),
      h('button', { class: 'btn danger', onclick: () => api('POST', `/api/runs/${run.id}/cancel`).then(() => refreshReview(tab)).catch((e) => toast(e.message, 'error')) }, 'Cancel')));
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    wrap.append(h('div', { class: 'review-note warn' }, `The agent ${run.status === 'failed' ? `exited with an error${run.cancelReason ? ` (${run.cancelReason})` : ''}` : `was cancelled${run.cancelReason ? ` (${run.cancelReason})` : ''}`}. Any changes it made are still shown for review; check the log.`));
    const lastLine = run.error || run.activity?.at(-1)?.text || String(run.log || '').trim().split('\n').pop();
    if (run.status === 'failed' && lastLine) wrap.append(h('div', { class: 'review-note' }, h('code', {}, lastLine.slice(0, 300))));
    // CLI agents keep their own sign-in; the most common failure is an expired one.
    if (run.status === 'failed' && /authenticat|oauth|not logged in|log ?in required|api key|unauthori[sz]ed|\b401\b/i.test(`${run.log}\n${run.error}`)) {
      wrap.append(h('div', { class: 'review-note warn' }, 'The agent’s CLI is not signed in (or its sign-in expired). Sign in once in Terminal — e.g. ', h('code', {}, 'claude auth login'), ' or ', h('code', {}, 'codex login'), ' — then run the task again.'));
    }
  }
  if (run.status === 'applied') {
    const a = run.applied;
    wrap.append(h('div', { class: 'review-note ok' },
      `Applied ${timeAgo(a.at)}: ${a.files.map((f) => (f.hunks ? `${f.path} (${f.hunks.length}/${f.of} changes${f.merged ? ', merged with your edits' : ''})` : `${f.path} (${f.status})`)).join(', ')}.`,
      a.skipped?.length ? ` Skipped: ${a.skipped.map((s) => s.path).join(', ')}.` : '',
      a.commit ? ` Committed as ${a.commit}.` : '',
      ' ',
      h('button', { class: 'btn small', onclick: () => revertRun(tab) }, 'Undo apply')));
  }
  if (run.status === 'reverted') wrap.append(h('div', { class: 'review-note' }, `Applied, then undone ${timeAgo(run.revertedAt)}. Your files were restored.`));
  if (run.status === 'discarded') wrap.append(h('div', { class: 'review-note' }, 'Discarded. Nothing was applied.'));
  if (run.status === 'superseded') wrap.append(h('div', { class: 'review-note' }, 'Superseded by a follow-up round. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); openReview(run.child); } }, 'Open the latest round')));

  // What the agent said at the end — often the answer itself.
  if (run.reply && run.status !== 'running') {
    wrap.append(h('div', { class: 'agent-reply' }, h('div', { class: 'label' }, 'Agent says'),
      h('div', { class: 'md', html: renderMarkdown(run.reply), onclick: (e) => {
        // Paths the agent mentions are the same in the workspace.
        const a = e.target.closest('a.internal');
        if (!a) return;
        e.preventDefault();
        followLink(a.dataset.target || a.dataset.href, run.focus || '');
      } })));
  }

  const log = h('details', { class: 'log' }, h('summary', {}, logTitle(run)), h('div', { class: 'log-body' }, ...logContent(run)));
  const quiet = run.status !== 'running' && !run.changes?.length && !run.reply;
  log.open = tab.logOpen ?? (run.status === 'running' || quiet);
  log.addEventListener('toggle', () => { tab.logOpen = log.open; });
  if (run.kind !== 'proof') wrap.append(log);

  if (run.status !== 'running') {
    const remarks = Object.entries(run.commentBases || {});
    if (!run.changes.length) wrap.append(h('div', { class: 'review-note' }, run.kind === 'proof' ? 'No suggestions (yet).' : remarks.length ? 'The agent made no changes, only notes in the margin.' : 'The agent made no changes.'));
    const checked = reviewable && commandNotesCheck(run);
    if (checked) wrap.append(checked);
    if (reviewable && run.changes.length) {
      const n = selectedCount(tab);
      wrap.append(h('div', { class: 'review-actions' },
        h('span', { class: 'grow' }, `${run.changes.length} file${run.changes.length === 1 ? '' : 's'} changed · ${n} change${n === 1 ? '' : 's'} ${penFirst() ? 'accepted' : 'selected'}`,
          h('span', { class: 'review-keys', title: keysHint('review') }, penFirst() ? 'j k · y n · A all · a apply · v diff' : 'j k · x · a apply · v red pen')),
        S.git?.repo && run.kind !== 'proof' ? h('label', { class: 'commit-toggle', title: 'Commit the applied files to git, authored by the agent (local only)' },
          h('input', { type: 'checkbox', checked: store.getItem('an.commitOnApply') !== 'false', onchange: (e) => store.setItem('an.commitOnApply', String(e.target.checked)) }), 'Commit to git') : null,
        h('button', { class: 'btn', onclick: () => followUp(tab) }, 'Follow up…'),
        h('button', { class: 'btn danger', onclick: () => discardRun(tab) }, 'Discard'),
        h('button', { class: 'btn primary', disabled: !n, onclick: () => applyRun(tab) }, `Apply ${n} ${penFirst() ? 'accepted' : 'selected'}`)));
    } else if (reviewable) {
      wrap.append(h('div', { class: 'review-actions' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => followUp(tab) }, 'Follow up…'),
        h('button', { class: 'btn danger', onclick: () => discardRun(tab) }, 'Discard')));
    }
    const locked = !reviewable;
    for (const c of run.changes) wrap.append(fileCard(c, tab, locked));
    for (const [p, base] of remarks) wrap.append(remarksCard(p, base, tab));
  }
  return wrap;
}

async function applyRun(tab) {
  const decisions = {};
  for (const [p, d] of Object.entries(tab.decisions)) decisions[p] = { file: d.file, hunks: [...d.hunks] };
  const dirtyOpen = S.tabs.filter((t) => t.kind === 'file' && t.content !== t.saved && decisions[t.path]);
  if (dirtyOpen.length && !(await askConfirm(`You have unsaved edits in ${dirtyOpen.map((t) => t.path).join(', ')}. Applying will create a conflict with them. Continue?`, { okLabel: 'Apply' }))) return;
  try {
    const commit = !!S.git?.repo && tab.run?.kind !== 'proof' && store.getItem('an.commitOnApply') !== 'false';
    const r = await api('POST', `/api/runs/${tab.runId}/apply`, { decisions, commit });
    const n = r.applied.files.length;
    toast(`Applied changes to ${n} file${n === 1 ? '' : 's'}${r.commit?.hash ? ` · committed ${r.commit.hash}` : ''}.`, r.commit?.error ? 'error' : '');
    if (r.commit?.error) setTimeout(() => toast(`Applied, but the git commit failed: ${r.commit.error}`, 'error'), 2900);
    loadGit();
  } catch (e) { toast(e.message, 'error'); }
  await afterRunChange(tab);
}

async function discardRun(tab) {
  if (!(await askConfirm('Discard this run? Nothing will be applied (the run stays in history).', { okLabel: 'Discard', danger: true }))) return;
  try { await api('POST', `/api/runs/${tab.runId}/discard`); } catch (e) { toast(e.message, 'error'); }
  await afterRunChange(tab);
}

async function revertRun(tab) {
  try {
    const r = await api('POST', `/api/runs/${tab.runId}/revert`);
    toast(`Restored ${r.reverted.length} file${r.reverted.length === 1 ? '' : 's'}.`);
  } catch (e) {
    const blocked = e.data?.blocked?.map((b) => b.path).join(', ');
    toast(blocked ? `${e.message}: ${blocked}` : e.message, 'error');
  }
  await afterRunChange(tab);
}

async function followUp(tab) {
  const text = await askText({ title: 'Follow up', label: 'The agent continues from its current proposal, not from scratch. You will review the combined result.', placeholder: 'e.g. Make the TL;DR shorter and keep my headings', multiline: true, okLabel: 'Run follow-up' });
  if (!text || !text.trim()) return;
  try {
    const run = await api('POST', `/api/runs/${tab.runId}/followup`, { task: text });
    await loadRuns();
    closeTab(tab.id);
    openReview(run.id);
  } catch (e) { toast(e.message, 'error'); }
}

async function afterRunChange(tab) {
  tab.decisions = {};
  await Promise.all([loadTree(), loadRuns()]);
  await syncOpenTabs();
  await refreshReview(tab);
}

// ------------------------------------------------------------------ keyboard & boot

document.addEventListener('keydown', (e) => {
  const overlay = $('#overlay');
  if (e.key === 'Escape' && !overlay.hidden) { overlay.hidden = true; overlay.replaceChildren(); return; }
  if (e.key === 'Escape' && document.documentElement.classList.contains('focus-mode') && !fileTab()?.editor.find.open && !(e.defaultPrevented && e.target.closest?.('.ed'))) { toggleFocusMode(); return; }
  if (e.key === '?' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { S.focus = 0; S.groups[0].active = null; render(); return; }
  const id = appKeys.get(eventKeys(e, isMac));
  // The editor handles its own (and took this one).
  if (!id || (e.defaultPrevented && e.target.closest?.('.ed'))) return;
  if (id === 'find' || id === 'replace') {
    // In the editor it opens its find bar itself; elsewhere, the note's.
    if (!fileTab() || e.target.closest?.('.ed')) return;
    e.preventDefault();
    findInNote(fileTab(), { replace: id === 'replace' });
    return;
  }
  if (id === 'rename' && !fileTab()) return;
  if (id === 'copy-drawing' && !drawingTab()?.frame) return;
  if (!ACTIONS[id]) return;
  e.preventDefault();
  runCommand(id);
});

document.querySelectorAll('#activity [data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
$('#btn-help').addEventListener('click', () => { S.focus = 0; S.groups[0].active = null; render(); });
$('#btn-settings').addEventListener('click', openSettings);
window.addEventListener('focus', () => { if (!liveEvents) { loadTree(); syncOpenTabs(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden) S.tabs.forEach((t) => (t.kind === 'file' ? flushAutosave(t) : t.kind === 'drawing' && S.settings.autosave && !t.conflict && saveDrawing(t, { flush: true }))); });
window.addEventListener('resize', placeFramesSoon);
// The link preview goes away on typing, scrolling elsewhere, or a click outside.
document.addEventListener('keydown', (e) => { if (linkPop.el && !['Meta', 'Control'].includes(e.key)) hideLinkPreview(); }, true);
document.addEventListener('mousedown', (e) => { if (linkPop.el && !e.target.closest('.link-preview')) hideLinkPreview(); }, true);
document.addEventListener('scroll', (e) => { if (linkPop.el && !linkPop.el.contains(e.target)) hideLinkPreview(); }, true);
window.addEventListener('beforeunload', (e) => {
  if (S.tabs.some((t) => (t.kind === 'file' && t.content !== t.saved) || (t.kind === 'drawing' && t.text !== t.saved))) { e.preventDefault(); e.returnValue = ''; }
});
onSystemThemeChange(() => { if (S.settings.theme === 'system') { applySettings(); renderStatus(); } });

// Sidebar resize by dragging its right edge.
$('#sidebar-resizer').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const move = (ev) => {
    const w = Math.max(180, Math.min(520, ev.clientX - $('#activity').getBoundingClientRect().right));
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
  };
  const up = (ev) => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    setSetting('sidebarWidth', Math.max(180, Math.min(520, Math.round(ev.clientX - $('#activity').getBoundingClientRect().right))));
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
});

// Live updates from the server (file watcher + agent run status). Falls back
// to refresh-on-focus when the stream is unavailable.
let liveEvents = false;
function connectEvents() {
  const es = new EventSource(`/api/events?t=${token}`);
  es.addEventListener('open', () => { liveEvents = true; });
  es.addEventListener('fs', debounce(async (ev) => {
    const { paths = [], structural } = JSON.parse(ev.data || '{}');
    if (structural) await loadTree();
    const changed = new Set(paths);
    // The leader's keys may name recipes and macros: those first.
    const named = [(structural || changed.has(RECIPES_FILE)) && loadRecipes(), (structural || changed.has(MACROS_FILE)) && loadMacros()];
    if (structural || changed.has(LEADER_FILE)) Promise.all(named).then(loadLeaderKeys);
    const affected = S.tabs.filter((t) => isDoc(t) && (!paths.length || changed.has(t.path)));
    if (affected.length) await syncTabs(affected);
    for (const p of paths) if (isDrawing(p) || isMermaidFile(p) || isNote(p)) refreshEmbeds(p);
    if (paths.some((p) => /\.(md|markdown|mdx|txt)$/i.test(p))) { loadTags(); loadOutside(); refreshTasksSoon(); const t = fileTab(); if (t) loadBacklinks(t.path); }
    loadGitSoon();
  }, 60));
  es.addEventListener('runs', () => loadRuns().then(() => {
    for (const t of S.tabs) if (t.kind === 'review') refreshReview(t);
  }));
  es.addEventListener('error', () => { liveEvents = false; });
}

async function loadTags() {
  try { S.tags = (await api('GET', '/api/tags')).tags; } catch { S.tags = []; }
  if (S.view === 'files') renderSidebar();
}

// Shortcuts that also exist in the desktop app's native menu run through one
// dispatcher; a repeat of the same command within 150ms is ignored, so a key
// press can never trigger an action twice (menu + page handler).

// ------------------------------------------------------------------ suggesting, comments, meetings
// Suggesting (tracked changes): the note's own text stays as it is; your edits
// are marked on it — struck through, written in in your pen — and kept as a
// run of yours (server: openProof) that the red pen review settles like any
// proposal (y n A a). Comments sit beside the note, never in it (server:
// saveComments), in the editor's margin. Meeting mode is for sharing the
// screen: large text, the line you're on, nothing private around it.

const localStamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hhmm = (t) => (/\d\d:\d\d/.exec(t || '') || [t])[0];
const proofRun = (tab) => tab && S.runs.find((r) => r.kind === 'proof' && r.focus === tab.path && r.status === 'review');
const openComments = (tab) => (tab?.comments || []).filter((c) => !c.resolved);
const LINE_PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s?)*/;

async function toggleSuggest(tab = fileTab()) {
  if (!tab || !isNote(tab.path)) { toast('Suggesting is for notes: open one first.'); return; }
  if (tab.proof?.on) { await stopSuggest(tab); return; }
  await flushAutosave(tab);
  if (tab.conflict || tab.content !== tab.saved) { toast('Save the note first: suggestions start from the note as it is on disk.', 'error'); return; }
  let r;
  try { [r] = await Promise.all([api('POST', '/api/proofs', { path: tab.path }), loadPen()]); }
  catch (e) { toast(e.message, 'error', e.data?.id ? { label: 'Review', run: () => openReview(e.data.id) } : null); return; }
  const ed = editorFor(tab);
  const at = ed.selectionStart;
  tab.proof = { id: r.id, on: true };
  ed.startTrack(fromDisk(r.base).content, fromDisk(r.work).content);
  ed.setSelection(Math.min(at, ed.value.length));
  if (isAttached(tab)) { if (!editorShown(tab)) setMode('edit'); ed.focus(); renderPreview(tab); }
  drawNotes(tab);
  renderStatus();
  loadRuns();
  toast(`Suggesting: the note stays as it is · ${kbd('suggest') || '⌥X p p'} to stop`);
}

function proofChanged(tab) {
  if (!tab.proof?.on) return;
  clearTimeout(tab.proof.timer);
  tab.proof.timer = setTimeout(() => saveProof(tab), 400);
  livePreview(tab);
  drawNotesSoon(tab);
  renderStatus();
}

async function saveProof(tab) {
  const p = tab.proof;
  if (!p?.on || !tab.editor?.tracking) return;
  clearTimeout(p.timer);
  if (p.saving) { p.again = true; await p.saving; return; }
  const text = toDisk(tab.editor.trackTexts().proposed, tab.eol);
  if (text === p.kept) return;
  p.saving = api('PUT', `/api/proofs/${p.id}`, { text }).then(() => { p.kept = text; }, (e) => toast(`Suggestions not kept: ${e.message}`, 'error'));
  await p.saving;
  p.saving = null;
  if (p.again) { p.again = false; await saveProof(tab); }
}

// Back to editing the note itself; the suggestions wait for review (none:
// the empty run goes). settled: they were applied or discarded.
async function stopSuggest(tab, { settled = false } = {}) {
  const p = tab.proof;
  if (!p) return;
  if (p.on && !settled) await saveProof(tab);
  const texts = tab.editor?.trackTexts();
  const n = texts ? hunksOf(texts.original, texts.proposed).length : 0;
  p.on = false;
  if (tab.editor?.tracking) tab.editor.stopTrack(tab.content);
  if (settled || !n) {
    tab.proof = null;
    if (!settled) api('POST', `/api/runs/${p.id}/discard`).then(loadRuns, () => {});
  }
  if (isAttached(tab)) renderPreview(tab);
  drawNotes(tab);
  renderStatus();
  if (!settled && n) toast(`${n} suggestion${n === 1 ? '' : 's'} waiting · the note is as it was`, '', { label: 'Review', run: () => openReview(p.id) });
}

// After the meeting: your suggestions in the red pen review.
async function reviewSuggestions(tab = fileTab()) {
  if (tab?.proof?.on) await saveProof(tab);
  const r = tab && (tab.proof ? { id: tab.proof.id } : proofRun(tab));
  if (!r) { toast('No suggestions on this note.'); return; }
  openReview(r.id);
}

// A run of suggestions settled (applied, discarded): its note edits on.
function proofsSettled() {
  for (const t of S.tabs) {
    if (!t.proof) continue;
    const r = S.runs.find((x) => x.id === t.proof.id);
    if (r && r.status !== 'review') stopSuggest(t, { settled: true });
  }
}

function replaceSel(tab = fileTab()) {
  if (!tab?.proof?.on) { toast(`Replace as a suggestion while suggesting (${kbd('suggest') || '⌥X p p'})`); return; }
  if (!tab.editor.replaceSelection()) toast('Select the words to replace');
}

// ---------------- comments

async function loadComments(tab) {
  if (tab.commentsLoading) return;
  tab.commentsLoading = true;
  try { tab.comments = (await api('GET', `/api/comments?path=${encodeURIComponent(tab.path)}`)).comments; } catch { tab.comments = []; }
  tab.commentsLoading = false;
  drawNotes(tab);
  renderStatus();
}

function keepComments(tab) {
  drawNotes(tab);
  renderStatus();
  api('PUT', '/api/comments', { path: tab.path, comments: tab.comments }).catch((e) => toast(`Comment not kept: ${e.message}`, 'error'));
}

// Where a comment is in the text: its words, the nearest to its line.
function anchorOf(text, c) {
  let want = 0;
  for (let i = 0; i < (c.line || 0) && want >= 0; i++) want = text.indexOf('\n', want) + 1 || -1;
  if (want < 0) want = text.length;
  for (const q of [c.quote, ...(c.alts || [])]) {
    if (!q) continue;
    let best = -1;
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
      if (best < 0 || Math.abs(i - want) < Math.abs(best - want)) best = i;
      if (i > want) break;
    }
    if (best >= 0) return [best, best + q.length];
  }
  return null;
}

const drawNotesSoon = debounce((tab) => drawNotes(tab), 120);
function drawNotes(tab) {
  if (tab?.comments) canvasComments(tab);
  const ed = tab?.editor;
  if (!ed || tab.draft) return;
  if (!tab.comments) { if (isNote(tab.path)) loadComments(tab); return; }
  const text = ed.value;
  ed.setNotes(tab.comments.filter((c) => !c.resolved || tab.showResolved).map((c) => {
    const at = anchorOf(text, c);
    return { from: at ? at[0] : 0, to: at ? at[1] : 0, el: noteCard(tab, c, !at), cur: tab.noteCur === c.id };
  }));
}

function noteCard(tab, c, lost) {
  const card = h('div', { class: `mnote${c.resolved ? ' resolved' : ''}${lost ? ' lost' : ''}${tab.noteCur === c.id ? ' cur' : ''}`, 'data-id': c.id },
    h('div', { class: 'mnote-head' },
      c.speaker ? h('span', { class: 'mnote-who' }, `@${c.speaker}`) : null,
      c.time ? h('span', { class: 'mnote-when', title: c.time }, hhmm(c.time)) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'mnote-btn', title: 'Reply', onclick: () => replyTo(tab, c) }, '↩'),
      h('button', { class: 'mnote-btn', title: c.resolved ? 'Open again' : 'Resolve (close)', onclick: () => resolveNote(tab, c) }, c.resolved ? '↺' : '✓')),
    c.pin ? h('div', { class: 'mnote-on' }, pinLabel(c.pin)) : null,
    h('div', { class: 'mnote-text' }, c.comment),
    lost ? h('div', { class: 'mnote-lost' }, 'on words no longer in the note') : null,
    (c.replies || []).map((r) => h('div', { class: 'mnote-reply' },
      r.speaker ? h('span', { class: 'mnote-who' }, `@${r.speaker}`) : null, r.text, r.time ? h('span', { class: 'mnote-when' }, hhmm(r.time)) : null)));
  card.addEventListener('mousedown', (e) => { if (!e.target.closest('button, input')) { e.preventDefault(); gotoNote(tab, c); } });
  return card;
}

function gotoNote(tab, c, focus = true) {
  tab.noteCur = c.id;
  const at = anchorOf(tab.editor.value, c);
  if (at) tab.editor.selectRange(at[0], at[1], focus);
  drawNotes(tab);
}

// A comment (or reply) being written, in the margin where it will be:
// "@name" first says who said it; the clock adds the time.
function writeNote(tab, from, to, { placeholder, done }) {
  let timeOn = store.getItem('an.commentTime') !== 'false';
  const input = h('input', { class: 'mnote-input', placeholder, spellcheck: false });
  const clock = h('button', { class: `mnote-btn clock${timeOn ? ' on' : ''}`, title: 'Add the time (on / off)', onmousedown: (e) => e.preventDefault(),
    onclick: () => { timeOn = !timeOn; store.setItem('an.commentTime', String(timeOn)); clock.classList.toggle('on', timeOn); input.focus(); } }, '🕑');
  const box = h('div', { class: 'mnote draft' }, h('div', { class: 'mnote-head' }, h('span', { class: 'mnote-hint' }, '@name · Enter · Esc'), h('span', { class: 'grow' }), clock), input);
  let over = false;
  const finish = (keep) => {
    if (over) return;
    over = true;
    tab.draft = null;
    const v = input.value.trim();
    const m = /^@(\S+)\s*/u.exec(v);
    const text = m ? v.slice(m[0].length).trim() : v;
    if (keep && text) done({ text, speaker: m?.[1], time: timeOn ? localStamp() : undefined });
    drawNotes(tab);
    tab.editor.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') {
      // @mi⇥ → @minsu: the names said so far.
      e.preventDefault();
      const part = /^@(\S*)$/u.exec(input.value.trim())?.[1] ?? null;
      const names = [...new Set((tab.comments || []).flatMap((c) => [c.speaker, ...(c.replies || []).map((r) => r.speaker)]).filter(Boolean))];
      const hit = part != null && names.find((n) => n.toLowerCase().startsWith(part.toLowerCase()) && n !== part);
      if (hit) input.value = `@${hit} `;
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) finish(true); }, 120));
  tab.draft = { from, to, el: box, cur: true };
  const ed = tab.editor;
  ed.setNotes([...ed.notes.filter((n) => !n.el.classList.contains('draft')), tab.draft]);
  requestAnimationFrame(() => input.focus());
}

function commentHere(tab = fileTab()) {
  if (!tab || !isNote(tab.path)) { toast('Comments are for notes: open one first.'); return; }
  if (tab.draft) return;
  const ed = editorFor(tab);
  if (!editorShown(tab)) setMode('edit');
  const v = ed.value;
  let a = ed.selectionStart;
  let b = ed.selectionEnd;
  if (a === b) {
    const on = openComments(tab).find((c) => { const at = anchorOf(v, c); return at && at[0] <= a && a <= at[1]; });
    if (on) { replyTo(tab, on); return; }
    a = v.lastIndexOf('\n', a - 1) + 1;
    b = v.indexOf('\n', a);
    if (b < 0) b = v.length;
    a += LINE_PREFIX.exec(v.slice(a, b))[0].length;
    if (!v.slice(a, b).trim()) { toast('Select some words, or go to a line with text, to comment on.'); return; }
  }
  const quote = v.slice(a, b).slice(0, 2000);
  const line = v.slice(0, a).split('\n').length - 1;
  const alts = ed.tracking ? Object.values(ed.trackSlice(a, b)).filter((x) => x.trim() && x !== quote) : [];
  writeNote(tab, a, b, { placeholder: 'Comment… (@name who said it)', done: ({ text, speaker, time }) => {
    const c = { id: Math.random().toString(36).slice(2, 10), quote, alts, line, comment: text, speaker, time, replies: [] };
    (tab.comments ||= []).push(c);
    tab.noteCur = c.id;
    keepComments(tab);
  } });
}

function replyTo(tab, c) {
  const at = anchorOf(tab.editor.value, c) || [0, 0];
  tab.noteCur = c.id;
  writeNote(tab, at[0], at[1], { placeholder: 'Reply… (@name)', done: ({ text, speaker, time }) => {
    (c.replies ||= []).push({ text, speaker, time });
    keepComments(tab);
  } });
}

function resolveNote(tab, c) {
  c.resolved = c.resolved ? undefined : localStamp();
  keepComments(tab);
  if (c.resolved) toast('Comment resolved', '', { label: 'Undo', run: () => { c.resolved = undefined; keepComments(tab); } });
}

const commentAt = (tab) => {
  const v = tab.editor.value;
  const a = tab.editor.selectionStart;
  const list = openComments(tab).map((c) => [c, anchorOf(v, c)]).filter(([, at]) => at);
  return (list.find(([c]) => c.id === tab.noteCur) || list.find(([, at]) => at[0] <= a && a <= at[1]))?.[0] || null;
};

function stepNote(tab, dir) {
  const v = tab.editor.value;
  const a = tab.editor.selectionStart;
  const list = openComments(tab).map((c) => [c, anchorOf(v, c)]).filter(([, at]) => at).sort((x, y) => x[1][0] - y[1][0]);
  if (!list.length) { toast('No comments here'); return; }
  const next = dir > 0 ? list.find(([, at]) => at[0] > a) || list[0] : [...list].reverse().find(([, at]) => at[0] < a) || list.at(-1);
  gotoNote(tab, next[0]);
}

// ---- comments on the pictures (public/pins.js): a box of a ```flow, a
// point of a picture or a sketch. Each is a comment of the note as any
// other, on the words that say where its picture is (the box's name, the
// picture's line, the sketch's board line), with its pin; the canvas shows
// it on the picture.

const boardText = (src) => { const b = parseInk(src).board; return b ? src.split('\n')[b.line].trim() : ''; };

// A figure of the canvas: its lines in the note, and what kind of picture.
function figSpan(f) {
  const start = Number(f.dataset.line) || 0;
  const n = (f.dataset.source ?? f.textContent).replace(/\n$/, '').split('\n').length;
  if (f.flowNodes) return { start, end: start + n + 1, on: 'flow', boxes: f.flowNodes.map((x) => x.text) };
  if (!f.matches('.ink-figure')) return { start, end: start, on: '' };
  const ink = f.dataset.inkLine;
  return { start, end: ink === '' ? start : Number(ink) + n + 1, on: f.dataset.board != null ? 'sketch' : 'picture' };
}

// The open comments pinned on the canvas's pictures: [[comment, figure]].
function canvasPins(tab) {
  const figs = (tab.canvasSections || []).flatMap((s) => s.figures).filter((f) => !f.dataset.from);
  const spans = figs.map(figSpan);
  const text = tab.content ?? '';
  return openComments(tab).filter((c) => c.pin).map((c) => {
    const at = anchorOf(text, c);
    const i = pinnedFigure(c.pin, spans, at ? text.slice(0, at[0]).split('\n').length - 1 : null, c.line || 0);
    return i < 0 ? null : [c, figs[i]];
  }).filter(Boolean);
}
const pinnedOn = (tab, fig) => (tab.canvas?.el.isConnected ? canvasPins(tab).filter(([, f]) => f === fig).map(([c]) => c) : []);

function canvasComments(tab) {
  if (!tab.canvas?.el.isConnected) return;
  tab.canvas.setComments(canvasPins(tab).map(([c, fig]) => ({
    fig, pin: c.pin, id: c.id, text: c.comment, who: c.speaker, replies: c.replies?.length || 0, cur: tab.noteCur === c.id,
  })));
}

// A comment written on a picture, in a field over its spot (rect).
function drawingComment(tab, fig, pin, rect) {
  if (!isNote(tab.path) || !tab.canvas?.el.isConnected) return;
  if (fig.dataset.from) { toast(`This picture is in “${stem(fig.dataset.from)}”: comment on it there.`); return; }
  const src = (fig.dataset.source ?? '').replace(/\n$/, '');
  const lines = (tab.content ?? '').split('\n');
  let line;
  let quote;
  if (pin.on === 'flow') {
    const spot = fig.flowNodes?.find((n) => n.text === pin.box)?.spots[0];
    if (!spot) return;
    line = Number(fig.dataset.line) + 1 + spot.line;
    quote = pin.box;
  } else if (pin.on === 'sketch') {
    const b = parseInk(src).board;
    if (!b) return;
    line = Number(fig.dataset.inkLine) + 1 + b.line;
    quote = boardText(src);
  } else {
    line = Number(fig.dataset.line);
    quote = (lines[line] || '').trim();
  }
  if (!quote) return;
  const timeOn = store.getItem('an.commentTime') !== 'false';
  const where = () => {
    const r = rect();
    return r && { left: r.left + r.width / 2 - 20, top: r.top - 22, width: 280, height: 0 };
  };
  tab.canvas.typeOver(where, '', (v) => {
    const m = /^@(\S+)\s*/u.exec(v);
    const text = m ? v.slice(m[0].length).trim() : v;
    if (!text) return;
    const c = { id: Math.random().toString(36).slice(2, 10), quote, alts: [], line, comment: text, speaker: m?.[1], time: timeOn ? localStamp() : undefined, replies: [], pin };
    (tab.comments ||= []).push(c);
    tab.noteCur = c.id;
    keepComments(tab);
  }, `Comment ${pinLabel(pin)}… (@name who said it)`);
}

// ---------------- meeting mode

function toggleMeeting() {
  S.meeting = !S.meeting;
  document.documentElement.classList.toggle('meeting', S.meeting);
  for (const t of S.tabs) t.editor?.setCurrentLine(S.meeting);
  document.title = S.meeting ? 'Margin' : `${S.info?.name || ''} — Margin`;
  $('#titlebar').textContent = document.title;
  // The text itself, wide: the preview comes back after.
  const g = S.groups[S.focus];
  if (S.meeting && g && g.mode !== 'edit') { S.meetingFrom = g.mode; setMode('edit'); }
  else if (!S.meeting && S.meetingFrom) { if (g?.mode === 'edit') setMode(S.meetingFrom); S.meetingFrom = null; }
  renderStatus();
  const t = fileTab();
  if (t?.editor && editorShown(t)) t.editor.focus();
  toast(S.meeting ? `Meeting mode · ${kbd('meeting') || '⌥X p m'} to leave` : 'Meeting mode off');
}

// ---------------- narrowing (editor.js narrow, narrow.js): only the section
// the cursor is in — or the selected lines — in the editor, as Emacs's
// narrow-to-region. Editing, finding, undo and suggesting stay in it; the
// note is saved whole; a search result elsewhere shows all of it again.

function narrowHere(tab = fileTab()) {
  if (!tab || !isNote(tab.path)) { toast('Narrowing is for notes: open one first.'); return; }
  const ed = editorFor(tab);
  const text = ed.value;
  const [a, b] = [ed.selectionStart, ed.selectionEnd];
  const r = a !== b ? linesRange(text, a, b) : sectionRange(text, a);
  if (!r) { toast('No heading above the cursor: select the lines to narrow to'); return; }
  if (isAttached(tab) && !editorShown(tab)) setMode('edit');
  if (!ed.narrow(...r)) { toast('That is the whole note'); return; }
  if (isAttached(tab)) ed.focus();
  const part = ed.narrowed;
  toast(`Narrowed to lines ${part.from}–${part.to} · ${kbd('leader') || '⌥X'} n w shows the whole note`);
}

function widenHere(tab = fileTab()) {
  if (!tab?.editor?.widen()) { toast('The whole note is in view'); return; }
  if (isAttached(tab) && editorShown(tab)) tab.editor.focus();
}

const ACTIONS = {
  'new-note': () => newNote(),
  'quick-open': () => openPalette(),
  palette: () => openPalette('>'),
  search: () => { S.view = 'search'; $('#app').classList.remove('no-sidebar'); renderSidebar(); $('#search-input')?.focus(); $('#search-input')?.select(); },
  save: () => (activeTab()?.kind === 'dired' ? activeTab().mode === 'edit' && planDiredEdits(activeTab())
    : drawingTab() ? saveDrawing(drawingTab(), { flush: true, force: false }) : saveTab()),
  'close-tab': () => (activeTab() ? closeTab(activeTab().id) : desktop?.closeWindow()),
  'flow-next': () => walkFlow(false),
  'flow-back': () => walkFlow(true),
  'cycle-mode': () => {
    const t = activeIn(S.focus);
    const canvas = t?.kind === 'file' && isNote(t.path);
    setMode({ edit: 'split', split: canvas ? 'canvas' : 'preview', canvas: 'preview', preview: 'edit' }[groupMode(t)] || 'split');
  },
  split: splitRight,
  focus: toggleFocusMode,
  sidebar: toggleSidebar,
  theme: pickTheme,
  settings: openSettings,
  delegate: () => openTaskDialog(),
  runs: () => showView('agent'),
  files: () => showView('files'),
  git: () => showView('git'),
  'quick-capture': quickCapture,
  'nav-back': () => navGo(-1),
  'nav-forward': () => navGo(1),
  'export-html': () => exportHtml(),
  print: () => printNote(),
  rename: () => fileTab() && renameItem(fileTab().path),
  'copy-drawing': () => drawingTab()?.frame && copyPicture(drawingPicture(drawingTab())),
  leader: openLeaderMenu,
  repeat: repeatLast,
  'other-note': otherBuffer,
  jump: jumpInNote,
  'paste-history': pasteFromHistory,
  buffers: pickTab,
  // From the Edit menu: the editor's own history when a note has the focus
  // (or its canvas, where drawing changed it).
  undo: () => { const t = S.tabs.find((x) => x.editor?.ta === document.activeElement || (x.canvas && x.canvas.stage === document.activeElement)); if (t) t.editor.undo(); else document.execCommand('undo'); },
  redo: () => { const t = S.tabs.find((x) => x.editor?.ta === document.activeElement || (x.canvas && x.canvas.stage === document.activeElement)); if (t) t.editor.redo(); else document.execCommand('redo'); },
  'macro-record': toggleRecording,
  'macro-play': () => (macros.recording ? stopRecording() : playMacro(1)),
  'search-next': () => stepSearch(1),
  'search-prev': () => stepSearch(-1),
  suggest: () => toggleSuggest(),
  'replace-sel': () => replaceSel(),
  comment: () => commentHere(),
  meeting: toggleMeeting,
};

// ---------------------------------------------------------------- keyboard
// One leader key everywhere (Alt+X by default, like Emacs M-x): a menu of
// the keys that can follow, grouped by letter as in LazyVim / Doom. The
// leader again, or Space, opens every command. See leader.js.
const isFileTab = (t) => t?.kind === 'file';
const editorShown = (t) => isFileTab(t) && (!hasPreview(t.path) || groupMode(t) !== 'preview');
const previewShown = (t) => isFileTab(t) && hasPreview(t.path) && ['split', 'preview'].includes(groupMode(t));

function defaultLeaderTree() {
  const tab = fileTab();
  const doc = tab || drawingTab();
  const note = !!tab && isNote(tab.path);
  return [
    { key: 'SPC', label: 'All commands…', run: () => openPalette('>'), mx: false },
    { key: ':', label: 'Run a command by name (M-x)…', run: () => openPalette('>'), mx: false },
    { key: '`', label: 'The note before', cmd: 'Back to the note before', run: otherBuffer },
    { key: 'f', label: 'files', items: [
      { key: 'f', label: 'Find a file…', run: () => openPalette(), emacs: 'find-file' },
      { key: 'n', label: 'New note…', cmd: 'New note', run: () => newNote() },
      { key: 't', label: 'New note from template…', run: () => pickTemplate((t) => newNote(undefined, t)) },
      { key: 'j', label: 'Today’s journal', cmd: 'Open today’s journal note', run: openDaily },
      { key: 'x', label: 'Tasks in all notes', cmd: 'Tasks in all notes (agenda)', run: openTasks },
      { key: 'r', label: 'Rename / move…', cmd: 'Rename / move current note…', when: () => !!doc, run: () => renameItem(doc.path) },
      { key: 'b', label: doc && isBookmarked(doc.path) ? 'Remove bookmark' : 'Bookmark', cmd: 'Bookmark / remove bookmark for this file', when: () => !!doc, run: () => toggleBookmark(doc.path) },
      { key: 'y', label: 'Copy [[link]]', cmd: 'Copy [[link]] to current note', when: () => note, run: () => navigator.clipboard.writeText(`[[${stem(tab.path)}]]`).then(() => toast('Link copied')) },
      { key: 'l', label: 'Show in the tree', when: () => !!doc, run: () => { showInTree(doc.path); focusSidebar(); } },
      { key: 'h', label: 'History…', cmd: 'History of current note (kept versions and git)', when: () => !!doc, run: () => openHistory(doc.path) },
      { key: 'e', label: 'Export as HTML…', cmd: 'Export note as HTML…', when: () => note, run: () => exportHtml(tab) },
      { key: 'd', label: 'Dired: a folder as text…', cmd: 'Dired: edit a folder as text…', run: pickDiredFolder },
    ] },
    { key: 'd', label: 'Dired: this folder as text', cmd: 'Dired: the folder of this note', run: () => diredHere() },
    { key: 's', label: 'search', items: [
      { key: 's', label: 'Search the workspace', cmd: 'Search in workspace', run: () => ACTIONS.search() },
      { key: 'b', label: 'Search results as a buffer', cmd: 'Search results (as a buffer)', run: openSearchBuffer },
      { key: 'f', label: 'Find in note', when: () => !!tab, run: () => findInNote(tab) },
      { key: 'r', label: 'Replace in note', when: () => !!tab, run: () => findInNote(tab, { replace: true }) },
      { key: 'h', label: 'Heading in this note…', cmd: 'Go to heading…', when: () => note, run: () => openPalette('#') },
      { key: 'a', label: 'Heading in any note…', cmd: 'Go to heading in any note…', run: () => openPalette('@') },
      { key: 'l', label: 'Go to line…', when: () => !!tab, run: () => openPalette(':') },
      { key: 'n', label: 'Next search result', run: () => stepSearch(1) },
      { key: 'p', label: 'Previous search result', run: () => stepSearch(-1) },
      { key: 'q', label: 'Query replace…', cmd: 'Query replace (match by match: y n ! . ^ q)', emacs: 'query-replace', when: () => !!tab, run: () => queryReplaceIn(tab) },
      { key: 'Q', label: 'Query replace a regular expression…', cmd: 'Query replace regexp (match by match)', emacs: 'query-replace-regexp', when: () => !!tab, run: () => queryReplaceIn(tab, true) },
      { key: 'o', label: 'Occur: lines that match…', cmd: 'Occur: the lines of this note that match, as a buffer', emacs: 'occur', when: () => !!tab, run: () => occur(tab) },
    ] },
    { key: 'b', label: 'buffers', items: [
      { key: 'b', label: 'Switch note (buffers)…', run: pickTab, emacs: 'switch-to-buffer' },
      { key: '`', label: 'The note before', cmd: 'Back to the note before', run: otherBuffer },
      { key: 'm', label: 'Messages', run: openMessages },
      { key: 'r', label: 'Agent runs', cmd: 'Agent runs (as a buffer)', run: openRuns },
      { key: 's', label: 'Search results', cmd: 'Search results (as a buffer)', run: openSearchBuffer },
      { key: 'x', label: 'Tasks', cmd: 'Tasks in all notes (agenda)', run: openTasks },
      { key: 'c', label: 'Changed outside', cmd: 'Changes from outside (agents, other editors)…', run: openOutside },
      { key: 'n', label: 'Next tab', run: () => cycleTab(1) },
      { key: 'p', label: 'Previous tab', run: () => cycleTab(-1) },
      { key: 'd', label: 'Close tab', when: () => !!activeTab(), run: () => closeTab(activeTab().id) },
      { key: 'o', label: 'Close other tabs', when: () => !!activeTab(), run: () => closeTabs(S.tabs.filter((x) => x.group === S.focus && x !== activeTab())) },
      { key: '[', label: 'Back', cmd: 'Go back', run: () => navGo(-1) },
      { key: ']', label: 'Forward', cmd: 'Go forward', run: () => navGo(1) },
    ] },
    { key: 'w', label: 'windows', items: [
      { key: 'h', label: 'Go to the sidebar', run: focusSidebar },
      { key: 'l', label: 'Go to the editor', run: focusEditor },
      { key: 'p', label: 'Go to the preview', when: () => previewShown(tab), run: () => focusPreview(tab) },
      { key: 'w', label: 'Go to the other pane', when: () => S.groups.length > 1, run: () => { splitRight(); focusEditor(); }, emacs: 'other-window' },
      { key: 'v', label: 'Split to the side', cmd: 'Split: open to the side', when: () => S.groups.length < 2, run: splitRight },
      { key: 's', label: 'Show / hide the sidebar', cmd: 'Toggle sidebar', run: toggleSidebar },
      { key: 'z', label: 'Focus mode', run: toggleFocusMode },
    ] },
    { key: 'm', label: 'mode', when: () => isFileTab(tab) && hasPreview(tab.path), items: [
      { key: 'e', label: 'Edit', cmd: 'View: edit only', run: () => setMode('edit') },
      { key: 's', label: 'Split', cmd: 'View: split editor and preview', run: () => setMode('split') },
      { key: 'c', label: 'Canvas', cmd: 'View: editor and canvas (pictures follow the cursor)', when: () => note, run: () => setMode('canvas') },
      { key: 'p', label: 'Preview', cmd: 'View: preview only', run: () => setMode('preview') },
    ] },
    { key: 'n', label: 'narrow', when: () => note, items: [
      { key: 'n', label: tab && tab.editor && tab.editor.selectionStart !== tab.editor.selectionEnd ? 'Narrow to the selected lines' : 'Narrow to this section', cmd: 'Narrow to this section or the selected lines', run: () => narrowHere(tab) },
      { key: 'w', label: 'Widen: the whole note', cmd: 'Widen: show the whole note', when: () => !!tab.editor?.narrowed, run: () => widenHere(tab) },
    ] },
    { key: 'e', label: 'edit text', when: () => editorShown(tab), items: [
      { key: 'u', label: 'Uppercase the word or selection', cmd: 'Edit: uppercase the word or selection', emacs: 'upcase-word', run: () => emacsRun(tab, 'upcase-word') },
      { key: 'l', label: 'Lowercase the word or selection', cmd: 'Edit: lowercase the word or selection', emacs: 'downcase-word', run: () => emacsRun(tab, 'downcase-word') },
      { key: 'c', label: 'Capitalize the word or selection', cmd: 'Edit: capitalize the word or selection', emacs: 'capitalize-word', run: () => emacsRun(tab, 'capitalize-word') },
      { key: 'q', label: `Fill the paragraph (wrap at ${emacs.fillColumn})`, cmd: 'Edit: fill the paragraph (wrap it at the fill column)', emacs: 'fill-paragraph', run: () => emacsRun(tab, 'fill-paragraph') },
      { key: 'Q', label: 'Unfill the paragraph (one line)', cmd: 'Edit: unfill the paragraph (one line)', emacs: 'unfill-paragraph', run: () => emacsRun(tab, 'unfill-paragraph') },
      { key: 'f', label: 'Set the fill column…', cmd: 'Edit: set the fill column…', emacs: 'set-fill-column', run: setFillColumn },
      { key: 'j', label: 'Join this line to the one before', cmd: 'Edit: join this line to the one before', emacs: 'join-line', run: () => emacsRun(tab, 'join-line') },
      { key: 't', label: 'Swap this line and the one before', cmd: 'Edit: transpose lines', emacs: 'transpose-lines', run: () => emacsRun(tab, 'transpose-lines') },
      { key: 's', label: 'Sort the selected lines', cmd: 'Edit: sort lines', emacs: 'sort-lines', run: () => emacsRun(tab, 'sort-lines') },
      { key: 'S', label: 'Sort the selected lines, reversed', cmd: 'Edit: sort lines, reversed', run: () => emacsRun(tab, 'sort-lines', { raw: true }) },
      { key: 'o', label: 'Delete the blank lines around', cmd: 'Edit: delete blank lines', emacs: 'delete-blank-lines', run: () => emacsRun(tab, 'delete-blank-lines') },
      { key: 'w', label: 'Delete trailing spaces', cmd: 'Edit: delete trailing whitespace', emacs: 'delete-trailing-whitespace', run: () => emacsRun(tab, 'delete-trailing-whitespace') },
    ] },
    { key: 'x', label: 'mark & registers', when: () => editorShown(tab) || emacs.registers.size > 0, items: [
      { key: 'SPC', label: 'Set the mark', cmd: 'Mark: set the mark here', emacs: 'set-mark-command', when: () => emacs.on && editorShown(tab), run: () => emacsRun(tab, 'set-mark') },
      { key: 'x', label: 'Swap the cursor and the mark', cmd: 'Mark: exchange point and mark', emacs: 'exchange-point-and-mark', when: () => emacs.on && editorShown(tab), run: () => emacsRun(tab, 'exchange-point-and-mark') },
      { key: 'p', label: 'Back to the mark before', cmd: 'Mark: back to the mark before (pop)', emacs: 'pop-to-mark-command', when: () => editorShown(tab), run: () => emacsRun(tab, 'set-mark', { raw: true }) },
      { key: 'h', label: 'Select the whole note', cmd: 'Mark: select the whole note', emacs: 'mark-whole-buffer', when: () => editorShown(tab), run: () => emacsRun(tab, 'mark-whole-buffer') },
      { key: 'r', label: 'Keep this place in a register…', cmd: 'Register: keep this place (then a letter)', emacs: 'point-to-register', when: () => editorShown(tab), run: () => emacsRun(tab, 'point-to-register') },
      { key: 'j', label: 'Go to a register…', cmd: 'Register: go to the place in it (then a letter)', emacs: 'jump-to-register', when: () => editorShown(tab), run: () => emacsRun(tab, 'jump-to-register') },
      { key: 's', label: 'Copy the selection to a register…', cmd: 'Register: copy the selection to it (then a letter)', emacs: 'copy-to-register', when: () => editorShown(tab), run: () => emacsRun(tab, 'copy-to-register') },
      { key: 'i', label: 'Insert a register…', cmd: 'Register: insert its text (then a letter)', emacs: 'insert-register', when: () => editorShown(tab), run: () => emacsRun(tab, 'insert-register') },
      { key: 'l', label: 'List the registers…', cmd: 'Registers: list them', emacs: 'list-registers', run: listRegisters },
    ] },
    { key: 'l', label: 'links', items: [
      { key: 'l', label: 'Follow the link at the cursor', when: () => editorShown(tab), run: () => { if (!followLinkAt(tab.editor, tab)) toast('No link at the cursor'); } },
      { key: 'f', label: 'Pick a link in the preview…', when: () => previewShown(tab), run: () => linkHints(tab.previewEl) },
      { key: 'b', label: 'Back', run: () => navGo(-1) },
    ] },
    { key: 'g', label: 'git', items: [
      { key: 'g', label: 'Git panel', cmd: 'Git: show changes', run: () => showView('git') },
      { key: 'd', label: 'Changes since last commit', when: () => !!doc && S.gitMap.has(doc.path), run: () => openGitDiff(doc.path) },
      { key: 'h', label: 'History of this file…', cmd: 'History of current note (kept versions and git)', when: () => !!doc, run: () => openHistory(doc.path) },
    ] },
    { key: 'a', label: 'agent', items: [
      { key: 'a', label: 'Delegate a task…', cmd: 'Delegate a task to the agent…', run: () => openTaskDialog() },
      { key: 'r', label: 'Agent runs', cmd: 'Show agent runs', run: () => showView('agent') },
      { key: 'i', label: 'Instructions for agents (AGENTS.md)', cmd: 'Instructions for agents in this folder (AGENTS.md)', run: editAgentInstructions },
      { key: 'v', label: 'Review the next run', cmd: 'Review the next agent run', when: () => S.runs.some((r) => r.status === 'review'), run: reviewNext },
      { key: 'o', label: `Changed outside${S.outside?.length ? ` (${S.outside.length})` : ''}`, cmd: 'Changes from outside (agents, other editors)…', run: openOutside },
      ...recipes.list.filter((r) => /^\d$/.test(r.key || '')).map((r) => ({ key: r.key, label: recipeLabel(r), recipe: r, run: () => runRecipe(r) })),
    ] },
    { key: 'r', label: 'recipes', items: [
      ...recipes.list.filter((r) => r.key).map((r) => ({ key: r.key, label: recipeLabel(r), recipe: r, run: () => runRecipe(r) })),
      { key: 'e', label: `Edit recipes (${RECIPES_FILE})`, cmd: 'Recipes: edit (RECIPES.md)', run: editRecipes },
    ] },
    { key: 't', label: 'toggles', items: [
      { key: 'f', label: `Tree follows the tab: ${S.settings.followTab ? 'on' : 'off'}`, cmd: 'Toggle: tree follows the active tab', run: toggleFollowTab },
      { key: 's', label: 'Sidebar', cmd: 'Toggle sidebar', run: toggleSidebar },
      { key: 't', label: 'Theme…', cmd: 'Theme: choose…', run: pickTheme },
      { key: 'z', label: 'Focus mode', run: toggleFocusMode },
      { key: 'p', label: tab?.proof?.on ? 'Suggesting: on' : 'Suggesting: off', cmd: 'Suggest changes (tracked; the note stays as it is) on / off', when: () => note, run: () => toggleSuggest() },
      { key: 'm', label: `Meeting mode: ${S.meeting ? 'on' : 'off'}`, cmd: 'Meeting mode (large text, for sharing the screen)', run: toggleMeeting },
    ] },
    { key: 'p', label: 'pen: suggest, comment, meeting', items: [
      { key: 'p', label: tab?.proof?.on ? 'Stop suggesting' : 'Suggest changes (tracked)', cmd: 'Suggest changes (tracked; the note stays as it is) on / off', when: () => note, run: () => toggleSuggest() },
      { key: 'd', label: 'Strike the line / selection', cmd: 'Suggest: strike the selection or the line', when: () => !!tab?.proof?.on, run: () => tab.editor.strikeSelection() },
      { key: 'r', label: 'Replace the selection', cmd: 'Suggest: replace the selection', when: () => !!tab?.proof?.on, run: () => replaceSel(tab) },
      { key: 'c', label: 'Comment…', cmd: 'Comment on the selection or the line', when: () => note, run: () => commentHere(tab) },
      { key: 'n', label: 'Next comment', cmd: 'Pen: next comment', when: () => note && openComments(tab).length > 0, run: () => stepNote(tab, 1) },
      { key: 'N', label: 'Previous comment', cmd: 'Pen: previous comment', when: () => note && openComments(tab).length > 0, run: () => stepNote(tab, -1) },
      { key: 'x', label: 'Resolve the comment here', cmd: 'Pen: resolve the comment here', when: () => note && openComments(tab).length > 0, run: () => { const c = commentAt(tab); if (c) resolveNote(tab, c); else toast('No comment here'); } },
      { key: 'h', label: tab?.showResolved ? 'Hide resolved comments' : 'Show resolved comments', cmd: 'Pen: show / hide resolved comments', when: () => note && !!tab.comments?.some((c) => c.resolved), run: () => { tab.showResolved = !tab.showResolved; drawNotes(tab); } },
      { key: 'v', label: 'Review my suggestions (y n A a)', cmd: 'Review your suggestions on this note', when: () => note && !!(tab.proof || proofRun(tab)), run: () => reviewSuggestions(tab) },
      { key: 's', label: 'Sketch: a board to draw on', cmd: 'Sketch: a blank board to draw on, below the cursor', when: () => note, run: () => newSketchHere(tab) },
      { key: 'f', label: 'Sketch → flow', cmd: 'Sketch: read it as a flow (below it)', when: () => note, run: () => sketchToFlowHere(tab) },
      { key: 'm', label: S.meeting ? 'Leave meeting mode' : 'Meeting mode', cmd: 'Meeting mode (large text, for sharing the screen)', run: toggleMeeting },
    ] },
    { key: 'q', label: 'macro', items: [
      { key: 'q', label: macros.recording ? 'Stop recording' : 'Start recording', cmd: 'Macro: start / stop recording', emacs: 'kmacro-start-macro', run: toggleRecording },
      { key: 'r', label: 'Play', when: () => !!macros.last, run: () => playMacro(1), emacs: 'kmacro-end-and-call-macro' },
      { key: 'n', label: 'Play N times…', when: () => !!macros.last, run: playMacroTimes },
      { key: 'e', label: 'Play until it can’t go on', when: () => !!macros.last, run: () => playMacro(Infinity) },
      { key: 's', label: 'Play at every search result', when: () => !!macros.last && !!S.searchQuery.trim(), run: playAtResults },
      { key: 'v', label: 'Show the macro', when: () => !!macros.last, run: () => toast(describeMacro(macros.last)) },
      { key: 'k', label: `Keep it: save to ${MACROS_FILE}…`, cmd: 'Macro: save the last one (MACROS.md)…', when: () => !!macros.last, run: saveLastMacro, emacs: 'kmacro-name-last-macro' },
      { key: 'm', label: 'Play a kept one…', cmd: 'Macro: play a kept one…', when: () => kept.list.length > 0, run: pickKeptMacro },
      { key: 'E', label: `Edit macros (${MACROS_FILE})`, cmd: 'Macros: edit (MACROS.md)', run: editMacros },
    ] },
    { key: 'j', label: 'Jump to a word in view…', when: () => editorShown(tab), run: jumpInNote },
    { key: 'v', label: 'Expand the selection', when: () => editorShown(tab), run: () => tab.editor.expandSelection() },
    { key: 'V', label: 'Shrink the selection', when: () => editorShown(tab), run: () => tab.editor.shrinkSelection() },
    { key: 'y', label: 'Paste from the copy history…', when: () => copied.length > 0, run: pasteFromHistory },
    { key: '.', label: lastRun ? `Repeat: ${lastRun.label}` : 'Repeat the last command', run: repeatLast, mx: false },
    { key: 'h', label: 'help', items: [
      { key: 'k', label: 'Describe a key…', cmd: 'Describe a key…', run: describeKey },
      { key: 'c', label: 'Describe a command…', cmd: 'Describe a command…', run: describeCommand },
      { key: 'l', label: `Edit leader keys (${LEADER_FILE})`, cmd: 'Edit leader keys', run: editLeaderKeys },
      { key: 'm', label: 'Make or change a command… (ask the agent)', cmd: 'Make or change a command… (ask the agent)', run: () => changeByAgent() },
      { key: 's', label: 'Keyboard shortcuts…', cmd: 'Keyboard shortcuts…', run: () => openSettings({ keys: true }) },
    ] },
    { key: ',', label: 'Settings', run: () => openSettings() },
    { key: 'k', label: 'Keyboard shortcuts…', run: () => openSettings({ keys: true }) },
  ];
}

// The menu with your own keys (LEADER.md, leaderkeys.js) over Margin's.
const leaderKeys = { rules: [], errors: [], text: null };
function leaderTree() {
  const tree = defaultLeaderTree();
  return leaderKeys.rules.length ? applyLeaderKeys(tree, leaderKeys.rules, (name) => resolveCommand(name, tree)).tree : tree;
}

// A command by its M-x name, for a key of your own: one of the palette's, a
// recipe, or one of the leader's own.
function resolveCommand(name, tree = defaultLeaderTree()) {
  const n = norm(name);
  const c = COMMANDS.find(([x]) => norm(x) === n);
  if (c) return { cmd: c[0], run: c[1] };
  const r = recipes.list.find((x) => norm(`Recipe: ${x.name}`) === n || norm(x.name) === n);
  if (r) return { cmd: `Recipe: ${r.name}`, label: recipeLabel(r), recipe: r, run: () => runRecipe(r) };
  const k = kept.list.find((x) => norm(`Macro: ${x.name}`) === n);
  if (k) return { cmd: `Macro: ${k.name}`, label: k.name, run: () => playKept(k) };
  let hit = null;
  const walk = (items, group) => {
    for (const it of items) {
      if (hit) return;
      if (it.items) { walk(it.items, it.label); continue; }
      const full = group ? `${upper(group)}: ${it.label}` : it.label;
      if ([it.cmd, it.label, full].some((x) => x && norm(x) === n)) hit = { cmd: leafName(it, group), label: it.label, run: it.run, when: it.when };
    }
  };
  walk(tree, '');
  return hit;
}

async function loadLeaderKeys() {
  let text = '';
  if (S.files.some((f) => f.path === LEADER_FILE)) {
    try { text = (await api('GET', `/api/file?path=${encodeURIComponent(LEADER_FILE)}`)).content; } catch { text = ''; }
  }
  if (text === leaderKeys.text) return;
  const first = leaderKeys.text == null;
  leaderKeys.text = text;
  const parsed = parseLeaderKeys(text);
  leaderKeys.rules = parsed.rules;
  // What can't be followed (a command not there) is found now, once.
  const { errors } = applyLeaderKeys(defaultLeaderTree(), parsed.rules, (name) => resolveCommand(name));
  leaderKeys.errors = [...parsed.errors, ...errors].sort((a, b) => a.line - b.line);
  if (first && !leaderKeys.errors.length) return;
  const e = leaderKeys.errors[0];
  const more = leaderKeys.errors.length > 1 ? ` (and ${leaderKeys.errors.length - 1} more)` : '';
  if (e) toast(`${LEADER_FILE} line ${e.line}: ${e.msg}${more} — left out`, 'error', { label: 'Open', run: () => openFile(LEADER_FILE, { line: e.line }) });
  else toast(`${parsed.rules.length} leader key${parsed.rules.length === 1 ? '' : 's'} from ${LEADER_FILE} — ${kbd('leader') || '⌥X'} shows them`);
}

async function editLeaderKeys() {
  if (!S.files.some((f) => f.path === LEADER_FILE)) {
    try { await api('POST', '/api/file', { path: LEADER_FILE, content: LEADER_STARTER }); await loadTree(); } catch (e) { toast(e.message, 'error'); return; }
  }
  openFile(LEADER_FILE);
}

function openLeaderMenu() {
  if ($('.leader')) return;
  openLeader(leaderTree(), {
    title: kbd('leader') || 'Commands',
    // Again with ⌥X .: the same keys, looked up again (for the tab you're on then).
    onRun: (keys, it) => {
      if (['.', 'SPC', ':', 'q'].includes(keys[0])) return;
      const run = () => runLeaderKeys(keys);
      remember(it.label, run);
      macros.note(leaderCmdName(keys) || it.label, run);
    },
    isLeader: (e) => !!KEYS.leader && eventKeys(e, isMac) === KEYS.leader,
    onLeader: () => openPalette('>'),
  });
}

// Keyboard macros (macro.js): F3 records, F4 stops, then plays.
const macros = new Macros({
  editorNow: () => { const t = fileTab(); return t?.editor && editorShown(t) ? t.editor : null; },
  onChange: () => renderStatus(),
  isAppKey: (e) => appKeys.has(eventKeys(e, isMac)),
  mac: isMac,
});
macros.onWarn = (m) => toast(m, 'error');
const twoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function toggleRecording() {
  if (macros.recording) { stopRecording(); return; }
  macros.start();
  toast(`Recording a macro: ${kbd('macro-play') || '⌥X q q'} stops`);
}
function stopRecording() {
  const steps = macros.stop();
  toast(steps ? `Macro: ${describeMacro(steps)}. ${kbd('macro-play') || '⌥X q r'} plays it` : 'Nothing was recorded');
}
async function playMacro(times) {
  if (!macros.last) { toast(`No macro yet: ${kbd('macro-record') || '⌥X q q'} starts recording`); return; }
  const n = await macros.play(times);
  if (times !== 1 && n) toast(`The macro ran ${n} time${n === 1 ? '' : 's'}`);
}
async function playMacroTimes() {
  const v = await askText({ title: 'Play the macro', label: 'How many times?', value: '10', okLabel: 'Play' });
  const n = Number.parseInt(v, 10);
  if (n > 0) playMacro(n);
}
// Once at every search result, searched again first (the macro may have
// changed them); in each note from the bottom up, so lines don't move.
async function playAtResults() {
  try {
    const r = await api('GET', `/api/search?q=${encodeURIComponent(S.searchQuery)}`);
    // Notes open with changes not saved yet: their lines as they are now.
    const q = S.searchQuery.trim().toLowerCase();
    for (const t of S.tabs) {
      if (t.kind !== 'file' || t.content === t.saved) continue;
      const matches = t.content.split('\n').map((text, i) => ({ line: i + 1, text: text.slice(0, 240) })).filter((m) => m.text.toLowerCase().includes(q)).slice(0, 50);
      const at = r.results.findIndex((f) => f.path === t.path);
      if (at >= 0) r.results[at] = { ...r.results[at], matches };
      else if (matches.length) r.results.push({ path: t.path, nameHit: false, matches });
    }
    S.searchResults = r;
    S.searchAt = null;
    renderSearchResults();
  } catch (e) { toast(e.message, 'error'); return; }
  const hits = searchHits();
  const fileOrder = [...new Set(hits.map((x) => x.path))];
  const order = hits.map((x, i) => i).sort((a, b) => fileOrder.indexOf(hits[a].path) - fileOrder.indexOf(hits[b].path) || hits[b].line - hits[a].line);
  let n = 0;
  for (const i of order) {
    await openSearchHit(i);
    await twoFrames();
    if (!(await macros.play(1))) break;
    n++;
  }
  toast(`The macro ran at ${n} of ${hits.length} result${hits.length === 1 ? '' : 's'}`);
}

// Macros kept as a note (macrotext.js): MACROS.md, each a command —
// "Macro: <name>" in M-x, on keys of your own in LEADER.md. Their `run`
// steps find the command by name when they play.
const kept = { list: [], errors: [], text: null };
async function loadMacros({ quiet = false } = {}) {
  let text = '';
  if (S.files.some((f) => f.path === MACROS_FILE)) {
    try { text = (await api('GET', `/api/file?path=${encodeURIComponent(MACROS_FILE)}`)).content; } catch { text = ''; }
  }
  if (text === kept.text) return;
  const first = kept.text == null;
  kept.text = text;
  const parsed = parseMacros(text);
  kept.list = parsed.macros;
  kept.errors = parsed.errors;
  if (quiet || (first && !parsed.errors.length)) return;
  const e = parsed.errors[0];
  const more = parsed.errors.length > 1 ? ` (and ${parsed.errors.length - 1} more)` : '';
  if (e) toast(`${MACROS_FILE} line ${e.line}: ${e.msg}${more} — left out`, 'error', { label: 'Open', run: () => openFile(MACROS_FILE, { line: e.line }) });
  else toast(`${parsed.macros.length} macro${parsed.macros.length === 1 ? '' : 's'} from ${MACROS_FILE} — by name with M-x (Macro: …)`);
}

const keptDoc = (m) => `${m.doc ? `${m.doc} ` : ''}A keyboard macro kept in ${MACROS_FILE} (line ${m.line}): ${describeMacro(m.steps)}.`;

// A command by its name (M-x's, Emacs's, the leader menu's or a shortcut's)
// → what runs it, or null.
function commandRun(name) {
  const n = norm(name);
  const c = allCommands().find((x) => norm(x.name) === n || (x.alias && norm(x.alias) === n));
  if (c) return c.run;
  const r = resolveCommand(name);
  if (r) return r.run;
  const d = keyDefs().find((x) => norm(x.label || '') === n || x.id === name);
  return d && ACTIONS[d.id] ? () => ACTIONS[d.id]() : null;
}

function keptSteps(m) {
  const steps = [];
  for (const s of m.steps) {
    if (s.t !== 'cmd') { steps.push(s); continue; }
    const run = commandRun(s.label);
    if (!run) { toast(`“${m.name}” runs “${s.label}”, and no command has that name (M-x lists them)`, 'error', { label: 'Open', run: () => openFile(MACROS_FILE, { line: m.line }) }); return null; }
    steps.push({ ...s, run });
  }
  return steps;
}

// Played as the last macro is (and it becomes the last one: ⌥X q n plays it
// again). From another macro, or while recording: its steps, in that run.
let keptDepth = 0;
async function playKept(m) {
  const steps = keptSteps(m);
  if (!steps) return;
  if (!macros.playing && !macros.recording) { macros.last = steps; await macros.play(1, steps); return; }
  if (keptDepth >= 8) throw new MacroStop(`macros running each other, too deep (${m.name})`);
  const outer = macros.playing;
  keptDepth++;
  macros.playing = true; // a recording keeps "Macro: name", not what it does
  try { await macros.once(steps); } catch (e) {
    if (outer || !(e instanceof MacroStop)) throw e;
    toast(`Macro stopped: ${e.message}`, 'error');
  } finally { keptDepth--; macros.playing = outer; }
}

function pickKeptMacro() {
  picker({
    placeholder: `Play a kept macro…  (${MACROS_FILE})`,
    source: (q) => kept.list.map((m) => ({ m, f: fuzzy(q, m.name) })).filter((x) => x.f)
      .sort((a, b) => (q ? b.f.score - a.f.score : 0))
      .map(({ m }) => ({ label: m.name, hint: m.doc || describeMacro(m.steps), run: () => playKept(m) })),
  });
}

// The last macro, kept under a name (one of the same name is replaced).
async function saveLastMacro() {
  if (!macros.last) { toast(`No macro yet: ${kbd('macro-record') || '⌥X q q'} starts recording`); return; }
  const name = (await askText({ title: 'Keep the macro', label: `A name for it: M-x lists it as “Macro: <name>”. Kept in ${MACROS_FILE}, a note you can edit.`, placeholder: 'Make it a task', okLabel: 'Keep' }))?.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!name) return;
  const open = S.tabs.find((t) => t.kind === 'file' && t.path === MACROS_FILE);
  if (open && open.content !== open.saved) { toast(`${MACROS_FILE} has changes not saved yet: save it first.`, 'error'); return; }
  if (kept.list.some((m) => m.name.toLowerCase() === name.toLowerCase()) && !(await askConfirm(`Replace the macro “${name}” in ${MACROS_FILE}?`, { okLabel: 'Replace' }))) return;
  try {
    const f = S.files.some((x) => x.path === MACROS_FILE) ? await api('GET', `/api/file?path=${encodeURIComponent(MACROS_FILE)}`) : null;
    const content = withMacro(f?.content || '', name, macros.last);
    if (f) await api('PUT', '/api/file', { path: MACROS_FILE, content, baseHash: f.hash });
    else { await api('POST', '/api/file', { path: MACROS_FILE, content }); await loadTree(); }
    await loadMacros({ quiet: true });
    const line = kept.list.find((m) => m.name === name)?.line;
    toast(`Kept as “Macro: ${name}”: M-x plays it, and ${LEADER_FILE} can put it on keys`, '', { label: 'Open', run: () => openFile(MACROS_FILE, line ? { line } : undefined) });
  } catch (e) { toast(e.message, 'error'); }
}

async function editMacros() {
  if (!S.files.some((f) => f.path === MACROS_FILE)) {
    try { await api('POST', '/api/file', { path: MACROS_FILE, content: MACROS_STARTER }); await loadTree(); await loadMacros(); } catch (e) { toast(e.message, 'error'); return; }
  }
  openFile(MACROS_FILE);
}

// The name a recorded leader key keeps: the command's, so a kept macro finds
// it again (keys can move).
function leaderCmdName(keys) {
  let items = leaderTree();
  let group = '';
  let it = null;
  for (const k of keys) {
    it = items.find((x) => x.key === k && (!x.when || x.when()));
    if (!it) return null;
    if (it.items) { group = it.label; items = it.items; }
  }
  return it && !it.items ? leafName(it, group) : null;
}

function runLeaderKeys(keys) {
  let items = leaderTree();
  let it = null;
  for (const k of keys) { it = items.find((x) => x.key === k && (!x.when || x.when())); if (!it) break; items = it.items || []; }
  if (it?.run) it.run(); else toast('That command isn’t available here');
}

// The buffer list (Emacs C-x b): open notes and those closed but kept, the
// most recent first — the one before this is at the top — and Margin's own
// buffers (tasks, search, runs, messages…), open or not.
const bufferName = (t) => (SPECIAL[t.kind] ? SPECIAL[t.kind].name(t) : t.path ? basename(t.path) : t.title || t.kind);
function pickTab() {
  const cur = activeTab();
  const list = buffers().filter((b) => b.tab !== cur).concat(cur ? [{ tab: cur, closed: false }] : []);
  const more = Object.entries(SPECIAL).filter(([kind, sp]) => sp.make && !S.tabs.some((t) => t.kind === kind)).map(([kind, sp]) => ({ kind, make: sp.make }));
  picker({
    placeholder: 'Switch to a buffer…  (closed notes keep their place)',
    source: (q) => [
      ...list.map((b) => ({ name: bufferName(b.tab), icon: b.closed ? '○' : SPECIAL[b.tab.kind] ? '◆' : b.tab.group === 1 ? '◫' : '●',
        hint: [b.tab.path && !SPECIAL[b.tab.kind] ? dirname(b.tab.path) : '', b.closed ? 'closed' : b.tab === cur ? 'here' : ''].filter(Boolean).join(' · '),
        run: () => showBuffer(b) })),
      ...more.map((x) => ({ name: SPECIAL[x.kind].name({ kind: x.kind }), icon: '◇', hint: 'not open', run: () => x.make() })),
    ].map((x) => ({ ...x, m: fuzzy(q, x.name) })).filter((x) => x.m)
      .sort((a, b) => (q ? b.m.score - a.m.score : 0))
      .map((x) => ({ icon: x.icon, label: marked(x.name, x.m.idx), hint: x.hint, run: x.run })),
  });
}

function cycleTab(by) {
  const list = S.tabs.filter((t) => t.group === S.focus);
  const i = list.indexOf(activeTab());
  if (list.length < 2) return;
  activate(list[(i + by + list.length) % list.length].id);
  focusEditor();
}

// Moving the focus without the mouse.
function focusEditor() {
  const t = activeIn(S.focus);
  if (!t) return;
  if (SPECIAL[t.kind]) { requestAnimationFrame(() => bufferEl(t)?.focus({ preventScroll: true })); return; }
  if (isFileTab(t) && !editorShown(t)) { focusPreview(t); return; }
  requestAnimationFrame(() => t.editor?.focus());
}
function focusPreview(t = fileTab()) {
  const p = t?.previewEl;
  if (!p?.isConnected) return;
  p.tabIndex = -1;
  p.focus({ preventScroll: true });
}
const LIST_ROWS = '.tree-row, .outline-row, .search-file, .search-hit';
function focusSidebar() {
  const app = $('#app');
  if (app.classList.contains('no-sidebar')) { app.classList.remove('no-sidebar'); persist(); renderSidebar(); }
  const sb = $('#sidebar');
  if (S.view === 'search' && !sb.querySelector('.search-hit, .search-file')) { $('#search-input')?.focus(); return; }
  focusRow(sb.querySelector('.tree-row.active[data-path]') || sb.querySelector(LIST_ROWS));
}
function focusRow(row) {
  if (!row) return;
  row.tabIndex = -1;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest' });
}

// Lists in the sidebar (tree, bookmarks, outline, backlinks, search results):
// ↑↓ or j/k move, Enter opens (⌘/Ctrl+Enter: to the side), →/← or l/h open
// and close folders, F2 renames, ⌘⌫ / Delete deletes, Esc goes back to the
// editor.
function sidebarKeys(e) {
  const row = e.target.closest?.(LIST_ROWS);
  if (!row || e.altKey) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const rows = () => [...$('#sidebar').querySelectorAll(LIST_ROWS)].filter((r) => r.offsetParent);
  const move = (by) => { const all = rows(); focusRow(all[Math.max(0, Math.min(all.length - 1, all.indexOf(row) + by))]); };
  const folder = row.classList.contains('tree-row') && !row.dataset.path && !row.dataset.bookmark;
  const open = folder && row.querySelector('.chev')?.textContent === '▾';
  const k = e.key;
  const done = () => { e.preventDefault(); e.stopPropagation(); };
  if (k === 'ArrowDown' || (k === 'j' && !mod)) { done(); move(1); }
  else if (k === 'ArrowUp' || (k === 'k' && !mod)) { done(); move(-1); }
  else if (k === 'Home' || (k === 'g' && !mod && !e.shiftKey)) { done(); focusRow(rows()[0]); }
  else if (k === 'End' || (k === 'G' && !mod)) { done(); focusRow(rows().at(-1)); }
  else if (k === 'Enter' || (k === 'o' && !mod)) {
    done();
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: isMac && mod, ctrlKey: !isMac && mod }));
    if (folder) requestAnimationFrame(() => focusRow([...$('#sidebar').querySelectorAll('.tree-row')].find((r) => r.title === row.title && !r.dataset.path)));
  } else if ((k === 'ArrowRight' || (k === 'l' && !mod)) && folder) { done(); if (!open) row.click(); else move(1); }
  else if ((k === 'ArrowLeft' || (k === 'h' && !mod)) && row.classList.contains('tree-row')) {
    done();
    if (folder && open) { row.click(); return; }
    const parent = dirname(folder ? row.title : row.dataset.path || '');
    const up = parent && [...$('#sidebar').querySelectorAll('.tree-row')].find((r) => r.title === parent && !r.dataset.path);
    if (up) focusRow(up);
  } else if (k === 'F2' && row.classList.contains('tree-row')) { done(); renameItem(folder ? row.title : row.dataset.path || row.dataset.bookmark, folder); }
  else if ((k === 'Delete' || (k === 'Backspace' && mod)) && row.classList.contains('tree-row') && !row.dataset.bookmark) { done(); deleteItem(folder ? row.title : row.dataset.path, folder); }
  else if (k === 'Escape') { done(); focusEditor(); }
}
$('#sidebar').addEventListener('keydown', sidebarKeys);

// The preview, focused (leader w p): j/k and Space scroll, f picks a link,
// / finds, Esc goes back to the editor.
function previewKeys(e, tab) {
  const p = tab.previewEl;
  if (e.target !== p || e.metaKey || e.ctrlKey || e.altKey) return;
  const by = { j: 60, ArrowDown: 60, k: -60, ArrowUp: -60, d: p.clientHeight / 2, u: -p.clientHeight / 2, ' ': (e.shiftKey ? -0.9 : 0.9) * p.clientHeight }[e.key];
  if (by) { e.preventDefault(); p.scrollBy({ top: by }); return; }
  if (e.key === 'g') { e.preventDefault(); p.scrollTop = 0; }
  else if (e.key === 'G') { e.preventDefault(); p.scrollTop = p.scrollHeight; }
  else if (e.key === 'f') { e.preventDefault(); linkHints(p); }
  else if (e.key === '/') { e.preventDefault(); findInNote(tab); }
  else if (e.key === 'Escape' && editorShown(tab)) { e.preventDefault(); tab.editor.focus(); }
}

let lastCommand = { name: '', t: 0 };
function runCommand(name) {
  const now = performance.now();
  if (lastCommand.name === name && now - lastCommand.t < 150) return;
  lastCommand = { name, t: now };
  if (!ACTIONS[name]) return;
  if (NOT_REPEATED.has(name)) { ACTIONS[name](); return; }
  const label = keyDefs().find((d) => d.id === name)?.label || name;
  const run = () => ACTIONS[name]();
  remember(label, run);
  macros.command(label, run);
}

// Jump labels (avy, hop.nvim, flash.nvim): a letter or two on every word in
// view; typing one puts the cursor there. A step in the jump list.
async function jumpInNote() {
  const tab = fileTab();
  if (!editorShown(tab)) return;
  const ed = tab.editor;
  if (document.activeElement !== ed.ta) ed.focus();
  const offset = await pickHint(ed.jumpTargets().map((p) => ({ left: p.left, top: p.top, value: p.offset })));
  if (offset == null) return;
  navJump(tab);
  ed.selectRange(offset);
}

// Copy history (Emacs kill ring, Sublime's paste from history): what was
// copied or cut in Margin during this session, newest first. Kept only in
// memory.
// It is the kill ring of Emacs keys too (emacs.js): what ⌃K and ⌃W killed
// and M-w copied is here, and ⌃Y yanks what was copied.
const copied = emacs.ring.items;
function rememberCopy() {
  const el = document.activeElement;
  const text = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text'))
    ? el.value.slice(el.selectionStart, el.selectionEnd) : String(getSelection());
  if (!text.trim() || text.length > 100_000) return;
  emacs.ring.push(text);
}
document.addEventListener('copy', rememberCopy, true);
document.addEventListener('cut', rememberCopy, true);

function pasteFromHistory() {
  const tab = fileTab();
  const ed = editorShown(tab) ? tab.editor : null;
  if (!ed) { toast('Open a note in the editor to paste into it.'); return; }
  if (!copied.length) { toast('Nothing copied yet in this session.'); return; }
  const at = [ed.selectionStart, ed.selectionEnd];
  const one = (x) => x.replace(/\s+/g, ' ').trim();
  picker({
    placeholder: 'Paste from the copy history…  (this session, newest first)',
    source: (q) => copied.map((x, i) => ({ x, i, m: fuzzy(q, one(x).slice(0, 300)) })).filter((y) => y.m)
      .sort((a, b) => (q ? b.m.score - a.m.score : a.i - b.i))
      .map(({ x, i }) => ({
        icon: String(i + 1),
        label: one(x).slice(0, 120),
        hint: x.includes('\n') ? `${x.split('\n').length} lines` : `${x.length} chars`,
        run: () => { ed.focus(); ed.replace(at[0], at[1], x); },
      })),
    onCancel: () => ed.focus(),
  });
}

// Emacs keys (emacs.js): what they do in the app.
Object.assign(emacs.hooks, {
  echo: showEcho,
  save: () => runCommand('save'),
  findFile: () => openPalette(),
  buffers: pickTab,
  killBuffer: () => activeTab() && closeTab(activeTab().id),
  otherWindow: () => { if (S.groups.length > 1) { splitRight(); focusEditor(); } else showEcho('There is no other pane'); },
  split: () => { if (S.groups.length < 2) { splitRight(); if (!document.querySelector('#overlay:not([hidden])')) focusEditor(); } else showEcho('Split already'); },
  dired: () => diredHere(),
  repeat: repeatLast,
  macroStart: () => { if (!macros.recording) toggleRecording(); },
  // ⌃X ) and ⌃X e while recording: the ⌃X before isn't part of the macro.
  macroEnd: () => {
    const r = macros.recording;
    if (!r) { showEcho('Not recording a macro'); return; }
    while (r.at(-1)?.t === 'key' && r.at(-1).ctrlKey && r.at(-1).code === 'KeyX') r.pop();
    stopRecording();
  },
  macroPlay: (n) => (macros.recording ? emacs.hooks.macroEnd() : playMacro(n)),
  navBack: () => navGo(-1),
  gotoLine: () => openPalette(':'),
  pasteHistory: pasteFromHistory,
  occur: () => occur(),
  nextMatch: (n) => stepOccur(n),
  narrow: () => narrowHere(),
  widen: () => widenHere(),
  where: (ed) => S.tabs.find((t) => t.editor === ed)?.path ?? null,
  jump: async (path, offset) => {
    if (!path || !S.files.some((f) => f.path === path)) { showEcho('That note is gone'); return; }
    await openFile(path);
    const t = S.tabs.find((x) => x.kind === 'file' && x.path === path);
    if (t?.editor) requestAnimationFrame(() => { navJump(t); gotoOffset(t, Math.min(offset, t.editor.value.length)); });
  },
  fillColumn: (c) => setSetting('fillColumn', c),
});

async function setFillColumn() {
  const v = await askText({ title: 'Fill column', label: 'Where filling a paragraph wraps its lines (columns; Korean characters count two)', value: String(emacs.fillColumn), okLabel: 'Set' });
  const n = Number.parseInt(v, 10);
  if (n >= 10) { setSetting('fillColumn', n); showEcho(`Fill column set to ${n}`); }
  fileTab()?.editor?.focus();
}

// An Emacs command from the leader menu (works with Emacs keys off too).
function emacsRun(tab, cmd, { raw = false } = {}) {
  const ed = tab?.editor;
  if (!ed) return;
  if (groupMode(tab) === 'preview') setMode('split');
  ed.focus();
  if (raw) ed.emacs.arg = { n: 4, u: true, digits: '', neg: false, open: false };
  ed.emacs.command(cmd);
}

function queryReplaceIn(tab = fileTab(), regex = false) {
  if (!tab?.editor) return;
  if (groupMode(tab) === 'preview') setMode('split');
  tab.editor.focus();
  tab.editor.queryReplace({ regex });
}

// Registers (⌃X r): places and pieces of text kept for the session.
function listRegisters() {
  const tab = fileTab();
  if (!emacs.registers.size) { toast('No registers yet: ⌥X x r keeps a place, ⌥X x s a piece of text'); return; }
  picker({
    placeholder: 'Registers…  (Enter: go to the place, put in the text)',
    source: (q) => [...emacs.registers].filter(([k, r]) => fuzzy(q, `${k} ${r.text ?? r.path ?? ''}`)).map(([k, r]) => ({
      icon: k,
      label: r.text != null ? r.text.replace(/\s+/g, ' ').slice(0, 100) : `${r.path ? stem(r.path) : 'a note'} · ${r.offset}`,
      hint: r.text != null ? `${r.text.length} chars` : 'a place',
      run: () => {
        if (r.text == null) { emacs.hooks.jump(r.path, r.offset); return; }
        const ed = editorShown(tab) ? tab.editor : null;
        if (!ed) { toast('Open a note in the editor to put it in.'); return; }
        ed.focus();
        ed.replace(ed.selectionStart, ed.selectionEnd, r.text);
      },
    })),
    onCancel: () => fileTab()?.editor?.focus(),
  });
}

// ------------------------------------------------------------------ occur
// The lines of a note that match, in a buffer of their own (Emacs's occur,
// M-s o, ⌥X s o): Enter or o goes to one, g looks again, M-g n / M-g p
// step through them from the note.

async function occur(tab = fileTab()) {
  const ed = tab?.editor;
  if (!ed) { toast('Open a note to look in it.'); return; }
  const v = ed.value;
  const [a, b] = [ed.selectionStart, ed.selectionEnd];
  const picked = v.slice(a, b);
  const word = /[\p{L}\p{N}_]*$/u.exec(v.slice(0, a))[0] + /^[\p{L}\p{N}_]*/u.exec(v.slice(a))[0];
  const q = await askText({ title: 'Occur', label: `Lines of ${stem(tab.path)} that match (a regular expression; a capital letter makes case matter)`, value: picked && !picked.includes('\n') ? picked : word || S.occurQuery || '', okLabel: 'List' });
  if (!q) { ed.focus(); return; }
  S.occurQuery = q;
  const t = openSpecial('occur', { path: tab.path, query: q });
  Object.assign(t, { path: tab.path, query: q, hits: null, cur: null });
  refreshOccur(t);
}

async function refreshOccur(t) {
  let text = S.tabs.find((x) => x.kind === 'file' && x.path === t.path)?.content;
  if (text == null) try { text = (await api('GET', `/api/file?path=${encodeURIComponent(t.path)}`)).content; } catch (e) { toast(e.message, 'error'); return; }
  t.hits = occurLines(text, occurPattern(t.query));
  if (S.groups[t.group]?.active === t.id) renderContent(t.group);
}

function occurView(tab) {
  const wrap = h('div', { class: 'review buffer-list occur-buffer' });
  const hits = tab.hits;
  wrap.append(h('div', { class: 'review-head' },
    h('div', { class: 'task' }, `Occur: “${tab.query}”`),
    h('div', { class: 'meta' },
      h('span', {}, hits ? `${hits.length} line${hits.length === 1 ? '' : 's'} in ${stem(tab.path)}` : 'Looking…'),
      h('span', { class: 'review-keys', title: keysHint('occur') }, 'j k · o go · g again · q close'))));
  if (hits && !hits.length) wrap.append(h('div', { class: 'review-note' }, 'No line matches.'));
  for (const hit of hits || []) {
    const parts = [];
    let at = 0;
    for (const [x, y] of hit.ranges) { parts.push(hit.text.slice(at, x), h('mark', {}, hit.text.slice(x, y))); at = y; }
    parts.push(hit.text.slice(at));
    wrap.append(h('div', { class: 'occur-row kb-item', 'data-path': tab.path, 'data-hunk': hit.line, 'data-line': hit.line, onclick: () => openOccurAt(tab, wrap.querySelector(`[data-line="${hit.line}"]`)) },
      h('span', { class: 'occur-line' }, String(hit.line)), h('span', { class: 'occur-text' }, ...parts)));
  }
  return wrap;
}

async function openOccurAt(tab, el) {
  const hit = el && tab.hits?.find((x) => x.line === Number(el.dataset.line));
  if (!hit) return;
  tab.cur = `${tab.path}#${hit.line}`;
  await openFile(tab.path, { line: hit.line });
  const t = S.tabs.find((x) => x.kind === 'file' && x.path === tab.path);
  if (!t?.editor) return;
  requestAnimationFrame(() => {
    const o = lineOffset(t.editor.value, hit.line - 1);
    gotoOffset(t, o + hit.ranges[0][0], o + hit.ranges[0][1]);
  });
}

// M-g n / M-g p: the next occur line (else the next search result).
function stepOccur(n) {
  const t = S.tabs.find((x) => x.kind === 'occur');
  if (!t?.hits?.length) { stepSearch(n); return; }
  const lines = t.hits.map((x) => x.line);
  const at = lines.indexOf(Number(t.cur?.split('#')[1]));
  const i = at < 0 ? (n > 0 ? 0 : lines.length - 1) : at + n;
  if (i < 0 || i >= lines.length) { showEcho(n > 0 ? 'No more lines' : 'No lines before'); return; }
  openOccurAt(t, { dataset: { line: String(lines[i]) } });
  showEcho(`${i + 1} / ${lines.length}`);
}

// Repeat the last command (Emacs C-x z, Vim's .): from the leader menu, the
// palette or a shortcut. Opening a menu or a picker isn't one.
const NOT_REPEATED = new Set(['undo', 'redo', 'leader', 'palette', 'quick-open', 'repeat', 'save', 'settings', 'macro-record', 'macro-play', 'jump', 'paste-history', 'buffers']);
let lastRun = null;
function remember(label, run) { lastRun = { label, run }; }
function repeatLast() {
  if (!lastRun) { toast('No command to repeat yet'); return; }
  lastRun.run();
}
desktop?.onCommand?.(runCommand);

// Notes opened from the OS (Open File…, a drop, Finder, the Dock) arrive as
// workspace-relative paths, possibly before boot() has finished.
let booted;
const bootDone = new Promise((resolve) => { booted = resolve; });
desktop?.onOpenNote?.(async (rel) => {
  await bootDone;
  if (!S.files.some((f) => f.path === rel)) await loadTree();
  await openFile(rel);
  render();
});

// Dropping notes or folders from Finder/Explorer opens them. Other files
// dropped on a note are attached (editor.js); anywhere else they're ignored
// instead of replacing the page.
function droppedToOpen(dt) {
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  if (!items.length || items.length !== dt.files.length) return null;
  const ok = items.every((item, i) => item.webkitGetAsEntry?.()?.isDirectory || isNote(dt.files[i].name));
  return ok ? [...dt.files] : null;
}
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (!e.target.closest?.('.ed-input')) e.dataTransfer.dropEffect = desktop ? 'copy' : 'none';
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  const files = desktop?.openDropped && droppedToOpen(e.dataTransfer);
  if (files) { e.preventDefault(); e.stopPropagation(); desktop.openDropped(files); return; }
  if (!e.target.closest?.('.ed-input')) e.preventDefault();
}, true);

// Mouse back/forward buttons (3 and 4).
window.addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
window.addEventListener('mouseup', (e) => {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  runCommand(e.button === 3 ? 'nav-back' : 'nav-forward');
});

async function boot() {
  applySettings();
  await loadShortcuts();
  if (!token) {
    $('#panes').replaceChildren(h('div', { class: 'welcome' }, h('h1', {}, 'Session token missing'),
      h('p', {}, 'For your safety the API only answers to the exact URL printed in the terminal. Open that URL (it contains ?t=…).')));
    return;
  }
  try { S.info = await api('GET', '/api/info'); }
  catch (e) {
    $('#panes').replaceChildren(h('div', { class: 'welcome' }, h('h1', {}, 'Cannot connect'), h('p', {}, e.message)));
    return;
  }
  document.title = `${S.info.name} — Margin`;
  $('#titlebar').textContent = `${S.info.name} — Margin`;
  S.recent = JSON.parse(store.getItem(`an.recent.${S.info.root}`) || '[]');
  try { S.bookmarks = JSON.parse(store.getItem(`an.bookmarks.${S.info.root}`) || '[]').filter((p) => typeof p === 'string'); } catch { S.bookmarks = []; }
  await Promise.all([loadTree(), loadRuns(), loadTags(), loadGit(), loadOutside()]);
  loadRecipes().then(() => loadMacros()).then(loadLeaderKeys);
  const saved = JSON.parse(store.getItem(`an.tabs.${S.info.root}`) || 'null');
  // v0.2 format was { open, active }; v0.3 stores one entry per pane.
  const groups = saved?.groups || (saved ? [{ open: saved.open, active: saved.active }] : []);
  for (const [g, grp] of groups.slice(0, 2).entries()) {
    if (!grp.open?.some((p) => S.files.some((f) => f.path === p))) continue;
    if (g === 1) ensureSecondGroup();
    if (grp.mode) S.groups[g].mode = grp.mode;
    for (const p of grp.open) if (S.files.some((f) => f.path === p)) await openFile(p, { focus: false, group: g });
    const act = S.tabs.find((t) => t.path === grp.active);
    if (act) activate(act.id);
  }
  if (S.groups[saved?.focus]) S.focus = saved.focus;
  nav.ready = true;
  navRecord(activeTab());
  render();
  connectEvents();
  desktop?.uiReady?.();
}

boot().finally(() => booted());
