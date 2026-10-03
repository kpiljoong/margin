import { renderMarkdown, outline, slug } from './markdown.js';
import { store } from './store.js';
import { linkAt } from './links.js';
import { PreviewFind } from './previewfind.js';
import { openLeader, linkHints } from './leader.js';
import { Macros, describe as describeMacro } from './macro.js';
import { fillTemplate, isTemplate, TEMPLATE_DIR } from './templates.js';
import { MarkdownEditor, setEditorKeys } from './editor.js';
import { renderDiagrams } from './diagrams.js';
import { flowToMermaid, flowsAsMermaid, parseFlow, isStepText, flowStepNames, nameKey, flowTour, flowLineAt } from './flow.js';
import { FigureCanvas } from './canvas.js';
import { goalAt, boxAt, mentionRanges, definitionLines } from './figure-goal.js';
import { isDrawing, drawingFormat, DrawingFrame, renderDrawingEmbeds, cachedEmbed, forgetEmbed, drawingImageUrl } from './drawing.js';
import { copyPng, copySvg, svgFromDataUrl, imageToPng } from './clip.js';
import { openViewer } from './viewer.js';
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
function toast(msg, kind = '', action = null) {
  messages.push({ at: new Date(), msg: String(msg), kind });
  if (messages.length > 200) messages.shift();
  const el = $('#toast');
  el.replaceChildren(msg, action ? h('button', { class: 'toast-action', onclick: () => { el.hidden = true; action.run(); } }, action.label) : '');
  el.className = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : kind === 'error' ? 6000 : 2800);
}

