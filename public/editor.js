// Lightweight Markdown editor: a native <textarea> (fast, IME/accessibility
// friendly, native undo) layered over two mirrors that render exactly the
// same text — one with syntax colors, one with find-match backgrounds.
// Styling rule: highlight only with color/background/underline so glyph
// widths never change and the layers stay aligned in proportional fonts too.

import { eventKeys } from './keys.js';
import { UndoHistory } from './undo.js';
import { expandRange } from './expand.js';
import { combine, original, proposed, reconcile, provisional, strike, overlay } from './track.js';
import { EmacsKeys, emacs, keyName } from './emacs.js';

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const MAX_HIGHLIGHT = 300_000; // chars; beyond this we fall back to plain text

// ------------------------------------------------------------------ highlighting

function inlineHL(src) {
  const tags = [];
  const stash = (html) => `\u0001${tags.push(html) - 1}\u0001`;
  const span = (cls, raw) => `<span class="${cls}">${esc(raw)}</span>`;
  let s = src;
  s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (m) => stash(span('md-code', m)));
  s = s.replace(/(!?\[\[)([^\]\n]+)(\]\])/g, (_, a, b, c) => stash(span('md-mark', a) + span('md-wikilink', b) + span('md-mark', c)));
  s = s.replace(/(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))/g, (_, a, b, c, d, e) =>
    stash(span('md-mark', a) + `<span class="md-link">${esc(b)}</span>` + span('md-mark', c) + span('md-url', d) + span('md-mark', e)));
  s = s.replace(/<(https?:\/\/[^>\s]+)>|https?:\/\/[^\s<>()\u0001]+[^\s<>().,;:!?\u0001]/g, (m) => stash(span('md-url md-bare', m)));
  s = s.replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, (_, m, t) => stash(`${span('md-mark', m)}<span class="md-strong">${esc(t)}</span>${span('md-mark', m)}`));
  s = s.replace(/(^|[^*\w])(\*|_)(?=[^\s*_])([^\n*_]*?[^\s*_]|[^\s*_])\2(?![*\w])/g, (_, pre, m, t) =>
    `${pre}${stash(`${span('md-mark', m)}<span class="md-em">${esc(t)}</span>${span('md-mark', m)}`)}`);
  s = s.replace(/(~~)(?=\S)([^\n]*?\S)~~/g, (_, m, t) => stash(`${span('md-mark', m)}<span class="md-del">${esc(t)}</span>${span('md-mark', m)}`));
  s = s.replace(/(==)(?=\S)([^\n]*?\S)==/g, (_, m, t) => stash(`${span('md-mark', m)}<span class="md-hl">${esc(t)}</span>${span('md-mark', m)}`));
  s = s.replace(/(^|[\s(])(#[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu, (_, pre, tag) => `${pre}${stash(span('md-tag', tag))}`);
  s = esc(s);
  for (let i = 0; i < 4 && s.includes('\u0001'); i++) s = s.replace(/\u0001(\d+)\u0001/g, (_, n) => tags[n]);
  return s;
}

const lineCache = new Map();
function cachedInline(line) {
  let v = lineCache.get(line);
  if (v === undefined) {
    if (lineCache.size > 8000) lineCache.clear();
    v = inlineHL(line);
    lineCache.set(line, v);
  }
  return v;
}

export function highlightMarkdown(text) {
  const lines = text.split('\n');
  const out = new Array(lines.length);
  let fence = null;
  let front = lines[0] === '---' || lines[0] === '\uFEFF---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (front) {
      out[i] = `<span class="md-fm">${esc(line)}</span>`;
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false;
      continue;
    }
    if (fence) {
      if (line.trim().startsWith(fence)) { fence = null; out[i] = `<span class="md-mark">${esc(line)}</span>`; }
      else out[i] = `<span class="md-codeblock">${esc(line)}</span>`;
      continue;
    }
    if ((m = line.match(/^(\s{0,3})(```+|~~~+)(.*)$/))) {
      fence = m[2];
      out[i] = `${esc(m[1])}<span class="md-mark">${esc(m[2])}</span><span class="md-lang">${esc(m[3])}</span>`;
      continue;
    }
    if ((m = line.match(/^(#{1,6})(\s+)(.*)$/))) {
      out[i] = `<span class="md-mark">${m[1]}</span>${m[2]}<span class="md-h md-h${m[1].length}">${cachedInline(m[3])}</span>`;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out[i] = `<span class="md-mark">${esc(line)}</span>`; continue; }
    if ((m = line.match(/^(\s{0,3}(?:>\s?)+)(.*)$/))) {
      out[i] = `<span class="md-mark">${esc(m[1])}</span><span class="md-quote">${cachedInline(m[2])}</span>`;
      continue;
    }
    if ((m = line.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\](?=\s|$))?(.*)$/))) {
      const done = m[4] && m[4] !== '[ ]';
      const box = m[4] ? `<span class="md-task${done ? ' md-task-done' : ''}">${esc(m[4])}</span>` : '';
      const rest = done ? `<span class="md-done">${esc(m[5])}</span>` : cachedInline(m[5]);
      out[i] = `${m[1]}<span class="md-list">${esc(m[2])}</span>${m[3]}${box}${rest}`;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      out[i] = line.split('|').map((c) => cachedInline(c)).join('<span class="md-mark">|</span>');
      continue;
    }
    out[i] = cachedInline(line);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ editor

const isMac = navigator.platform.includes('Mac');
const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);
const PAIRS = { '(': ')', '[': ']', '{': '}', '`': '`', '"': '"' };

// The editor's shortcuts, which can be changed (public/keys.js): keys → command.
let commandKeys = new Map();
export function setEditorKeys(keys) {
  commandKeys = new Map(Object.entries(keys).filter(([, k]) => k).map(([id, k]) => [k, id]));
}
const commandOf = (e) => commandKeys.get(eventKeys(e, isMac));

// Watching editors from outside (keyboard macros, macro.js): the keys an
// editor acted on itself, its edits made outside a key (replacing from the
// find bar), and where a find ended.
export const editorWatch = { key: null, edit: null, find: null, replaceAll: null };

// What a find looks for, as a RegExp (null: nothing, or a broken pattern).
// ^ and $ are a line's start and end, as in other editors.
export function findPattern({ query, caseSensitive, regex }) {
  if (!query) return null;
  try {
    return new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gmu' : 'gimu');
  } catch { return null; }
}

// The place in a tracked text (marks, track.js) where `count` characters of
// the text without `skip` ones have gone by: the first such place, or the last.
function placeIn(marks, count, skip, last = false) {
  let n = 0;
  let i = 0;
  for (; i < marks.length && n < count; i++) if (marks[i] !== skip) n++;
  if (last) while (i < marks.length && marks[i] === skip) i++;
  return i;
}

export class MarkdownEditor {
  constructor({ onChange, onScroll, onCursor, complete, onPasteFiles, onTrack, onNarrow } = {}) {
    this.onChange = onChange || (() => {});
    this.onTrack = onTrack || (() => {});
    this.onNarrow = onNarrow || (() => {});
    this.onScroll = onScroll || (() => {});
    this.onCursor = onCursor || (() => {});
    this.complete = complete || (() => []);
    this.onPasteFiles = onPasteFiles || null;
    this.highlightOn = true;
    this.find = { open: false, query: '', replace: '', caseSensitive: false, regex: false, matches: [], index: -1 };
    this.extra = []; // additional selections for multi-cursor editing: [start, end]
    this.hints = []; // ranges shown faintly for a moment (e.g. mentions of a box): [start, end]
    this.history = new UndoHistory('');
    this.track = null; // suggesting: { text, marks, undo, redo } (track.js)
    this.notes = []; // margin notes: { from, to, el, cur }
    this.nar = null; // narrowed: { head, tail, lines } (the note's text before and after the part in view)
    this.emacs = new EmacsKeys(this); // Emacs keys (emacs.js)
    this.query = null; // query replace, going: { at, end, cur, n, back }

    this.findLayer = h('div', 'ed-layer ed-find-layer');
    this.hlLayer = h('div', 'ed-layer ed-hl-layer');
    this.ta = document.createElement('textarea');
    this.ta.className = 'ed-input';
    this.ta.spellcheck = false;
    this.ta.setAttribute('autocapitalize', 'off');
    this.ta.setAttribute('autocomplete', 'off');
    this.popup = h('div', 'ed-popup');
    this.popup.hidden = true;
    this.findBar = this._buildFindBar();
    this.el = h('div', 'ed');
    this.curLine = h('div', 'ed-curline');
    this.curLine.hidden = true;
    this.notesCol = h('div', 'ed-notes');
    this.el.append(this.curLine, this.findLayer, this.hlLayer, this.ta, this.notesCol, this.popup, this.findBar);

    this.ta.addEventListener('input', (e) => this._changed(e));
    this.ta.addEventListener('beforeinput', (e) => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); if (e.inputType === 'historyUndo') this.undo(); else this.redo(); return; }
      if (!this.busy) this._selBefore = [this.ta.selectionStart, this.ta.selectionEnd];
    });
    this.ta.addEventListener('beforeinput', (e) => this._multiInput(e));
    this.ta.addEventListener('mousedown', () => { this._clearMulti(); this._closeStep(); this.emacs.mouse(); if (this.query) this._queryDone(); });
    this.ta.addEventListener('compositionstart', () => { this._clearMulti(); this._selBefore = [this.ta.selectionStart, this.ta.selectionEnd]; });
    this.ta.addEventListener('scroll', () => this._syncScroll());
    this.ta.addEventListener('keydown', (e) => {
      this.handlingKey = true;
      try { this._keydown(e); } finally { this.handlingKey = false; }
      // Not the key that started recording a macro (⌃X ( ).
      if (!this._noWatch) editorWatch.key?.(this, e, commandOf(e));
      this._noWatch = false;
    });
    this.ta.addEventListener('keyup', () => { this._placeCurLine(); this.onCursor(); });
    this.ta.addEventListener('click', () => { this._closePopup(); this._placeCurLine(); this.onCursor(); });
    this.ta.addEventListener('selectionchange', () => this._placeCurLine());
    this.ta.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === this.ta) return;
      this._closePopup();
      if (this.query) this._queryDone();
    }, 150));
    this.ta.addEventListener('paste', (e) => this._paste(e));
    this.ta.addEventListener('drop', (e) => this._drop(e));
    this.ta.addEventListener('compositionend', () => this._changed());
    new ResizeObserver(() => { this._lineOffsetCache = null; this._syncScroll(); this._placeNotes(); this._placeCurLine(); }).observe(this.ta);
  }

  // ---------------- public API
  // Places in the API are in the whole note, also while it is narrowed (see
  // narrow()); the text box itself holds only the part in view.
  get value() { return this.nar ? this.nar.head + this.ta.value + this.nar.tail : this.ta.value; }
  set value(v) { this.nar = null; this.ta.value = v; this.extra = []; this.hints = []; this.history.reset(v); this._render(); this.onNarrow(); }

  // New text from outside (the file changed on disk: another program, an
  // agent): shown, and one ⌘Z takes it back. Narrowed, it stays so while
  // the rest of the note is as it was.
  loadText(v) {
    if (v === this.value || this.track) return;
    const sel = [this.selectionStart, this.selectionEnd];
    this.history.close();
    const n = this.nar;
    if (n && v.length >= n.head.length + n.tail.length && v.startsWith(n.head) && v.endsWith(n.tail)) this.ta.value = v.slice(n.head.length, v.length - n.tail.length);
    else { this.nar = null; this.ta.value = v; this.onNarrow(); }
    this.extra = [];
    this.hints = [];
    this.history.record(v, [0, 0], sel);
    this.history.close();
    this._render();
  }

  undo() { if (this.track) this._trackStep(-1); else this._applyHistory(this.history.undo()); }
  redo() { if (this.track) this._trackStep(1); else this._applyHistory(this.history.redo()); }
  _closeStep() { this.history.close(); if (this.track) this.track.open = false; }
  // The next change is an undo step of its own (a change made from outside).
  closeStep() { this._closeStep(); }
  _applyHistory(c) {
    if (!c) return;
    this._clearMulti();
    // A step outside the part in view shows the whole note again.
    this._reach(c.at, c.at + c.remove);
    const o = this._off;
    this.ta.setRangeText(c.insert, c.at - o, c.at - o + c.remove);
    this.ta.setSelectionRange(this._view(c.sel[0]), this._view(c.sel[1]));
    this._changed();
    const y = this._caretCoords(this.ta.selectionStart).top - this.ta.scrollTop;
    if (y < 0 || y > this.ta.clientHeight - this.lineHeight()) this._scrollTo(this.ta.selectionStart);
  }
  focus() { this.ta.focus({ preventScroll: true }); }
  get selectionStart() { return this.ta.selectionStart + this._off; }
  get selectionEnd() { return this.ta.selectionEnd + this._off; }
  // Narrowed, the caret stays in the part in view.
  setSelection(a, b = a) { this.ta.setSelectionRange(this._view(a), this._view(b)); }
  get scrollTop() { return this.ta.scrollTop; }
  set scrollTop(v) { this.ta.scrollTop = v; this._syncScroll(); }
  get scrollHeight() { return this.ta.scrollHeight; }
  get clientHeight() { return this.ta.clientHeight; }

  setOptions({ highlight, spellcheck } = {}) {
    if (highlight !== undefined) this.highlightOn = highlight;
    if (spellcheck !== undefined) this.ta.spellcheck = spellcheck;
    this._render();
  }

  lineHeight() { return parseFloat(getComputedStyle(this.ta).lineHeight) || 22; }

  cursorLine() { return this._headLines() + this.ta.value.slice(0, this.ta.selectionStart).split('\n').length; }

  // Top visible source line (1-based), measured through the mirror layout.
  topLine() {
    // Exact per-line measurement is O(lines) layout work; for very long
    // documents a proportional estimate is plenty for scroll sync.
    if (this.ta.value.length > 150_000) {
      const total = this.ta.value.split('\n').length;
      return this._headLines() + Math.max(1, Math.round((this.ta.scrollTop / Math.max(1, this.ta.scrollHeight - this.ta.clientHeight)) * (total - 1)) + 1);
    }
    const spans = this._lineOffsets();
    const y = this.ta.scrollTop;
    let lo = 0; let hi = spans.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (spans[mid] <= y) lo = mid; else hi = mid - 1; }
    return this._headLines() + lo + 1;
  }

  gotoLine(line, { select = true } = {}) {
    const lines = this.value.split('\n');
    const idx = Math.max(0, Math.min(lines.length, line) - 1);
    const start = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
    this._reach(start, start + lines[idx].length);
    const o = this._off;
    this.focus();
    this.ta.setSelectionRange(start - o, select ? start - o + lines[idx].length : start - o);
    this._scrollTo(start - o);
  }

  // Select start…end (or put the cursor there), scrolled into view if needed.
  selectRange(start, end = start, focus = true) {
    this._reach(start, end);
    this._select(start - this._off, end - this._off, focus);
  }

  _select(start, end = start, focus = true) {
    if (focus) this.focus();
    this.ta.setSelectionRange(start, end);
    const y = this._caretCoords(start).top - this.ta.scrollTop;
    if (y < 0 || y > this.ta.clientHeight - this.lineHeight()) this._scrollTo(start);
  }

  scrollToOffset(offset, ratio = 1 / 3) { this._scrollTo(this._view(offset), ratio); }

  _scrollTo(offset, ratio = 1 / 3) {
    const y = this._caretCoords(offset).top;
    this.ta.scrollTop = Math.max(0, y - this.ta.clientHeight * ratio);
    this._syncScroll();
  }

  scrollToLine(line) {
    line = Math.max(1, line - this._headLines());
    if (this.ta.value.length > 150_000) { this._scrollTo(this.ta.value.split('\n').slice(0, line - 1).join('\n').length, 0); return; }
    const spans = this._lineOffsets();
    this.ta.scrollTop = spans[Math.max(0, Math.min(spans.length - 1, line - 1))] || 0;
    this._syncScroll();
  }

  // Replace a range (one step in the undo history, undo.js). Outside the
  // part in view, the whole note is shown again first.
  replace(start, end, text, selStart = start + text.length, selEnd = selStart) {
    this._reach(start, end);
    const o = this._off;
    this._edit(start - o, end - o, text, selStart - o, selEnd - o);
  }

  // The same in the text box's places. execCommand keeps the browser's own
  // behaviour around typing (autocorrect, IME).
  _edit(start, end, text, selStart = start + text.length, selEnd = selStart) {
    const ta = this.ta;
    this._selBefore = [ta.selectionStart, ta.selectionEnd];
    if (!this.handlingKey && !this.quietEdit) editorWatch.edit?.(this, { start, end, text, selStart: ta.selectionStart, selEnd: ta.selectionEnd });
    this.busy = true;
    try { this._replace(start, end, text, selStart, selEnd); } finally { this.busy = false; }
  }

  _replace(start, end, text, selStart, selEnd) {
    const ta = this.ta;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start, end);
    // execCommand targets the focused element: only use it when that is us
    // (e.g. not while the editor is hidden in preview mode).
    const focused = document.activeElement === ta;
    const ok = focused && (text === '' ? (start === end || document.execCommand('delete')) : document.execCommand('insertText', false, text));
    if (!ok) { ta.setRangeText(text, start, end, 'end'); this._changed(); }
    ta.setSelectionRange(selStart, selEnd);
  }

  insert(text) { this._edit(this.ta.selectionStart, this.ta.selectionEnd, text); }

  // ---------------- narrowing (Emacs's narrow-to-region): only a part of
  // the note in the text box — a section, the selected lines. The rest is
  // kept aside as it is; editing, finding, undo and suggesting work in the
  // part, the note is saved whole. Places outside it (a search result, an
  // undo step there) show the whole note again.
  get narrowed() {
    if (!this.nar) return null;
    const from = this._headLines() + 1;
    return { from, to: from + this.ta.value.split('\n').length - 1 };
  }
  get _off() { return this.nar ? this.nar.head.length : 0; }
  _headLines() { return this.nar ? this.nar.lines : 0; }
  // A place in the note → in the text box, kept inside the part in view.
  _view(x) { return Math.max(0, Math.min(this.ta.value.length, x - this._off)); }
  _reach(a, b = a) {
    if (this.nar && (a < this._off || b > this._off + this.ta.value.length)) this.widen();
  }

  // Show only a..b of the note (places in the whole note).
  narrow(a, b) {
    const full = this.value;
    a = Math.max(0, Math.min(full.length, a));
    b = Math.max(a, Math.min(full.length, b));
    if (a === 0 && b === full.length) { this.widen(); return false; }
    const sel = [this.selectionStart, this.selectionEnd];
    const head = full.slice(0, a);
    this.nar = { head, tail: full.slice(b), lines: (head.match(/\n/g) || []).length };
    this._showPart(full.slice(a, b), sel);
    this.ta.scrollTop = 0;
    this._syncScroll();
    return true;
  }

  widen() {
    if (!this.nar) return false;
    const full = this.value;
    const sel = [this.selectionStart, this.selectionEnd];
    this.nar = null;
    this._showPart(full, sel);
    this._scrollTo(this.ta.selectionStart);
    return true;
  }

  _showPart(text, sel) {
    this.ta.value = text;
    this.extra = [];
    this._expanded = null;
    this.ta.setSelectionRange(this._view(sel[0]), this._view(sel[1]));
    this._render();
    if (this.find.open) this._runFind(false);
    this._placeNotes();
    this.onNarrow();
  }

  // query: what to find (else the selection, else the last one).
  openFind({ replace = false, query = null } = {}) {
    const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
    if (query) this.find.query = query;
    else if (sel && !sel.includes('\n')) this.find.query = sel;
    if (!this.find.open) this.findFrom = this.ta.selectionEnd;
    this.find.open = true;
    this.findBar.hidden = false;
    this.findBar.classList.toggle('with-replace', replace || this.findBar.classList.contains('with-replace'));
    this.findInput.value = this.find.query;
    this.findInput.focus();
    this.findInput.select();
    this._runFind(true);
  }

  closeFind() {
    if (this.find.open && editorWatch.find) {
      const { query, caseSensitive, regex, matches } = this.find;
      editorWatch.find(this, { query, caseSensitive, regex, matches, from: this.findFrom ?? 0, sel: [this.ta.selectionStart, this.ta.selectionEnd], collapse: this._findEnd || null });
    }
    this._findEnd = null;
    this._isearch = null;
    this._qr = null;
    if (this.query) { this.query = null; this.ta.readOnly = false; }
    this.find.open = false;
    this.findBar.hidden = true;
    this.find.matches = [];
    this._renderFind();
    this.focus();
  }

  // ---------------- rendering
  _changed(e) {
    if (this.track) { this._trackChanged(e); return; }
    if (!e?.isComposing) {
      const o = this._off;
      const before = this._selBefore && [this._selBefore[0] + o, this._selBefore[1] + o];
      const old = this.history.value;
      this.history.record(this.value, before, [this.ta.selectionStart + o, this.ta.selectionEnd + o]);
      this._selBefore = null;
      this.emacs.changed(old, this.value, before ? before[0] : this.ta.selectionStart + o);
    }
    this.hints = [];
    this._render();
    if (this.find.open) this._runFind(false);
    this.onChange(this.value);
    this._maybeComplete();
  }

  _render() {
    const text = this.ta.value;
    const on = (this.highlightOn || !!this.track) && text.length <= MAX_HIGHLIGHT;
    this.el.classList.toggle('plain', !on);
    if (on) {
      let html = this.highlightOn ? highlightMarkdown(text) : esc(text);
      if (this.track) html = overlay(html, this._partMarks(this.track.pending || this.track.marks));
      this.hlLayer.innerHTML = `${html}\n `;
    } else this.hlLayer.textContent = '';
    this._lineOffsetCache = null;
    this._renderFind();
    this._syncScroll();
    this._placeCurLine();
  }

  // Mark these ranges faintly until the next edit or setHints([]).
  setHints(ranges) {
    if (!ranges.length && !this.hints.length) return;
    this.hints = ranges;
    this._renderFind();
  }

  _renderFind() {
    const { index } = this.find;
    const marks = [];
    if (this.find.open) this.find.matches.forEach(([a, b], i) => marks.push([a, b, i === index ? 'cur' : '']));
    for (const [a, b] of this.extra) marks.push([a, b, a === b ? 'mcaret' : 'msel']);
    // Hints and notes are in the note's places; narrowed, only those in view.
    const o = this._off;
    const len = this.ta.value.length;
    const part = (a, b, cls) => { if (a - o >= 0 && b - o <= len) marks.push([a - o, b - o, cls]); };
    for (const [a, b] of this.hints) part(a, b, 'hint');
    for (const n of this.notes) if (n.to > n.from) part(n.from, n.to, n.cur ? 'note cur' : 'note');
    if (!marks.length) { this.findLayer.textContent = ''; return; }
    marks.sort((x, y) => x[0] - y[0]);
    const text = this.ta.value;
    let html = '';
    let pos = 0;
    for (const [a, b, cls] of marks) {
      if (a < pos) continue;
      html += `${esc(text.slice(pos, a))}<mark${cls ? ` class="${cls}"` : ''}>${esc(text.slice(a, b))}</mark>`;
      pos = b;
    }
    this.findLayer.innerHTML = `${html}${esc(text.slice(pos))}\n `;
  }

  _syncScroll() {
    this.hlLayer.scrollTop = this.ta.scrollTop;
    this.findLayer.scrollTop = this.ta.scrollTop;
    this.notesCol.style.transform = `translateY(${-this.ta.scrollTop}px)`;
    if (!this.curLine.hidden) this.curLine.style.transform = `translateY(${-this.ta.scrollTop}px)`;
    this.onScroll();
  }

  // ---------------- suggesting (track.js)
  // The tracked text and its marks are the whole note's, narrowed or not.
  get tracking() { return !!this.track; }

  // Show base with work's changes marked, and go on suggesting from there.
  // Narrowed, the same part stays in view.
  startTrack(base, work) {
    const n = this.nar;
    const c = combine(base, work);
    this.track = { text: c.text, marks: c.marks, undo: [], redo: [], open: false, last: 0, pending: null };
    this.nar = null;
    this.extra = [];
    this.hints = [];
    this.ta.value = c.text;
    this.history.reset(c.text);
    this.el.classList.add('tracking');
    this._render();
    const fits = n && base.length >= n.head.length + n.tail.length && base.startsWith(n.head) && base.endsWith(n.tail);
    if (fits) this.narrow(placeIn(c.marks, n.head.length, 'i'), placeIn(c.marks, base.length - n.tail.length, 'i', true));
    else if (n) this.onNarrow();
  }

  // Back to plain editing, with this text (the note as it was, or as the
  // suggestions made it): narrowed, the same part stays in view.
  stopTrack(text) {
    const t = this.track;
    let part = null;
    if (t && this.nar) {
      const o = this._off;
      const e = t.text.length - this.nar.tail.length;
      for (const keep of [original, proposed]) {
        const head = keep(t.text.slice(0, o), t.marks.slice(0, o));
        const tail = keep(t.text.slice(e), t.marks.slice(e));
        if (text.length >= head.length + tail.length && text.startsWith(head) && text.endsWith(tail)) { part = [head.length, text.length - tail.length]; break; }
      }
    }
    this.track = null;
    this.el.classList.remove('tracking');
    this.value = text;
    if (part) this.narrow(...part);
  }

  // The note as it is, and as the suggestions would make it.
  trackTexts() {
    const t = this.track;
    return t && { original: original(t.text, t.marks), proposed: proposed(t.text, t.marks) };
  }

  // a..b as it was and as it would be.
  trackSlice(a, b) {
    const t = this.track;
    return t && { original: original(t.text.slice(a, b), t.marks.slice(a, b)), proposed: proposed(t.text.slice(a, b), t.marks.slice(a, b)) };
  }

  // Where a place in the text is (the offset) in the note as proposed.
  proposedOffset(offset) {
    const t = this.track;
    if (!t) return offset;
    let n = 0;
    for (let i = 0; i < offset && i < t.marks.length; i++) if (t.marks[i] !== 'd') n++;
    return n;
  }

  // The marks of the part in view.
  _partMarks(marks) { return this.nar ? marks.slice(this._off, this._off + this.ta.value.length) : marks; }

  _trackChanged(e) {
    const t = this.track;
    const o = this._off;
    const next = this.value;
    if (e?.isComposing) { t.pending = provisional(t, next); this._render(); return; }
    const before = this._selBefore && [this._selBefore[0] + o, this._selBefore[1] + o];
    this._selBefore = null;
    t.pending = null;
    if (next === t.text) { this._render(); return; }
    const r = reconcile(t, next, before, this.ta.selectionStart + o);
    this._trackKeep(before);
    if (r.restored) {
      this.ta.setRangeText(r.back, r.at - o, r.at - o);
      this.ta.setSelectionRange(r.caret - o, r.caret - o);
    }
    t.text = r.text;
    t.marks = r.marks;
    this.hints = [];
    this._render();
    if (this.find.open) this._runFind(false);
    this.onTrack();
    this._maybeComplete();
  }

  // One step back: typing together is one, as in the editor's own history.
  _trackKeep(sel, force = false) {
    const t = this.track;
    const now = Date.now();
    if (force || !t.open || now - t.last > 1500) {
      t.undo.push({ text: t.text, marks: t.marks, sel: sel || [this.selectionStart, this.selectionEnd] });
      if (t.undo.length > 500) t.undo.shift();
    }
    t.open = !force;
    t.last = now;
    t.redo = [];
  }

  _trackStep(dir) {
    const t = this.track;
    const s = (dir < 0 ? t.undo : t.redo).pop();
    if (!s) return;
    (dir < 0 ? t.redo : t.undo).push({ text: t.text, marks: t.marks, sel: [this.selectionStart, this.selectionEnd] });
    t.open = false;
    this._trackSet(s.text, s.marks, s.sel);
    const y = this._caretCoords(this.ta.selectionStart).top - this.ta.scrollTop;
    if (y < 0 || y > this.ta.clientHeight - this.lineHeight()) this._scrollTo(this.ta.selectionStart);
  }

  // The tracked text is now this (the note's places): narrowed, a change
  // outside the part in view shows the whole note.
  _trackSet(text, marks, sel) {
    const t = this.track;
    const n = this.nar;
    if (n) {
      const o = this._off;
      const e = text.length - n.tail.length;
      const same = e >= o && text.slice(0, o) === n.head && text.slice(e) === n.tail
        && marks.slice(0, o) === t.marks.slice(0, o) && marks.slice(e) === t.marks.slice(t.marks.length - n.tail.length);
      if (!same) this.widen();
    }
    const o = this._off;
    const part = this.nar ? text.slice(o, text.length - this.nar.tail.length) : text;
    const old = this.ta.value;
    let p = 0;
    while (p < old.length && p < part.length && old[p] === part[p]) p++;
    let q = 0;
    while (q < old.length - p && q < part.length - p && old[old.length - 1 - q] === part[part.length - 1 - q]) q++;
    this.ta.setRangeText(part.slice(p, part.length - q), p, old.length - q);
    t.text = text;
    t.marks = marks;
    this.ta.setSelectionRange(this._view(sel[0]), this._view(sel[1]));
    this._render();
    this.onTrack();
  }

  // Strike the selection, or the line (the next line is then the current
  // one, for striking line after line). Struck already: unstruck.
  strikeSelection() {
    const t = this.track;
    if (!t) return false;
    const o = this._off;
    const v = this.ta.value;
    let a = this.ta.selectionStart;
    let b = this.ta.selectionEnd;
    const line = a === b;
    if (line) {
      a = v.lastIndexOf('\n', a - 1) + 1;
      const nl = v.indexOf('\n', a);
      b = nl === -1 ? v.length : nl + 1;
      if (a === b) return true;
    }
    const r = strike(t, a + o, b + o);
    this._trackKeep(null, true);
    let caret = r.end;
    if (line) { const nl = r.text.indexOf('\n', a + o); caret = nl === -1 ? r.text.length : nl + 1; }
    this._trackSet(r.text, r.marks, [caret, caret]);
    this._placeCurLine();
    return true;
  }

  // Strike the selection (or the word at the caret) and write after it.
  replaceSelection() {
    const t = this.track;
    if (!t) return false;
    let a = this.ta.selectionStart;
    let b = this.ta.selectionEnd;
    if (a === b) [a, b] = this._wordAt(a);
    if (a === b) return false;
    const r = strike(t, a + this._off, b + this._off);
    if (!r.struck) return false;
    this._trackKeep(null, true);
    this._trackSet(r.text, r.marks, [r.end, r.end]);
    return true;
  }

  // ---------------- the current line, marked (for showing the screen)
  setCurrentLine(on) {
    this.curLine.hidden = !on;
    this._placeCurLine();
  }

  _placeCurLine() {
    if (this.curLine.hidden || !this.el.isConnected) return;
    const v = this.ta.value;
    const s = this.ta.selectionStart;
    const a = v.lastIndexOf('\n', s - 1) + 1;
    const nl = v.indexOf('\n', s);
    const top = this._caretCoords(a).top;
    const bottom = this._caretCoords(nl === -1 ? v.length : nl).top + this.lineHeight();
    this.curLine.style.top = `${top}px`;
    this.curLine.style.height = `${Math.max(this.lineHeight(), bottom - top)}px`;
    this.curLine.style.transform = `translateY(${-this.ta.scrollTop}px)`;
  }

  // ---------------- notes in the margin: [{ from, to, el, cur }], each
  // element beside its line, the words it is on marked.
  setNotes(notes) {
    this.notes = notes;
    this.el.classList.toggle('with-notes', notes.length > 0);
    this.notesCol.replaceChildren(...notes.map((n) => n.el));
    this._renderFind();
    this._placeNotes();
  }

  _placeNotes() {
    if (!this.notes.length || !this.el.isConnected) return;
    let y = 0;
    const o = this._off;
    for (const n of [...this.notes].sort((x, z) => x.from - z.from)) {
      const out = n.from < o || n.from - o > this.ta.value.length;
      n.el.style.display = out ? 'none' : '';
      if (out) continue;
      const want = this._caretCoords(n.from - o).top;
      const top = Math.max(want, y);
      n.el.style.top = `${top}px`;
      y = top + n.el.offsetHeight + 8;
    }
  }

  // y offset of each source line inside the scrolled content.
  _lineOffsets() {
    if (this._lineOffsetCache) return this._lineOffsetCache;
    const probe = this._probe();
    const lines = this.ta.value.split('\n');
    probe.innerHTML = lines.map((l, i) => `<span data-l="${i}"></span>${esc(l)}`).join('\n');
    const base = probe.getBoundingClientRect().top - probe.scrollTop;
    const pad = parseFloat(getComputedStyle(this.ta).paddingTop) || 0;
    const res = [...probe.querySelectorAll('span[data-l]')].map((s) => s.getBoundingClientRect().top - base - pad);
    probe.textContent = '';
    this._lineOffsetCache = res;
    return res;
  }

  // The rows a line of the text box takes on the screen (wrapped), from its
  // start ls: [{ top, xs: [[offset in the line, x]] }] — the places in each
  // row and how far from the left they are (the last row has the line's end).
  _rows(ls) {
    const v = this.ta.value;
    const nl = v.indexOf('\n', ls);
    const text = v.slice(ls, nl < 0 ? v.length : nl);
    const probe = this._probe();
    probe.textContent = text;
    const node = probe.firstChild;
    const box = probe.getBoundingClientRect();
    const left = box.left + (parseFloat(getComputedStyle(probe).paddingLeft) || 0);
    const rows = [];
    const range = document.createRange();
    let last = null;
    for (let i = 0; i < text.length;) {
      const n = /[\uD800-\uDBFF]/.test(text[i]) && /[\uDC00-\uDFFF]/.test(text[i + 1] || '') ? 2 : 1;
      range.setStart(node, i);
      range.setEnd(node, i + n);
      const r = [...range.getClientRects()].find((x) => x.width || x.height) || range.getBoundingClientRect();
      const top = r.top - box.top;
      if (!rows.length || top >= rows.at(-1).top + r.height / 2) rows.push({ top, xs: [] });
      rows.at(-1).xs.push([i, r.left - left]);
      last = r;
      i += n;
    }
    if (!rows.length) rows.push({ top: 0, xs: [] });
    rows.at(-1).xs.push([text.length, last ? last.right - left : 0]);
    probe.textContent = '';
    return { len: text.length, rows };
  }

  // The place n rows on the screen below pos (above: n < 0), as near x
  // `goal` as it goes (the caret's own x when null): Emacs's ⌃N and ⌃P in
  // wrapped lines. → { pos, x }.
  _screenLine(pos, n, goal = null) {
    const v = this.ta.value;
    let ls = v.lastIndexOf('\n', pos - 1) + 1;
    let L = this._rows(ls);
    const rowOf = (col) => { let r = 0; while (r + 1 < L.rows.length && L.rows[r + 1].xs[0][0] <= col) r++; return r; };
    const col = pos - ls;
    let r = rowOf(col);
    const here = L.rows[r].xs.find(([o]) => o >= col) || L.rows[r].xs.at(-1);
    const x = goal ?? here[1];
    r += n;
    while (r < 0) {
      if (ls === 0) return { pos: 0, x };
      ls = ls >= 2 ? v.lastIndexOf('\n', ls - 2) + 1 : 0;
      L = this._rows(ls);
      r += L.rows.length;
    }
    while (r >= L.rows.length) {
      if (ls + L.len >= v.length) return { pos: v.length, x };
      r -= L.rows.length;
      ls += L.len + 1;
      L = this._rows(ls);
    }
    let best = L.rows[r].xs[0];
    for (const p of L.rows[r].xs) if (Math.abs(p[1] - x) < Math.abs(best[1] - x)) best = p;
    return { pos: ls + best[0], x };
  }

  // Scroll so the caret at pos (in the text box) is in view, a line or two
  // from the edge — setting the selection from a script doesn't.
  _keepInView(pos) {
    const ta = this.ta;
    const v = ta.value;
    let line = 0;
    for (let i = v.indexOf('\n'); i >= 0 && i < pos; i = v.indexOf('\n', i + 1)) line++;
    const ys = this._lineOffsets();
    const pad = parseFloat(getComputedStyle(ta).paddingTop) || 0;
    const lh = this.lineHeight();
    let y = (ys[line] ?? 0) + pad;
    if ((ys[line + 1] ?? Infinity) - (ys[line] ?? 0) > lh * 1.5) {
      // A long line, wrapped: the row the caret is in.
      const ls = v.lastIndexOf('\n', pos - 1) + 1;
      const { rows } = this._rows(ls);
      let r = 0;
      while (r + 1 < rows.length && rows[r + 1].xs[0][0] <= pos - ls) r++;
      y += rows[r].top;
    }
    const margin = Math.min(lh * 2, ta.clientHeight / 4);
    if (y < ta.scrollTop + margin) ta.scrollTop = Math.max(0, y - margin);
    else if (y + lh > ta.scrollTop + ta.clientHeight - margin) ta.scrollTop = y + lh - ta.clientHeight + margin;
    else return;
    this._syncScroll();
  }

  // ⌃L: the caret's line to the middle of the view, the top, the bottom.
  recenter(where = 'middle') {
    const ta = this.ta;
    const y = this._caretCoords(ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd).top;
    const lh = this.lineHeight();
    ta.scrollTop = Math.max(0, where === 'top' ? y - lh : where === 'bottom' ? y - ta.clientHeight + lh * 2 : y - (ta.clientHeight - lh) / 2);
    this._syncScroll();
  }

  _probe() {
    if (!this._probeEl) {
      this._probeEl = h('div', 'ed-layer ed-probe');
      this.el.append(this._probeEl);
    }
    return this._probeEl;
  }

  // Caret position relative to the editor's top-left (content coordinates).
  _caretCoords(offset) {
    const probe = this._probe();
    probe.innerHTML = `${esc(this.ta.value.slice(0, offset))}<span class="caret">​</span>`;
    const span = probe.querySelector('.caret');
    const r = span.getBoundingClientRect();
    const pr = probe.getBoundingClientRect();
    const out = { top: r.top - pr.top + probe.scrollTop, left: r.left - pr.left, height: r.height };
    probe.textContent = '';
    return out;
  }

  // ---------------- keyboard
  _keydown(e) {
    // Never interpret keys while an IME (e.g. Korean) is composing: Enter/Tab
    // there commit the composition and must not accept completions or indent.
    if (e.isComposing || e.keyCode === 229) return;
    if (!this.popup.hidden && this._popupKeys(e)) return;
    if (this.query && this._queryKey(e)) return;
    if (this.emacs.key(e)) return;
    const ta = this.ta;
    // Undo and redo: the editor's own history (undo.js).
    if (modKey(e) && !e.altKey && (e.code === 'KeyZ' || (!isMac && e.code === 'KeyY' && !e.shiftKey))) {
      e.preventDefault();
      if (e.code === 'KeyZ' && !e.shiftKey) this.undo(); else this.redo();
      return;
    }
    if (/^(Arrow|Home|End|Page)/.test(e.key)) this._closeStep();
    const { selectionStart: s, selectionEnd: end, value } = ta;
    const mod = modKey(e);
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const nl = value.indexOf('\n', s);
    const lineEnd = nl === -1 ? value.length : nl;
    const line = value.slice(lineStart, lineEnd);

    const cmd = commandOf(e);
    // Multi-cursor: ⌘D adds the next occurrence, ⌘⇧L selects all of them.
    if (cmd === 'next-occurrence') { e.preventDefault(); this._addNextOccurrence(); return; }
    if (cmd === 'all-occurrences') { e.preventDefault(); this._selectAllOccurrences(); return; }
    if (this.extra.length) {
      if (e.key === 'Escape') { e.preventDefault(); this._clearMulti(); return; }
      if (e.key === 'Tab' && !mod) { e.preventDefault(); this._applyMulti({ insert: '  ' }); return; }
      if (/^(Arrow|Home|End|Page)/.test(e.key) || (mod && !['z', 'c', 'x', 'v', 'a'].includes(e.key.toLowerCase()))) this._clearMulti();
      else return; // typing, deleting and pasting are handled in beforeinput
    }

    // Tables: Tab / Shift+Tab move between cells and keep columns aligned.
    if (e.key === 'Tab' && !mod && !e.altKey && !value.slice(s, end).includes('\n') && /^\s*\|/.test(line)) { e.preventDefault(); this.formatTable(e.shiftKey ? -1 : 1); return; }
    if (cmd && this._command(cmd)) { e.preventDefault(); return; }
    if (e.key === 'Escape' && this.find.open) { e.preventDefault(); this.closeFind(); return; }

    if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey && s === end) {
      const m = line.match(/^(\s*)([-*+]|\d+[.)]|>)(\s+)(\[[ xX]\]\s+)?(.*)$/);
      if (!m) {
        const indent = line.match(/^\s*/)[0];
        if (indent && s > lineStart + indent.length - 1) { e.preventDefault(); this.insert(`\n${indent}`); }
        return;
      }
      e.preventDefault();
      if (!m[5].trim() && s === lineEnd) { this._edit(lineStart, lineEnd, ''); return; } // empty item ends the list
      let marker = m[2];
      const num = marker.match(/^(\d+)([.)])$/);
      if (num) marker = `${Number(num[1]) + 1}${num[2]}`;
      this.insert(`\n${m[1]}${marker}${m[3]}${m[4] ? '[ ] ' : ''}`);
      return;
    }

    if (e.key === 'Tab' && !mod) {
      e.preventDefault();
      const multi = value.slice(s, end).includes('\n');
      const isList = /^\s*([-*+]|\d+[.)])\s/.test(line);
      if (multi || isList || e.shiftKey) this._indent(e.shiftKey ? -1 : 1);
      else this.insert('  ');
      return;
    }

    // Auto-pair and wrap.
    if (!mod && !e.altKey && PAIRS[e.key]) {
      const close = PAIRS[e.key];
      if (s !== end) { e.preventDefault(); this._wrap(e.key, close); return; }
      const next = value[s] || '';
      if ((e.key === close) && next === close) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
      const prev = value[s - 1] || '';
      const quoteLike = e.key === '"' || e.key === '`';
      if ((!next || /[\s)\]}.,;:!?]/.test(next)) && !(quoteLike && /[\p{L}\p{N}]/u.test(prev))) {
        e.preventDefault();
        this._edit(s, s, e.key + close, s + 1);
      }
      return;
    }
    if (!mod && [')', ']', '}'].includes(e.key) && s === end && value[s] === e.key) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
    if (e.key === 'Backspace' && s === end && s > 0 && PAIRS[value[s - 1]] === value[s] && value[s]) {
      e.preventDefault();
      this._edit(s - 1, s + 1, '');
    }
  }

  // A shortcut's command; false when it does nothing here (the find bar's
  // keys while not finding), so the key goes on to the app.
  _command(cmd) {
    const run = {
      'format-table': () => { this.formatTable(0); },
      find: () => this.openFind(),
      replace: () => this.openFind({ replace: true }),
      'find-next': () => this.find.open && (this._step(1), true),
      'find-prev': () => this.find.open && (this._step(-1), true),
      bold: () => this._wrap('**'),
      italic: () => this._wrap('*'),
      strike: () => (this.track ? this.strikeSelection() : this._wrap('~~')),
      'toggle-task': () => this._toggleTask(),
      'duplicate-line': () => this._duplicateLine(),
      'move-line-up': () => this._moveLines(-1),
      'move-line-down': () => this._moveLines(1),
      'expand-selection': () => this.expandSelection(),
      'shrink-selection': () => this.shrinkSelection(),
    }[cmd];
    return !!run && run() !== false;
  }

  // Word starts in view, nearest the caret first, with where they are on the
  // screen: for jump labels (avy, hop, flash).
  jumpTargets(max = 26 * 26) {
    const ta = this.ta;
    const text = ta.value;
    const view = ta.getBoundingClientRect();
    const lh = this.lineHeight();
    // The lines in view, from the line positions in the mirror layout.
    const ys = this._lineOffsets();
    const starts = [];
    for (let i = 0, p = 0; i < ys.length; i++) { starts.push(p); p = text.indexOf('\n', p) + 1 || text.length + 1; }
    const top = ta.scrollTop - lh;
    const bottom = ta.scrollTop + ta.clientHeight;
    let first = 0;
    while (first + 1 < ys.length && ys[first + 1] <= top) first++;
    let last = first;
    while (last + 1 < ys.length && ys[last + 1] < bottom) last++;
    const from = starts[first];
    const to = last + 1 < starts.length ? starts[last + 1] - 1 : text.length;
    const offsets = [];
    // Words, and where each line's text starts (a heading's #, a list's -).
    const part = text.slice(from, to);
    const set = new Set();
    for (const m of part.matchAll(/[\p{L}\p{N}_]+/gu)) set.add(from + m.index);
    for (const m of part.matchAll(/^[ \t]*(?=\S)/gm)) set.add(from + m.index + m[0].length);
    offsets.push(...[...set].sort((x, y) => x - y));
    if (!offsets.length) return [];
    const probe = this._probe();
    let html = '';
    let pos = 0;
    offsets.forEach((o, i) => { html += `${esc(text.slice(pos, o))}<span data-j="${i}"></span>`; pos = o; });
    probe.innerHTML = `${html}${esc(text.slice(pos, to))}`;
    // The probe isn't scrolled: move its places up by the text box's scroll.
    const pr = probe.getBoundingClientRect();
    const out = [];
    for (const span of probe.querySelectorAll('span[data-j]')) {
      const r = span.getBoundingClientRect();
      const y = view.top + (r.top - pr.top) - ta.scrollTop;
      if (y < view.top - 2 || y > view.bottom - lh / 2) continue;
      out.push({ offset: offsets[span.dataset.j], left: view.left + (r.left - pr.left), top: y });
    }
    probe.textContent = '';
    const caret = ta.selectionStart;
    out.sort((x, y) => Math.abs(x.offset - caret) - Math.abs(y.offset - caret));
    return out.slice(0, max).map((x) => ({ ...x, offset: x.offset + this._off }));
  }

  // Larger and smaller pieces of the note (expand.js). Shrinking goes back
  // through the selections expanding went through.
  expandSelection() {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    const top = this._expanded?.at(-1);
    if (!top || top.to[0] !== a || top.to[1] !== b) this._expanded = [];
    const r = expandRange(this.ta.value, a, b);
    if (!r) return;
    this._expanded.push({ from: [a, b], to: r });
    this._select(r[0], r[1]);
  }

  shrinkSelection() {
    const { selectionStart: a, selectionEnd: b } = this.ta;
    const top = this._expanded?.at(-1);
    if (!top || top.to[0] !== a || top.to[1] !== b) { this._expanded = []; return; }
    this._expanded.pop();
    this._select(top.from[0], top.from[1]);
  }

  _wrap(open, close = open) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const sel = value.slice(s, e);
    if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
      this._edit(s, e, sel.slice(open.length, sel.length - close.length), s, e - open.length - close.length);
    } else if (value.slice(s - open.length, s) === open && value.slice(e, e + close.length) === close) {
      this._edit(s - open.length, e + close.length, sel, s - open.length, e - open.length);
    } else {
      this._edit(s, e, open + sel + close, s + open.length, e + open.length);
    }
  }

  _lineRange() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const a = value.lastIndexOf('\n', s - 1) + 1;
    const endAdj = e > s && value[e - 1] === '\n' ? e - 1 : e;
    const n = value.indexOf('\n', endAdj);
    return [a, n === -1 ? value.length : n];
  }

  _indent(dir) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const [a, b] = this._lineRange();
    const lines = value.slice(a, b).split('\n');
    let delta0 = 0;
    let total = 0;
    const out = lines.map((l, i) => {
      if (dir > 0) { if (i === 0) delta0 = 2; total += 2; return `  ${l}`; }
      const n = Math.min(2, l.match(/^ */)[0].length);
      if (i === 0) delta0 = -n;
      total -= n;
      return l.slice(n);
    });
    this._edit(a, b, out.join('\n'), Math.max(a, s + delta0), Math.max(a, e + total));
  }

  _toggleTask() {
    const [a, b] = this._lineRange();
    const { selectionStart: s, value } = this.ta;
    const lines = value.slice(a, b).split('\n').map((l) => {
      if (/^\s*([-*+]|\d+[.)])\s+\[ \]/.test(l)) return l.replace('[ ]', '[x]');
      if (/^\s*([-*+]|\d+[.)])\s+\[[xX]\]/.test(l)) return l.replace(/\[[xX]\]/, '[ ]');
      if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) return l.replace(/^(\s*([-*+]|\d+[.)])\s+)/, '$1[ ] ');
      return l.replace(/^(\s*)/, '$1- [ ] ');
    });
    const text = lines.join('\n');
    this._edit(a, b, text, Math.min(a + text.length, s + (text.length - (b - a))));
  }

  _duplicateLine() {
    const [a, b] = this._lineRange();
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const block = value.slice(a, b);
    this._edit(b, b, `\n${block}`, s + block.length + 1, e + block.length + 1);
  }

  _moveLines(dir) {
    const [a, b] = this._lineRange();
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const block = value.slice(a, b);
    if (dir < 0) {
      if (a === 0) return;
      const pa = value.lastIndexOf('\n', a - 2) + 1;
      const prev = value.slice(pa, a - 1);
      this._edit(pa, b, `${block}\n${prev}`, s - prev.length - 1, e - prev.length - 1);
    } else {
      if (b >= value.length) return;
      const nb = value.indexOf('\n', b + 1);
      const nextEnd = nb === -1 ? value.length : nb;
      const next = value.slice(b + 1, nextEnd);
      this._edit(a, nextEnd, `${next}\n${block}`, s + next.length + 1, e + next.length + 1);
    }
  }

  // ---------------- multi-cursor
  _clearMulti() {
    if (!this.extra.length) return;
    this.extra = [];
    this._renderFind();
  }

  _wordAt(pos) {
    const v = this.ta.value;
    const isW = (c) => /[\p{L}\p{N}_]/u.test(c || '');
    let a = pos; let b = pos;
    while (a > 0 && isW(v[a - 1])) a--;
    while (b < v.length && isW(v[b])) b++;
    return [a, b];
  }

  _addNextOccurrence() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    if (s === e) {
      const [a, b] = this._wordAt(s);
      if (a !== b) this.ta.setSelectionRange(a, b);
      return;
    }
    const needle = value.slice(s, e);
    const taken = [[s, e], ...this.extra];
    const last = Math.max(...taken.map((r) => r[1]));
    let i = value.indexOf(needle, last);
    if (i === -1) i = value.indexOf(needle);
    while (i !== -1 && taken.some(([a]) => a === i)) {
      i = value.indexOf(needle, i + 1);
      if (i === -1 || i === s) { i = -1; break; }
    }
    if (i === -1) return;
    this.extra.push([s, e]);
    this.ta.setSelectionRange(i, i + needle.length);
    this._scrollTo(i, 0.4);
    this._renderFind();
  }

  _selectAllOccurrences() {
    let { selectionStart: s, selectionEnd: e } = this.ta;
    if (s === e) { [s, e] = this._wordAt(s); if (s === e) return; }
    const v = this.ta.value;
    const needle = v.slice(s, e);
    const all = [];
    for (let i = v.indexOf(needle); i !== -1; i = v.indexOf(needle, i + needle.length)) all.push([i, i + needle.length]);
    this.ta.setSelectionRange(s, e);
    this.extra = all.filter(([a]) => a !== s);
    this._renderFind();
  }

  _multiInput(e) {
    if (!this.extra.length) return;
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText') { e.preventDefault(); this._applyMulti({ insert: e.data ?? '' }); }
    else if (t === 'insertLineBreak' || t === 'insertParagraph') { e.preventDefault(); this._applyMulti({ insert: '\n' }); }
    else if (t === 'insertFromPaste') { e.preventDefault(); this._applyMulti({ insert: e.dataTransfer?.getData('text/plain') ?? '' }); }
    else if (t === 'deleteContentBackward' || t === 'deleteWordBackward') { e.preventDefault(); this._applyMulti({ del: -1 }); }
    else if (t === 'deleteContentForward' || t === 'deleteWordForward') { e.preventDefault(); this._applyMulti({ del: 1 }); }
    else if (t === 'historyUndo' || t === 'historyRedo') this._clearMulti();
    else this._clearMulti();
  }

  // Apply one edit at every selection as a single replace, so one ⌘Z undoes it.
  _applyMulti({ insert = '', del = 0 }) {
    const v = this.ta.value;
    const primary = [this.ta.selectionStart, this.ta.selectionEnd];
    const ranges = [primary, ...this.extra].map(([a, b]) => {
      if (a === b && del < 0) return [Math.max(0, a - 1), b];
      if (a === b && del > 0) return [a, Math.min(v.length, b + 1)];
      return [a, b];
    }).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const r of ranges) {
      const lastR = merged[merged.length - 1];
      if (lastR && r[0] < lastR[1]) lastR[1] = Math.max(lastR[1], r[1]);
      else merged.push([...r]);
    }
    const from = merged[0][0];
    const to = merged[merged.length - 1][1];
    let out = '';
    let pos = from;
    for (const [a, b] of merged) {
      out += v.slice(pos, a) + insert;
      pos = b;
    }
    out += v.slice(pos, to);
    // Caret after each inserted text, in new-text coordinates.
    const newCarets = [];
    let acc = 0;
    for (const [a, b] of merged) {
      const c = a + acc + insert.length;
      newCarets.push(c);
      acc += insert.length - (b - a);
    }
    const primaryIdx = merged.findIndex(([a, b]) => a <= primary[0] && primary[0] <= Math.max(b, a));
    const main = newCarets[primaryIdx === -1 ? newCarets.length - 1 : primaryIdx];
    this._edit(from, to, out, main, main);
    this.extra = newCarets.filter((c) => c !== main).map((c) => [c, c]);
    this._renderFind();
  }

  // ---------------- tables
  // Aligns the pipe table around the caret (display width aware, so Korean
  // and other wide characters line up) and optionally moves to another cell.
  formatTable(move = 0) {
    const v = this.ta.value;
    const caret = this.ta.selectionStart;
    const lines = v.split('\n');
    let offset = 0;
    let row = 0;
    for (; row < lines.length; row++) { if (offset + lines[row].length >= caret) break; offset += lines[row].length + 1; }
    const isRow = (l) => /^\s*\|/.test(l || '');
    if (!isRow(lines[row])) return false;
    let top = row; while (top > 0 && isRow(lines[top - 1])) top--;
    let bottom = row; while (bottom < lines.length - 1 && isRow(lines[bottom + 1])) bottom++;
    const col = (lines[row].slice(0, caret - offset).match(/(?<!\\)\|/g) || []).length - 1;
    const split = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    const rows = lines.slice(top, bottom + 1).map(split);
    const sepIdx = rows.findIndex((r) => r.length && r.every((c) => /^:?-{1,}:?$/.test(c)));
    const ncol = Math.max(...rows.map((r) => r.length));
    const width = (str) => [...str].reduce((n, ch) => n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}]/u.test(ch) ? 2 : 1), 0);
    const widths = Array.from({ length: ncol }, (_, i) => Math.max(3, ...rows.map((r, k) => (k === sepIdx ? 3 : width(r[i] || '')))));
    const pad = (str, w, align) => {
      const gap = w - width(str);
      if (align === 'right') return ' '.repeat(gap) + str;
      if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + str + ' '.repeat(Math.ceil(gap / 2));
      return str + ' '.repeat(gap);
    };
    const aligns = sepIdx === -1 ? [] : rows[sepIdx].map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
    const indent = lines[top].match(/^\s*/)[0];
    // Padded cells (string lengths differ from display widths for CJK).
    const cells = rows.map((r, k) => widths.map((w, i) => {
      if (k === sepIdx) { const a = aligns[i]; return (a === 'center' ? ':' : '-') + '-'.repeat(w - 2) + (a === 'center' || a === 'right' ? ':' : '-'); }
      return pad(r[i] || '', w, aligns[i]);
    }));
    const out = cells.map((c) => `${indent}| ${c.join(' | ')} |`);
    // Target cell after formatting.
    let tRow = row - top;
    let tCol = Math.max(0, col) + move;
    if (move !== 0) {
      if (tCol >= ncol) { tCol = 0; tRow++; }
      if (tCol < 0) { tCol = ncol - 1; tRow--; }
      if (tRow === sepIdx) tRow += move > 0 ? 1 : -1;
      if (tRow < 0) { tRow = 0; tCol = 0; }
      if (tRow >= out.length) { const blank = widths.map((w) => ' '.repeat(w)); cells.push(blank); out.push(`${indent}| ${blank.join(' | ')} |`); }
    }
    const blockStart = lines.slice(0, top).reduce((n, l) => n + l.length + 1, 0);
    const blockEnd = blockStart + lines.slice(top, bottom + 1).join('\n').length;
    const text = out.join('\n');
    const rowStart = blockStart + out.slice(0, tRow).reduce((n, l) => n + l.length + 1, 0);
    const cellStart = rowStart + indent.length + 2 + cells[tRow].slice(0, tCol).reduce((n, c) => n + c.length + 3, 0);
    const cellText = cells[tRow][tCol].trim();
    const lead = cells[tRow][tCol].length - cells[tRow][tCol].trimStart().length;
    const cellEnd = cellStart + lead + (tRow === sepIdx ? 0 : cellText.length);
    this._edit(blockStart, blockEnd, text, move ? cellStart + lead : this.ta.selectionStart, move ? cellEnd : this.ta.selectionStart);
    return true;
  }

  // ---------------- paste / drop
  _paste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && this.onPasteFiles) { e.preventDefault(); this.onPasteFiles(files); return; }
    const text = e.clipboardData?.getData('text/plain') || '';
    const { selectionStart: s, selectionEnd: end, value } = this.ta;
    // Paste a URL over selected text → Markdown link.
    if (s !== end && /^https?:\/\/\S+$/.test(text.trim()) && !value.slice(s, end).includes('\n')) {
      e.preventDefault();
      this._edit(s, end, `[${value.slice(s, end)}](${text.trim()})`);
    }
  }

  _drop(e) {
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length && this.onPasteFiles) {
      e.preventDefault();
      this.focus();
      this.onPasteFiles(files);
    }
  }

  // ---------------- autocomplete ([[links]], [[link#sections]] and #tags)
  _maybeComplete() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    if (s !== e) return this._closePopup();
    const before = value.slice(Math.max(0, s - 120), s);
    let m;
    let ctx = null;
    if ((m = before.match(/\[\[([^\]\n|#]*)#([^\]\n|#]*)$/))) ctx = { kind: 'heading', note: m[1], query: m[2], from: s - m[2].length };
    else if ((m = before.match(/\[\[([^\]\n|#]*)$/))) ctx = { kind: 'link', query: m[1], from: s - m[1].length };
    else if ((m = before.match(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)$/u))) ctx = { kind: 'tag', query: m[1], from: s - m[1].length };
    else ctx = this._stepContext(s, value);
    if (!ctx) return this._closePopup();
    const items = this.complete(ctx.kind, ctx.query, ctx).slice(0, 12);
    if (!items.length) return this._closePopup();
    this._ac = { ...ctx, items, sel: 0 };
    this._renderPopup();
  }

  // In a ```flow block, the step being written (after the last arrow, or
  // the line's start), for names already used in the note.
  _stepContext(s, value) {
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const rest = value.slice(s, value.indexOf('\n', s) < 0 ? value.length : value.indexOf('\n', s));
    if (rest.trim() && !/^\s*(->|-->|\.\.>|<->|--|→|-\()/.test(rest)) return null;
    let fence = null;
    for (const m of value.slice(0, lineStart).matchAll(/^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/gm)) {
      if (!fence) fence = { mark: m[1], lang: m[2].toLowerCase() };
      else if (m[1].startsWith(fence.mark[0]) && m[1].length >= fence.mark.length && !m[2]) fence = null;
    }
    if (fence?.lang !== 'flow') return null;
    const line = value.slice(lineStart, s);
    if (/^\s*(#|\/\/)|\s:\s/.test(line)) return null;
    const piece = line.split(/\s*(?:<->|\.\.>|-\([^()]*\)->|-->|->|→|--)\s*/).pop().replace(/^\s*[[(]*/, '');
    if (!piece.trim() || /^\s/.test(piece)) return null;
    return { kind: 'step', query: piece, from: s - piece.length };
  }

  _renderPopup() {
    const { items, sel, from } = this._ac;
    this.popup.replaceChildren(...items.map((it, i) => {
      const row = h('div', `ed-popup-item${i === sel ? ' sel' : ''}`);
      row.append(h('span', '', it.label), it.detail ? h('span', 'detail', it.detail) : '');
      row.addEventListener('mousedown', (ev) => { ev.preventDefault(); this._ac.sel = i; this._accept(); });
      return row;
    }));
    const c = this._caretCoords(from);
    const top = c.top - this.ta.scrollTop + c.height + 4;
    const maxLeft = this.el.clientWidth - 280;
    this.popup.style.top = `${top > this.el.clientHeight - 200 ? c.top - this.ta.scrollTop - 4 - Math.min(items.length, 8) * 26 : top}px`;
    this.popup.style.left = `${Math.max(8, Math.min(maxLeft, c.left))}px`;
    this.popup.hidden = false;
    this.popup.children[sel]?.scrollIntoView({ block: 'nearest' });
  }

  _popupKeys(e) {
    const ac = this._ac;
    if (e.key === 'ArrowDown') { ac.sel = (ac.sel + 1) % ac.items.length; this._renderPopup(); e.preventDefault(); return true; }
    if (e.key === 'ArrowUp') { ac.sel = (ac.sel - 1 + ac.items.length) % ac.items.length; this._renderPopup(); e.preventDefault(); return true; }
    // A step's name is offered, not pressed on: Enter still ends the line.
    if (e.key === 'Enter' && ac.kind === 'step') { this._closePopup(); return false; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this._accept(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this._closePopup(); return true; }
    return false;
  }

  _accept() {
    const { items, sel, from, kind } = this._ac;
    const it = items[sel];
    const s = this.ta.selectionStart;
    const after = this.ta.value.slice(s, s + 2);
    let text = it.insert;
    const link = kind === 'link' || kind === 'heading';
    if (link && after !== ']]') text += ']]';
    else if (link) { this._closePopup(); this._edit(from, s + 2, `${text}]]`); return; }
    this._closePopup();
    this._edit(from, s, text + (kind === 'tag' ? ' ' : ''));
  }

  _closePopup() { this.popup.hidden = true; this._ac = null; }

  // ---------------- find / replace
  _buildFindBar() {
    const bar = h('div', 'ed-find');
    bar.hidden = true;
    const input = h('input', 'ed-find-input');
    input.placeholder = 'Find';
    input.spellcheck = false;
    const rep = h('input', 'ed-find-input ed-replace-input');
    rep.placeholder = 'Replace';
    rep.spellcheck = false;
    const count = h('span', 'ed-find-count', '');
    const btn = (label, title, fn, cls = '') => {
      const b = h('button', `ed-find-btn ${cls}`, label);
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };
    const caseBtn = btn('Aa', 'Match case', () => { this.find.caseSensitive = !this.find.caseSensitive; caseBtn.classList.toggle('on'); this._runFind(true); });
    const reBtn = btn('.*', 'Regular expression', () => { this.find.regex = !this.find.regex; reBtn.classList.toggle('on'); this._runFind(true); });
    this.reBtn = reBtn;
    const toggleRep = btn('⇅', 'Toggle replace', () => { bar.classList.toggle('with-replace'); if (bar.classList.contains('with-replace')) rep.focus(); });
    const row1 = h('div', 'ed-find-row');
    row1.append(toggleRep, input, caseBtn, reBtn, count,
      btn('↑', 'Previous (⇧Enter)', () => this._step(-1)), btn('↓', 'Next (Enter)', () => this._step(1)), btn('×', 'Close (Esc)', () => this.closeFind()));
    const row2 = h('div', 'ed-find-row ed-replace-row');
    row2.append(h('span', 'ed-find-spacer', ''), rep,
      btn('Replace', 'Replace current', () => this._replaceOne(), 'text'), btn('All', 'Replace all', () => this._replaceAll(), 'text'));
    bar.append(row1, row2);
    input.addEventListener('input', () => { this.find.query = input.value; this._runFind(true); });
    rep.addEventListener('input', () => { this.find.replace = rep.value; });
    const keys = (e) => {
      const em = emacs.on && !e.isComposing ? keyName(e) : null;
      // Query replace, asked for: Enter goes to what to put instead, then starts.
      if (this._qr && e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        if (e.target === input) { rep.focus(); rep.select(); } else this._queryStart();
        return;
      }
      if (em === 'C-s' || em === 'C-r') { e.preventDefault(); this.isearch(em === 'C-s' ? 1 : -1); return; }
      if (em === 'C-g') { e.preventDefault(); this._isearchQuit(); return; }
      if (em === 'M-%' || em === 'C-M-%') { e.preventDefault(); this.queryReplace({ regex: em === 'C-M-%', query: input.value }); return; }
      if (this._isearch && e.key === 'Enter' && e.target === input && !e.shiftKey && !e.isComposing) { e.preventDefault(); this._isearchEnd(); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
      else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); this._step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && e.target === rep) { e.preventDefault(); (modKey(e) ? this._replaceAll() : this._replaceOne()); }
      else if (['find-next', 'find-prev'].includes(commandOf(e))) { e.preventDefault(); this._step(commandOf(e) === 'find-next' ? 1 : -1); }
    };
    input.addEventListener('keydown', keys);
    rep.addEventListener('keydown', keys);
    this.findInput = input;
    this.replaceInput = rep;
    this.findCount = count;
    return bar;
  }

  // ---------------- Emacs's searches (emacs.js)
  // ⌃S / ⌃R: the find bar, or the next (previous) match in it. Enter stays
  // at the match, the mark where the search began; ⌃G goes back there.
  isearch(dir) {
    const ta = this.ta;
    if (!this._isearch) this._isearch = { from: [ta.selectionStart, ta.selectionEnd], dir };
    this._isearch.dir = dir;
    if (this.find.open && document.activeElement === this.findInput) { this._step(dir); return; }
    this.openFind();
    const m = this.find.matches;
    if (dir < 0 && m.length) {
      let i = m.length - 1;
      for (let k = 0; k < m.length; k++) if (m[k][0] < this._isearch.from[0]) i = k;
      this.find.index = i;
      this.findCount.textContent = `${i + 1}/${m.length}`;
      this._renderFind();
      this._reveal(i, false);
    }
  }

  _isearchEnd() {
    const s = this._isearch;
    const m = this.find.matches[this.find.index];
    if (m) { this.ta.setSelectionRange(m[0], m[1]); this._findEnd = s.dir < 0 ? 'start' : 'end'; }
    this.closeFind();
    if (!m) return;
    const p = s.dir < 0 ? m[0] : m[1];
    this.ta.setSelectionRange(p, p);
    this.emacs.pushMark(s.from[0], { quiet: true });
    emacs.hooks.echo?.('Mark saved where search started');
  }

  _isearchQuit() {
    const s = this._isearch;
    if (this._qr) { this.closeFind(); return; }
    this.closeFind();
    if (s) this._select(s.from[0], s.from[1]);
    emacs.hooks.echo?.('Quit');
  }

  // Query replace (M-%, ⌥X s q): what to find and what to put instead in the
  // find bar, Enter after each; then every match from the caret (in the
  // selected lines, if some) asks: y or Space replaces, n or ⌫ skips, !
  // replaces the rest, . replaces this one and stops, ^ goes back, q or
  // Enter stops. One ⌘Z takes back one replacement (! all of them).
  queryReplace({ regex = false, query = null } = {}) {
    const ta = this.ta;
    const [s, e] = [ta.selectionStart, ta.selectionEnd];
    const lines = ta.value.slice(s, e).includes('\n');
    if (lines) ta.setSelectionRange(s, s);
    this.find.regex = regex;
    this.reBtn.classList.toggle('on', regex);
    this.openFind({ replace: true, query });
    this._qr = { from: s, to: lines ? e : null };
    this.findCount.textContent = regex ? 'Query replace regexp: Enter' : 'Query replace: Enter';
    if (query) { this.replaceInput.focus(); this.replaceInput.select(); }
  }

  _queryStart() {
    const q = this._qr;
    this._qr = null;
    if (!this._pattern()) return;
    this.query = { at: q.from, end: q.to, n: 0, back: [], cur: null };
    this.emacs.pushMark(q.from, { quiet: true });
    // Read-only meanwhile: y and n (in Korean too) answer, they don't type.
    this.ta.readOnly = true;
    this.focus();
    this._queryNext();
  }

  _queryNext() {
    const q = this.query;
    const re = this._pattern();
    const v = this.ta.value;
    re.lastIndex = q.at;
    let m;
    while ((m = re.exec(v)) && m[0] === '') re.lastIndex++;
    if (!m || (q.end != null && m.index + m[0].length > q.end)) { this._queryDone(); return; }
    q.cur = [m.index, m.index + m[0].length];
    this.ta.setSelectionRange(q.cur[0], q.cur[1]);
    this._runFind(false);
    this.find.index = this.find.matches.findIndex(([a]) => a === q.cur[0]);
    this._renderFind();
    if (this.find.index >= 0) this._reveal(this.find.index, false);
    const cut = (t) => (t.length > 24 ? `${t.slice(0, 23)}…` : t);
    const ask = `Replace “${cut(m[0])}” with “${cut(this._replacement(m[0]))}”?  y n ! . ^ q`;
    this.findCount.textContent = ask;
    emacs.hooks.echo?.(ask, true);
  }

  _queryReplaceHere() {
    const q = this.query;
    const [a, b] = q.cur;
    const rep = this._replacement(this.ta.value.slice(a, b));
    this._closeStep();
    this._edit(a, b, rep, a + rep.length);
    q.n++;
    q.back.push(a);
    q.at = a + rep.length;
    if (q.end != null) q.end += rep.length - (b - a);
  }

  // → true when the key answered (or was a lone modifier).
  _queryKey(e) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return true;
    const k = keyName(e);
    const q = this.query;
    if (k === 'y' || k === 'SPC') { this._queryReplaceHere(); this._queryNext(); }
    else if (k === 'n' || k === 'DEL' || k === 'deletechar') { q.back.push(q.cur[0]); q.at = q.cur[1]; this._queryNext(); }
    else if (k === '.') { this._queryReplaceHere(); this._queryDone(); }
    else if (k === '^') { if (q.back.length) q.at = q.back.pop(); this._queryNext(); }
    else if (k === '!') {
      const re = this._pattern();
      const v = this.ta.value;
      const from = q.cur[0];
      const end = q.end ?? v.length;
      let out = '';
      let last = from;
      let count = 0;
      re.lastIndex = from;
      let m;
      while ((m = re.exec(v))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        if (m.index + m[0].length > end) break;
        out += v.slice(last, m.index) + this._replacement(m[0]);
        last = m.index + m[0].length;
        count++;
      }
      if (count) { this._closeStep(); this._edit(from, last, out, from + out.length); q.n += count; q.at = from + out.length; }
      this._queryDone();
    } else if (['q', 'RET', 'ESC', 'C-g'].includes(k)) this._queryDone();
    else { this._queryDone(); return false; } // another key: done, and the key does its own
    e.preventDefault();
    return true;
  }

  _queryDone() {
    const q = this.query;
    if (!q) return;
    this.query = null;
    this.ta.readOnly = false;
    const p = Math.min(q.at, this.ta.value.length);
    this.ta.setSelectionRange(p, p);
    this.closeFind();
    emacs.hooks.echo?.(`Replaced ${q.n} occurrence${q.n === 1 ? '' : 's'}`);
  }

  _pattern() { return findPattern(this.find); }

  // The k-th match after the selection (no wrapping), selected: a find made
  // while recording a macro, played back. False when there isn't one.
  findNth(spec, k = 1) {
    const re = findPattern(spec);
    if (!re) return false;
    re.lastIndex = this.ta.selectionEnd;
    let m;
    for (let n = 0; (m = re.exec(this.ta.value));) {
      if (m[0] === '') { re.lastIndex++; continue; }
      if (++n === k) { this._select(m.index, m.index + m[0].length); return true; }
    }
    return false;
  }

  // Replace every match of spec.query with spec.replace (Replace all).
  replaceAllMatches(spec) {
    const re = findPattern(spec);
    if (!re) return 0;
    const one = new RegExp(re.source, re.flags.replace('g', ''));
    let count = 0;
    const next = this.ta.value.replace(re, (m) => { count++; return spec.regex ? m.replace(one, spec.replace) : spec.replace; });
    if (!count) return 0;
    this.quietEdit = true;
    try { this._edit(0, this.ta.value.length, next, 0); } finally { this.quietEdit = false; }
    return count;
  }

  _runFind(jump) {
    const re = this._pattern();
    const text = this.ta.value;
    const matches = [];
    if (re) {
      let m;
      while ((m = re.exec(text)) && matches.length < 5000) {
        if (m[0] === '') { re.lastIndex++; continue; }
        matches.push([m.index, m.index + m[0].length]);
      }
    }
    this.find.matches = matches;
    const caret = this.ta.selectionStart;
    let idx = matches.findIndex(([a]) => a >= caret);
    if (idx === -1) idx = matches.length ? 0 : -1;
    this.find.index = idx;
    this.findInput.classList.toggle('bad', !!this.find.query && !matches.length);
    this.findCount.textContent = this.find.query ? (matches.length ? `${idx + 1}/${matches.length}` : 'No results') : '';
    this._renderFind();
    if (jump && idx >= 0) this._reveal(idx, false);
  }

  _reveal(idx, select = true) {
    const [a, b] = this.find.matches[idx];
    if (select) this.ta.setSelectionRange(a, b);
    const c = this._caretCoords(a);
    if (c.top < this.ta.scrollTop || c.top > this.ta.scrollTop + this.ta.clientHeight - 40) {
      this.ta.scrollTop = Math.max(0, c.top - this.ta.clientHeight / 3);
      this._syncScroll();
    }
  }

  _step(dir) {
    if (!this.find.open) { this.openFind(); return; }
    const n = this.find.matches.length;
    if (!n) return;
    this.find.index = (this.find.index + dir + n) % n;
    this.findCount.textContent = `${this.find.index + 1}/${n}`;
    this._renderFind();
    this._reveal(this.find.index);
    this.findInput.focus();
  }

  _replacement(matchText) {
    if (!this.find.regex) return this.find.replace;
    const re = this._pattern();
    return matchText.replace(new RegExp(re.source, re.flags.replace('g', '')), this.find.replace);
  }

  _replaceOne() {
    const { matches, index } = this.find;
    if (index < 0 || !matches[index]) return;
    const [a, b] = matches[index];
    const rep = this._replacement(this.ta.value.slice(a, b));
    this._edit(a, b, rep, a + rep.length);
    this._runFind(false);
    if (this.find.matches.length) { this.find.index = Math.min(index, this.find.matches.length - 1); this._reveal(this.find.index, false); this._renderFind(); }
  }

  _replaceAll() {
    const re = this._pattern();
    if (!re || !this.find.matches.length) return;
    const { query, caseSensitive, regex, replace } = this.find;
    const count = this.replaceAllMatches({ query, caseSensitive, regex, replace });
    editorWatch.replaceAll?.(this, { query, caseSensitive, regex, replace });
    this._runFind(false);
    this.findCount.textContent = `Replaced ${count}`;
  }
}

function h(tag, cls = '', text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