const basename = (p) => p.split('/').pop();
const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const stem = (p) => basename(p).replace(/\.[^.]+$/, '');
const isNote = (p) => /\.(md|markdown|mdx|txt)$/i.test(p);
const isMermaidFile = (p) => /\.(mmd|mermaid)$/i.test(p || '');
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
  // Labs: off until turned on in Settings.
  labSteadyDraw: false, labWheelPans: false,
  // The file tree shows the active tab's file (as VS Code's Auto Reveal).
  followTab: true,
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
  for (const t of S.tabs) t.editor?.setOptions({ highlight: st.highlight, spellcheck: st.spellcheck });
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
    if (!f.note && (isDrawing(f.path) || isMermaidFile(f.path))) {
      // ![[sketch.excalidraw]] / ![[flow.mmd]] embed a drawing or diagram from anywhere.
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
  if (tab.editor) {
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
  if (!q.trim()) { S.searchResults = null; renderSearchResults(); return; }
  try {
    const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
    if (q === S.searchQuery) { S.searchResults = r; S.searchAt = null; renderSearchResults(); }
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
      h('div', { class: 'task', title: r.task }, r.task),
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
    const label = t.kind === 'review' ? `Review: ${t.title}` : t.kind === 'gitdiff' ? `Δ ${basename(t.path)}` : t.kind === 'history' ? `History: ${stem(t.path)}` : basename(t.path);
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
  if (tab.kind === 'review') { c.replaceChildren(reviewView(tab)); return; }
  if (tab.kind === 'gitdiff') { c.replaceChildren(gitDiffView(tab)); return; }
  if (tab.kind === 'history') { c.replaceChildren(historyView(tab)); return; }
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
    onChange: (v) => { tab.content = v; onEdit(tab); },
    onScroll: () => { if (isAttached(tab) && !tab.restoring) { tab.scroll = ed.scrollTop; syncScroll(tab); } },
    onCursor: renderStatus,
    complete: completeFor,
    onPasteFiles: (files) => attachFiles(tab, files),
  });
  ed.value = tab.content;
  ed.setOptions({ highlight: S.settings.highlight, spellcheck: S.settings.spellcheck });
  tab.editor = ed;
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
  p.innerHTML = renderMarkdown(tab.content, { image: (url) => localImage(url, tab.path), embed: (target, label) => fileEmbed(target, label, tab.path) });
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

const FIGURE_BLOCK = 'pre[data-lang="mermaid" i], pre[data-lang="flow" i], .mmd-embed, .drawing-embed';
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
    onNode: (pre, id) => gotoBox(tab, pre, id),
    // Clicks beside the boxes keep the keys on the canvas; a box's text is
    // for editing, so a click on a box goes to the editor (onNode).
    onFigure: (fig) => gotoOffset(tab, lineOffset(tab.editor.value, Number(fig.dataset.line) || 0), undefined, false),
    onSection: (sec) => gotoOffset(tab, lineOffset(tab.editor.value, sec.line), undefined, false),
    canRename: (pre) => !!pre?.flowNodes,
    onRename: (pre, node, text) => renameBox(tab, pre, node, text),
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

// The steps of a presentation: section by section, each ```flow picture
// along its arrows (flowTour), other pictures whole. A step's caption: the
// box, its note, the arrow it was reached by, and what the section's text
// says it is (`- Name: …` items, definitionLines). At a step with several ways out, `choices` lists them (a
// number picks one: `prefer`, pre → { stepId: [ids first] }); going back to
// such a step and arrows to a step shown already are steps of their own.
function presentSteps(tab, prefer = new Map()) {
  const v = tab.editor.value;
  const secs = tab.canvasSections || [];
  const steps = [];
  secs.forEach((sec, k) => {
    // Its text, and that of an intro above it without pictures of its own.
    let start = k;
    while (start > 0 && !secs[start - 1].figures.length) start--;
    const begin = secs[start].line;
    const end = secs[k + 1]?.line ?? Infinity;
    for (const pre of sec.figures) {
      if (!pre.flowNodes) { steps.push({ pre, id: null, title: sec.title, text: '', note: '', via: '', lines: [] }); continue; }
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
  let sec = { title: stem(tab.path), line: 0, figures: [] };
  const sections = [sec];
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
    }
  }
  const seen = new Map();
  for (const s of sections) { const n = (seen.get(s.title) || 0) + 1; seen.set(s.title, n); s.key = `${s.title}#${n}`; }
  tab.canvasSections = sections;
  cv.setCards(sections.filter((s) => s.figures.length));
  renderDiagrams(cv.world);
  if (cv.world.querySelector('.drawing-embed:not(.ready)')) fillDrawingEmbeds(cv.world);
  if (cv.world.querySelector('.mmd-embed.loading')) fillMermaidEmbeds(cv.world).then(() => renderDiagrams(cv.world));
  followCursor(tab);
}

// The pictures' part of a figure, as public/figure-goal.js reads it.
const figInfo = (fig) => ({
  line: Number(fig.dataset.line) || 0,
  source: fig.matches('pre[data-lang]') ? (fig.dataset.source ?? fig.textContent) : null,
  flowNodes: fig.flowNodes,
  diagramNodes: fig.diagramNodes,
});

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
  tab.editor.replace(start, end, out.join('\n'), caret);
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
  if (pic && !pic.closest('a, pre, .drawing-embed, .mmd-embed') && pic.naturalWidth) { viewImage(pic); return; }
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
  if (macros.recording) items.splice(2, 0, h('span', { class: 'item rec clickable', title: 'Click to stop recording', onclick: stopRecording }, `● Recording macro · ${kbd('macro-play') || '⌥X q q'} stops`));
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

function fuzzy(qRaw, text) {
  const q = qRaw.replace(/\s+/g, ''); // spaces are separators, not characters to match
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = [];
  let score = 0;
  let last = -1;
  for (const ch of ql) {
    const i = t.indexOf(ch, last + 1);
    if (i === -1) return null;
    score += i === last + 1 ? 3 : 1;
    if (i === 0 || '/-_ .'.includes(t[i - 1])) score += 2;
    idx.push(i);
    last = i;
  }
  return { score: score - text.length * 0.01, idx };
}

function marked(text, idx) {
  const set = new Set(idx);
  return [...text].map((c, i) => (set.has(i) ? h('b', {}, c) : c));
}

const COMMANDS = [
  ['Switch note (buffers)…', () => setTimeout(pickTab, 0), { key: 'buffers' }],
  ['Back to the note before', otherBuffer, { key: 'other-note' }],
  ['Messages…', () => setTimeout(showMessages, 0)],
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

// Generic keyboard-first picker used by quick open, commands and themes.
function picker({ placeholder, initial = '', source, onMove, onCancel }) {
  const overlay = $('#overlay');
  let sel = 0;
  let items = [];
  const input = h('input', { class: 'input', placeholder, value: initial, spellcheck: false });
  const list = h('div', { class: 'palette-list' });
  let done = false;
  const close = (cancelled) => {
    if (done) return;
    done = true;
    overlay.hidden = true;
    overlay.replaceChildren();
    if (cancelled) onCancel?.();
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
      if (q.startsWith('>')) {
        const cq = q.slice(1).trim();
        return COMMANDS.map(([name, run, key]) => ({ name, run, key, m: fuzzy(cq, name) })).filter((x) => x.m)
          .sort((a, b) => b.m.score - a.m.score)
          .map((x) => ({ label: marked(x.name, x.m.idx), hint: x.key?.key ? kbd(x.key.key) : x.key, run: () => { remember(x.name, x.run); macros.command(x.name, x.run); } }));
      }
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
        toggle('followTab', 'Tree follows the active tab', 'Selecting a tab opens its folders in the file tree and scrolls to it (also ⇅ at the top of the tree). Off: use ◎ in the tree.')),
      h('div', { class: 'set-label' }, 'Labs'),
      h('p', { class: 'set-detail' }, 'Experiments you can turn on and off. They may change or go away.'),
      h('div', { class: 'set-toggles' },
        toggle('labSteadyDraw', 'Steady live drawing', 'While you type in a ```flow block, keep the picture until the line is whole and you pause, so boxes don’t jump at every key.'),
        toggle('labWheelPans', 'Canvas: the wheel moves', 'Scrolling or two fingers move the canvas; pinch or ⌘/Ctrl + wheel zooms. Off: the wheel zooms.')),
      h('div', { class: 'set-label', id: 'set-keys' }, 'Keyboard shortcuts'),
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
    : h('button', { class: `ctx-item${it.danger ? ' danger' : ''}`, onclick: () => { menu.remove(); it.run(); } }, h('span', {}, it.label), it.key ? h('span', { class: 'ctx-key' }, it.key) : null))));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(e.clientX, innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(e.clientY, innerHeight - r.height - 6)}px`;
  const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); } };
  setTimeout(() => document.addEventListener('mousedown', close, true), 0);
  document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { menu.remove(); document.removeEventListener('keydown', esc, true); } }, true);
}

function fileMenu(e, f) {
  contextMenu(e, [
    { label: 'Open', run: () => openFile(f.path) },
    f.note ? { label: 'Open to the side', key: `${MOD}click`, run: () => openFile(f.path, { side: true }) } : null,
    f.note ? { label: 'Copy [[link]]', run: () => navigator.clipboard.writeText(`[[${stem(f.path)}]]`).then(() => toast('Link copied')) } : null,
    { label: 'Copy path', run: () => navigator.clipboard.writeText(f.path).then(() => toast('Path copied')) },
    revealItem(f.path),
    { label: isBookmarked(f.path) ? 'Remove bookmark' : 'Bookmark', run: () => toggleBookmark(f.path) },
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
  for (const t of S.tabs) if (t.kind === 'file' && (t.path === p || t.path.startsWith(`${p}/`))) await flushAutosave(t);
  for (const t of S.tabs) if (t.kind === 'drawing' && (t.path === p || t.path.startsWith(`${p}/`))) await saveDrawing(t, { flush: true });
  try {
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
    await loadTree();
    navRenamed(r.moved);
    if (isDir) for (const d of [...S.expanded]) if (d === r.from || d.startsWith(`${r.from}/`)) { S.expanded.delete(d); S.expanded.add(r.to + d.slice(r.from.length)); }
    persist();
    await syncOpenTabs();
    render();
    toast(`Renamed to ${r.to}${r.updated.length ? ` · updated links in ${r.updated.length} note${r.updated.length === 1 ? '' : 's'}` : ''}`);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteItem(p, isDir = false) {
  const tab = S.tabs.find((t) => t.kind === 'file' && t.path === p);
  if (tab && tab.content !== tab.saved && !(await askConfirm(`${p} has unsaved changes. Delete anyway?`, { okLabel: 'Delete', danger: true }))) return;
  try {
    const r = await api('POST', '/api/delete', { path: p });
    // Bookmarks go with it, and come back with Undo.
    const marks = S.bookmarks.filter((b) => b === p || b.startsWith(`${p}/`));
    if (marks.length) { S.bookmarks = S.bookmarks.filter((b) => !marks.includes(b)); saveBookmarks(); }
    for (const t of [...S.tabs]) if (isDoc(t) && (t.path === p || t.path.startsWith(`${p}/`))) { t.saved = t.kind === 'drawing' ? t.text : t.content; t.discard = true; await closeTab(t.id); }
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
  return rel && isDrawing(rel) ? drawingEmbed(rel, label, target) : null;
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

const RECIPES = [
  ['Tidy', 'Tidy the formatting: consistent headings, lists and spacing. Do not change the meaning.'],
  ['Summarize', 'Add a short TL;DR at the top of the note summarizing it in 2–3 sentences.'],
  ['Extract tasks', 'Collect every open task (- [ ]) into an "Open tasks" section with a link back to its source note.'],
  ['Link notes', 'Add [[wikilinks]] between notes where one clearly refers to another. Do not invent notes.'],
  ['Proofread', 'Fix spelling and grammar only. Keep the author’s voice and language.'],
  ['Draw as flow', 'Where the text describes a process, workflow or system, add a ```flow block right after it that draws it. Keep the text unchanged and use its names.'],
];

async function openTaskDialog(presetTask = '') {
  if (!S.info?.agent?.configured) { showView('agent'); toast('No agent configured — see the Agent panel.', 'error'); return; }
  const focus = fileTab() && isNote(fileTab().path) ? fileTab().path : null;
  const tab = fileTab();
  if (tab && (tab.content !== tab.saved || tab.saving)) {
    // The agent works on files on disk, so unsaved edits must be written first.
    if (!S.settings.autosave && !(await askConfirm('Save your unsaved changes first? The agent works on the saved files.', { okLabel: 'Save' }))) return;
    if (tab.saving) await tab.saving;
    if (tab.content !== tab.saved) await saveTab(tab);
    if (tab.content !== tab.saved) { toast('Could not save the note; resolve the conflict first.', 'error'); return; }
  }
  const overlay = $('#overlay');
  let scope = focus ? 'file' : 'workspace';
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

  async function refreshScope() {
    filesBox.replaceChildren('…');
    try {
      const r = await api('GET', `/api/scope?scope=${scope}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`);
      filesBox.replaceChildren(
        ...r.included.map((p) => h('div', {}, p)),
        ...r.excluded.map((x) => h('div', { class: 'ex', title: `withheld: ${x.reason}` }, `${x.path}  (private)`)));
      shareLine.textContent = `${r.included.length} note${r.included.length === 1 ? '' : 's'} will be shared${r.excluded.length ? `, ${r.excluded.length} withheld as private` : ''}.`;
      runBtn.disabled = !r.included.length;
    } catch (e) { filesBox.replaceChildren(e.message); runBtn.disabled = true; }
  }

  async function submit() {
    if (!task.value.trim()) { task.focus(); return; }
    runBtn.disabled = true;
    try {
      store.setItem('an.lastAgent', agentId);
      const run = await api('POST', '/api/runs', { task: task.value, scope, focus, selection: useSel.checked ? selection : '', agentId, model });
      close();
      await loadRuns();
      openReview(run.id);
    } catch (e) { toast(e.message, 'error'); runBtn.disabled = false; }
  }

  const scopeOpt = (value, label, disabled) => h('label', {},
    h('input', { type: 'radio', name: 'scope', value, checked: scope === value, disabled, onchange: () => { scope = value; refreshScope(); } }), label);

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
      h('div', { class: 'recipes' }, RECIPES.map(([name, text]) => h('button', { class: 'chip', onclick: () => { task.value = text; task.focus(); } }, name))),
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
  try { S.runs = (await api('GET', '/api/runs')).runs; } catch { S.runs = []; }
  if (S.view === 'agent') renderSidebar(); else renderActivity();
}

function openReview(id) {
  let tab = S.tabs.find((t) => t.kind === 'review' && t.runId === id);
  if (!tab) {
    const r = S.runs.find((x) => x.id === id);
    tab = { id: `r:${id}`, kind: 'review', runId: id, title: (r?.task || id).slice(0, 28), run: null, decisions: {}, group: S.focus };
    S.tabs.push(tab);
  }
  activate(tab.id);
  refreshReview(tab);
}

async function refreshReview(tab) {
  const prevStatus = tab.run?.status;
  try { tab.run = await api('GET', `/api/runs/${tab.runId}`); }
  catch (e) { toast(e.message, 'error'); return; }
  const run = tab.run;
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
    tab.decisions[c.path] = isBlocked(c)
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
  const locked = lockedAll || conflict;
  const on = dec.hunks.has(i);
  const rows = [];
  let ln = hunk.baseStart - hunk.before.length + 1;
  for (const l of hunk.before) rows.push(diffLine('ctx', ln++, ' ', l));
  const paired = hunk.removed.length === hunk.added.length && hunk.removed.length <= 20;
  hunk.removed.forEach((l, k) => {
    const wd = paired ? wordDiff(l, hunk.added[k]) : null;
    rows.push(diffLine('del', ln++, '−', wd ? wd[0] : l));
  });
  hunk.added.forEach((l, k) => {
    const wd = paired ? wordDiff(hunk.removed[k], l) : null;
    rows.push(diffLine('add', '', '+', wd ? wd[1] : l));
  });
  for (const l of hunk.after) rows.push(diffLine('ctx', ln++, ' ', l));
  const toggle = () => {
    if (locked) return;
    on ? dec.hunks.delete(i) : dec.hunks.add(i);
    renderContent(tab.group);
  };
  const what = [hunk.removed.length && `−${hunk.removed.length}`, hunk.added.length && `+${hunk.added.length}`].filter(Boolean).join(' ');
  return h('div', { class: `hunk${on ? '' : ' off'}` },
    h('div', { class: 'hunk-head', onclick: toggle },
      h('input', { type: 'checkbox', checked: on, disabled: locked, onclick: (e) => e.stopPropagation(), onchange: toggle }),
      h('span', {}, `Change ${i + 1} of ${c.hunks.length} · line ${hunk.baseStart + 1} · ${what}`),
      conflict ? h('span', { class: 'st-failed' }, '· overlaps your edit — cannot apply') : null),
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
  const canPreview = isNote(c.path) && !c.binary && (c.base != null || c.status === 'added');
  const view = canPreview ? tab.views[c.path] || 'diff' : 'diff';
  const head = h('div', { class: 'file-card-head' },
    h('input', { type: 'checkbox', checked: selectedAll, indeterminate: !!c.hunks && dec.hunks.size > 0 && !selectedAll, disabled: lock, onchange: toggleFile }),
    h('span', { class: `badge st-${c.status}` }, c.status),
    h('span', { class: 'path' }, c.path),
    c.hunks ? h('span', { class: 'meta' }, `${dec.hunks.size}/${c.hunks.length} changes`) : null,
    canPreview ? h('div', { class: 'seg' }, ['diff', 'result'].map((v) => h('button', { class: view === v ? 'on' : '',
      onclick: () => { tab.views[c.path] = v; renderContent(tab.group); } }, v === 'diff' ? 'Diff' : 'Result'))) : null,
    c.status !== 'added' ? h('button', { class: 'btn small', onclick: () => openFile(c.path) }, 'Open') : null);
  const body = [];
  if (blocked) {
    body.push(h('div', { class: 'review-note warn' }, c.reserved ? 'The agent wrote to a reserved path; this change cannot be applied.'
      : c.status === 'added' ? 'A file with this name now exists in your workspace, so it will not be overwritten.'
        : 'This file changed in your workspace after the agent started and every proposed change overlaps your edits. Nothing here can be applied safely.'));
  } else if (c.stale && !locked) {
    body.push(h('div', { class: 'review-note warn' },
      `You edited this file while the agent worked. ${c.hunks.length - conflicts.size} of ${c.hunks.length} changes merge cleanly with your edits and can be applied; overlapping ones are locked.`));
  }
  if (view === 'result') {
    // Render the note as it would read with exactly the selected changes.
    const text = c.status === 'added' ? c.lines.join('\n') : applySelected(c.base, c.hunks, dec.hunks);
    const result = h('div', { class: 'preview md result-preview', html: renderMarkdown(text) });
    renderDiagrams(result);
    body.push(result);
  } else if (c.binary) body.push(h('div', { class: 'review-note' }, 'Binary file — shown as a whole-file change.'));
  else if (c.hunks) body.push(...c.hunks.map((hk, i) => hunkView(c, hk, i, dec, lock, tab)));
  else {
    const sign = c.status === 'added' ? '+' : '−';
    const cls = c.status === 'added' ? 'add' : 'del';
    body.push(h('div', { class: 'diff' }, c.lines.map((l, i) => diffLine(cls, i + 1, sign, l))));
  }
  return h('div', { class: `file-card${blocked ? ' stale' : ''}` }, head, body);
}

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

function reviewView(tab) {
  const run = tab.run;
  const wrap = h('div', { class: 'review' });
  if (!run) { wrap.append(h('div', { class: 'empty' }, 'Loading…')); return wrap; }
  const reviewable = ['review', 'failed', 'cancelled'].includes(run.status);
  const took = run.finishedAt ? `${Math.max(1, Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000))}s` : null;

  wrap.append(h('div', { class: 'review-head' },
    h('span', { class: `badge st-${run.status}` }, run.status),
    h('div', { class: 'task' }, run.task),
    h('div', { class: 'meta' },
      h('span', {}, `agent: ${run.agent}`),
      run.liveModel || run.resolvedModel || run.model ? h('span', {}, `model: ${run.liveModel || run.resolvedModel || run.model}`) : null,
      run.usage ? h('span', { title: usageTitle(run.usage) }, usageText(run.usage)) : null,
      h('span', {}, `scope: ${run.scope}${run.focus ? ` (${run.focus})` : ''}`),
      run.selection ? h('span', {}, `selection: ${run.selection} chars`) : null,
      h('span', { title: run.files.join('\n') }, `shared ${run.files.length} note${run.files.length === 1 ? '' : 's'}`),
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
  wrap.append(log);

  if (run.status !== 'running') {
    if (!run.changes.length) wrap.append(h('div', { class: 'review-note' }, 'The agent made no changes.'));
    if (reviewable && run.changes.length) {
      const n = selectedCount(tab);
      wrap.append(h('div', { class: 'review-actions' },
        h('span', { class: 'grow' }, `${run.changes.length} file${run.changes.length === 1 ? '' : 's'} changed · ${n} change${n === 1 ? '' : 's'} selected`),
        S.git?.repo ? h('label', { class: 'commit-toggle', title: 'Commit the applied files to git, authored by the agent (local only)' },
          h('input', { type: 'checkbox', checked: store.getItem('an.commitOnApply') !== 'false', onchange: (e) => store.setItem('an.commitOnApply', String(e.target.checked)) }), 'Commit to git') : null,
        h('button', { class: 'btn', onclick: () => followUp(tab) }, 'Follow up…'),
        h('button', { class: 'btn danger', onclick: () => discardRun(tab) }, 'Discard'),
        h('button', { class: 'btn primary', disabled: !n, onclick: () => applyRun(tab) }, `Apply ${n} selected`)));
    } else if (reviewable) {
      wrap.append(h('div', { class: 'review-actions' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', onclick: () => followUp(tab) }, 'Follow up…'),
        h('button', { class: 'btn danger', onclick: () => discardRun(tab) }, 'Discard')));
    }
    const locked = !reviewable;
    for (const c of run.changes) wrap.append(fileCard(c, tab, locked));
  }
  return wrap;
}

async function applyRun(tab) {
  const decisions = {};
  for (const [p, d] of Object.entries(tab.decisions)) decisions[p] = { file: d.file, hunks: [...d.hunks] };
  const dirtyOpen = S.tabs.filter((t) => t.kind === 'file' && t.content !== t.saved && decisions[t.path]);
  if (dirtyOpen.length && !(await askConfirm(`You have unsaved edits in ${dirtyOpen.map((t) => t.path).join(', ')}. Applying will create a conflict with them. Continue?`, { okLabel: 'Apply' }))) return;
  try {
    const commit = !!S.git?.repo && store.getItem('an.commitOnApply') !== 'false';
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
  if (e.key === 'Escape' && document.documentElement.classList.contains('focus-mode') && !fileTab()?.editor.find.open) { toggleFocusMode(); return; }
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
    const affected = S.tabs.filter((t) => isDoc(t) && (!paths.length || changed.has(t.path)));
    if (affected.length) await syncTabs(affected);
    for (const p of paths) if (isDrawing(p) || isMermaidFile(p) || isNote(p)) refreshEmbeds(p);
    if (paths.some((p) => /\.(md|markdown|mdx|txt)$/i.test(p))) { loadTags(); const t = fileTab(); if (t) loadBacklinks(t.path); }
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
const ACTIONS = {
  'new-note': () => newNote(),
  'quick-open': () => openPalette(),
  palette: () => openPalette('>'),
  search: () => { S.view = 'search'; $('#app').classList.remove('no-sidebar'); renderSidebar(); $('#search-input')?.focus(); $('#search-input')?.select(); },
  save: () => (drawingTab() ? saveDrawing(drawingTab(), { flush: true, force: false }) : saveTab()),
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
  buffers: pickTab,
  // From the Edit menu: the editor's own history when a note has the focus.
  undo: () => { const t = S.tabs.find((x) => x.editor?.ta === document.activeElement); if (t) t.editor.undo(); else document.execCommand('undo'); },
  redo: () => { const t = S.tabs.find((x) => x.editor?.ta === document.activeElement); if (t) t.editor.redo(); else document.execCommand('redo'); },
  'macro-record': toggleRecording,
  'macro-play': () => (macros.recording ? stopRecording() : playMacro(1)),
  'search-next': () => stepSearch(1),
  'search-prev': () => stepSearch(-1),
};

// ---------------------------------------------------------------- keyboard
// One leader key everywhere (Alt+X by default, like Emacs M-x): a menu of
// the keys that can follow, grouped by letter as in LazyVim / Doom. The
// leader again, or Space, opens every command. See leader.js.
const isFileTab = (t) => t?.kind === 'file';
const editorShown = (t) => isFileTab(t) && (!hasPreview(t.path) || groupMode(t) !== 'preview');
const previewShown = (t) => isFileTab(t) && hasPreview(t.path) && ['split', 'preview'].includes(groupMode(t));

function leaderTree() {
  const tab = fileTab();
  const doc = tab || drawingTab();
  const note = !!tab && isNote(tab.path);
  return [
    { key: 'SPC', label: 'All commands…', run: () => openPalette('>') },
    { key: '`', label: 'The note before', run: otherBuffer },
    { key: 'f', label: 'files', items: [
      { key: 'f', label: 'Find a file…', run: () => openPalette() },
      { key: 'n', label: 'New note…', run: () => newNote() },
      { key: 't', label: 'New note from template…', run: () => pickTemplate((t) => newNote(undefined, t)) },
      { key: 'j', label: 'Today’s journal', run: openDaily },
      { key: 'r', label: 'Rename / move…', when: () => !!doc, run: () => renameItem(doc.path) },
      { key: 'b', label: doc && isBookmarked(doc.path) ? 'Remove bookmark' : 'Bookmark', when: () => !!doc, run: () => toggleBookmark(doc.path) },
      { key: 'y', label: 'Copy [[link]]', when: () => note, run: () => navigator.clipboard.writeText(`[[${stem(tab.path)}]]`).then(() => toast('Link copied')) },
      { key: 'l', label: 'Show in the tree', when: () => !!doc, run: () => { showInTree(doc.path); focusSidebar(); } },
      { key: 'h', label: 'History…', when: () => !!doc, run: () => openHistory(doc.path) },
      { key: 'e', label: 'Export as HTML…', when: () => note, run: () => exportHtml(tab) },
    ] },
    { key: 's', label: 'search', items: [
      { key: 's', label: 'Search the workspace', run: () => ACTIONS.search() },
      { key: 'f', label: 'Find in note', when: () => !!tab, run: () => findInNote(tab) },
      { key: 'r', label: 'Replace in note', when: () => !!tab, run: () => findInNote(tab, { replace: true }) },
      { key: 'h', label: 'Heading in this note…', when: () => note, run: () => openPalette('#') },
      { key: 'a', label: 'Heading in any note…', run: () => openPalette('@') },
      { key: 'l', label: 'Go to line…', when: () => !!tab, run: () => openPalette(':') },
      { key: 'n', label: 'Next search result', run: () => stepSearch(1) },
      { key: 'p', label: 'Previous search result', run: () => stepSearch(-1) },
    ] },
    { key: 'b', label: 'tabs', items: [
      { key: 'b', label: 'Switch note (buffers)…', run: pickTab },
      { key: '`', label: 'The note before', run: otherBuffer },
      { key: 'm', label: 'Messages…', run: showMessages },
      { key: 'n', label: 'Next tab', run: () => cycleTab(1) },
      { key: 'p', label: 'Previous tab', run: () => cycleTab(-1) },
      { key: 'd', label: 'Close tab', when: () => !!activeTab(), run: () => closeTab(activeTab().id) },
      { key: 'o', label: 'Close other tabs', when: () => !!activeTab(), run: () => closeTabs(S.tabs.filter((x) => x.group === S.focus && x !== activeTab())) },
      { key: '[', label: 'Back', run: () => navGo(-1) },
      { key: ']', label: 'Forward', run: () => navGo(1) },
    ] },
    { key: 'w', label: 'windows', items: [
      { key: 'h', label: 'Go to the sidebar', run: focusSidebar },
      { key: 'l', label: 'Go to the editor', run: focusEditor },
      { key: 'p', label: 'Go to the preview', when: () => previewShown(tab), run: () => focusPreview(tab) },
      { key: 'w', label: 'Go to the other pane', when: () => S.groups.length > 1, run: () => { splitRight(); focusEditor(); } },
      { key: 'v', label: 'Split to the side', when: () => S.groups.length < 2, run: splitRight },
      { key: 's', label: 'Show / hide the sidebar', run: toggleSidebar },
      { key: 'z', label: 'Focus mode', run: toggleFocusMode },
    ] },
    { key: 'm', label: 'mode', when: () => isFileTab(tab) && hasPreview(tab.path), items: [
      { key: 'e', label: 'Edit', run: () => setMode('edit') },
      { key: 's', label: 'Split', run: () => setMode('split') },
      { key: 'c', label: 'Canvas', when: () => note, run: () => setMode('canvas') },
      { key: 'p', label: 'Preview', run: () => setMode('preview') },
    ] },
    { key: 'l', label: 'links', items: [
      { key: 'l', label: 'Follow the link at the cursor', when: () => editorShown(tab), run: () => { if (!followLinkAt(tab.editor, tab)) toast('No link at the cursor'); } },
      { key: 'f', label: 'Pick a link in the preview…', when: () => previewShown(tab), run: () => linkHints(tab.previewEl) },
      { key: 'b', label: 'Back', run: () => navGo(-1) },
    ] },
    { key: 'g', label: 'git', items: [
      { key: 'g', label: 'Git panel', run: () => showView('git') },
      { key: 'd', label: 'Changes since last commit', when: () => !!doc && S.gitMap.has(doc.path), run: () => openGitDiff(doc.path) },
      { key: 'h', label: 'History of this file…', when: () => !!doc, run: () => openHistory(doc.path) },
    ] },
    { key: 'a', label: 'agent', items: [
      { key: 'a', label: 'Delegate a task…', run: () => openTaskDialog() },
      { key: 'r', label: 'Agent runs', run: () => showView('agent') },
    ] },
    { key: 't', label: 'toggles', items: [
      { key: 'f', label: `Tree follows the tab: ${S.settings.followTab ? 'on' : 'off'}`, run: toggleFollowTab },
      { key: 's', label: 'Sidebar', run: toggleSidebar },
      { key: 't', label: 'Theme…', run: pickTheme },
      { key: 'z', label: 'Focus mode', run: toggleFocusMode },
    ] },
    { key: 'q', label: 'macro', items: [
      { key: 'q', label: macros.recording ? 'Stop recording' : 'Start recording', run: toggleRecording },
      { key: 'r', label: 'Play', when: () => !!macros.last, run: () => playMacro(1) },
      { key: 'n', label: 'Play N times…', when: () => !!macros.last, run: playMacroTimes },
      { key: 'e', label: 'Play until it can’t go on', when: () => !!macros.last, run: () => playMacro(Infinity) },
      { key: 's', label: 'Play at every search result', when: () => !!macros.last && !!S.searchQuery.trim(), run: playAtResults },
      { key: 'v', label: 'Show the macro', when: () => !!macros.last, run: () => toast(describeMacro(macros.last)) },
    ] },
    { key: '.', label: lastRun ? `Repeat: ${lastRun.label}` : 'Repeat the last command', run: repeatLast },
    { key: ',', label: 'Settings', run: () => openSettings() },
    { key: 'k', label: 'Keyboard shortcuts…', run: () => openSettings({ keys: true }) },
  ];
}

function openLeaderMenu() {
  if ($('.leader')) return;
  openLeader(leaderTree(), {
    title: kbd('leader') || 'Commands',
    // Again with ⌥X .: the same keys, looked up again (for the tab you're on then).
    onRun: (keys, it) => {
      if (['.', 'SPC', 'q'].includes(keys[0])) return;
      const run = () => runLeaderKeys(keys);
      remember(it.label, run);
      macros.note(it.label, run);
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

function runLeaderKeys(keys) {
  let items = leaderTree();
  let it = null;
  for (const k of keys) { it = items.find((x) => x.key === k && (!x.when || x.when())); if (!it) break; items = it.items || []; }
  if (it?.run) it.run(); else toast('That command isn’t available here');
}

// The buffer list (Emacs C-x b): open notes and those closed but kept, the
// most recent first — the one before this is at the top.
function pickTab() {
  const cur = activeTab();
  const list = buffers().filter((b) => b.tab !== cur).concat(cur ? [{ tab: cur, closed: false }] : []);
  picker({
    placeholder: 'Switch to a note…  (closed ones keep their place)',
    source: (q) => list.map((b) => ({ b, name: b.tab.path ? basename(b.tab.path) : b.tab.title || b.tab.kind })).map((x) => ({ ...x, m: fuzzy(q, x.name) })).filter((x) => x.m)
      .sort((a, b) => (q ? b.m.score - a.m.score : 0))
      .map(({ b, name, m }) => ({
        icon: b.closed ? '○' : b.tab.group === 1 ? '◫' : '●',
        label: marked(name, m.idx),
        hint: [b.tab.path ? dirname(b.tab.path) : '', b.closed ? 'closed' : b.tab === cur ? 'here' : ''].filter(Boolean).join(' · '),
        run: () => showBuffer(b),
      })),
  });
}

function showMessages() {
  const time = (d) => d.toTimeString().slice(0, 8);
  picker({
    placeholder: `Messages (${messages.length}) — Enter copies one`,
    source: (q) => messages.slice().reverse().map((x) => ({ x, m: fuzzy(q, x.msg) })).filter((y) => y.m)
      .map(({ x, m }) => ({ icon: x.kind === 'error' ? '!' : '', label: marked(x.msg, m.idx), hint: time(x.at), run: () => navigator.clipboard.writeText(x.msg) })),
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

// Repeat the last command (Emacs C-x z, Vim's .): from the leader menu, the
// palette or a shortcut. Opening a menu or a picker isn't one.
const NOT_REPEATED = new Set(['undo', 'redo', 'leader', 'palette', 'quick-open', 'repeat', 'save', 'settings', 'macro-record', 'macro-play']);
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
  await Promise.all([loadTree(), loadRuns(), loadTags(), loadGit()]);
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
