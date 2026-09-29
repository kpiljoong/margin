// Lightweight Markdown editor: a native <textarea> (fast, IME/accessibility
// friendly, native undo) layered over two mirrors that render exactly the
// same text — one with syntax colors, one with find-match backgrounds.
// Styling rule: highlight only with color/background/underline so glyph
// widths never change and the layers stay aligned in proportional fonts too.

import { eventKeys } from './keys.js';

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

export class MarkdownEditor {
  constructor({ onChange, onScroll, onCursor, complete, onPasteFiles } = {}) {
    this.onChange = onChange || (() => {});
    this.onScroll = onScroll || (() => {});
    this.onCursor = onCursor || (() => {});
    this.complete = complete || (() => []);
    this.onPasteFiles = onPasteFiles || null;
    this.highlightOn = true;
    this.find = { open: false, query: '', replace: '', caseSensitive: false, regex: false, matches: [], index: -1 };
    this.extra = []; // additional selections for multi-cursor editing: [start, end]
    this.hints = []; // ranges shown faintly for a moment (e.g. mentions of a box): [start, end]

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
    this.el.append(this.findLayer, this.hlLayer, this.ta, this.popup, this.findBar);

    this.ta.addEventListener('input', () => this._changed());
    this.ta.addEventListener('beforeinput', (e) => this._multiInput(e));
    this.ta.addEventListener('mousedown', () => this._clearMulti());
    this.ta.addEventListener('compositionstart', () => this._clearMulti());
    this.ta.addEventListener('scroll', () => this._syncScroll());
    this.ta.addEventListener('keydown', (e) => this._keydown(e));
    this.ta.addEventListener('keyup', () => this.onCursor());
    this.ta.addEventListener('click', () => { this._closePopup(); this.onCursor(); });
    this.ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== this.ta) this._closePopup(); }, 150));
    this.ta.addEventListener('paste', (e) => this._paste(e));
    this.ta.addEventListener('drop', (e) => this._drop(e));
    this.ta.addEventListener('compositionend', () => this._changed());
    new ResizeObserver(() => { this._lineOffsetCache = null; this._syncScroll(); }).observe(this.ta);
  }

  // ---------------- public API
  get value() { return this.ta.value; }
  set value(v) { this.ta.value = v; this.extra = []; this.hints = []; this._render(); }
  focus() { this.ta.focus({ preventScroll: true }); }
  get selectionStart() { return this.ta.selectionStart; }
  get selectionEnd() { return this.ta.selectionEnd; }
  setSelection(a, b = a) { this.ta.setSelectionRange(a, b); }
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

  cursorLine() { return this.ta.value.slice(0, this.ta.selectionStart).split('\n').length; }

  // Top visible source line (1-based), measured through the mirror layout.
  topLine() {
    // Exact per-line measurement is O(lines) layout work; for very long
    // documents a proportional estimate is plenty for scroll sync.
    if (this.ta.value.length > 150_000) {
      const total = this.ta.value.split('\n').length;
      return Math.max(1, Math.round((this.ta.scrollTop / Math.max(1, this.ta.scrollHeight - this.ta.clientHeight)) * (total - 1)) + 1);
    }
    const spans = this._lineOffsets();
    const y = this.ta.scrollTop;
    let lo = 0; let hi = spans.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (spans[mid] <= y) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }

  gotoLine(line, { select = true } = {}) {
    const lines = this.ta.value.split('\n');
    const idx = Math.max(0, Math.min(lines.length, line) - 1);
    const start = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
    this.focus();
    this.ta.setSelectionRange(start, select ? start + lines[idx].length : start);
    this.scrollToOffset(start);
  }

  // Select start…end (or put the cursor there), scrolled into view if needed.
  selectRange(start, end = start, focus = true) {
    if (focus) this.focus();
    this.ta.setSelectionRange(start, end);
    const y = this._caretCoords(start).top - this.ta.scrollTop;
    if (y < 0 || y > this.ta.clientHeight - this.lineHeight()) this.scrollToOffset(start);
  }

  scrollToOffset(offset, ratio = 1 / 3) {
    const y = this._caretCoords(offset).top;
    this.ta.scrollTop = Math.max(0, y - this.ta.clientHeight * ratio);
    this._syncScroll();
  }

  scrollToLine(line) {
    if (this.ta.value.length > 150_000) { this.scrollToOffset(this.ta.value.split('\n').slice(0, line - 1).join('\n').length, 0); return; }
    const spans = this._lineOffsets();
    this.ta.scrollTop = spans[Math.max(0, Math.min(spans.length - 1, line - 1))] || 0;
    this._syncScroll();
  }

  // Replace a range through execCommand so the native undo stack keeps working.
  replace(start, end, text, selStart = start + text.length, selEnd = selStart) {
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

  insert(text) { this.replace(this.ta.selectionStart, this.ta.selectionEnd, text); }

  openFind({ replace = false } = {}) {
    const sel = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
    if (sel && !sel.includes('\n')) this.find.query = sel;
    this.find.open = true;
    this.findBar.hidden = false;
    this.findBar.classList.toggle('with-replace', replace || this.findBar.classList.contains('with-replace'));
    this.findInput.value = this.find.query;
    this.findInput.focus();
    this.findInput.select();
    this._runFind(true);
  }

  closeFind() {
    this.find.open = false;
    this.findBar.hidden = true;
    this.find.matches = [];
    this._renderFind();
    this.focus();
  }

  // ---------------- rendering
  _changed() {
    this.hints = [];
    this._render();
    if (this.find.open) this._runFind(false);
    this.onChange(this.ta.value);
    this._maybeComplete();
  }

  _render() {
    const text = this.ta.value;
    const on = this.highlightOn && text.length <= MAX_HIGHLIGHT;
    this.el.classList.toggle('plain', !on);
    if (on) this.hlLayer.innerHTML = `${highlightMarkdown(text)}\n `;
    else this.hlLayer.textContent = '';
    this._lineOffsetCache = null;
    this._renderFind();
    this._syncScroll();
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
    for (const [a, b] of this.hints) marks.push([a, b, 'hint']);
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
    this.onScroll();
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
    const ta = this.ta;
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
      if (!m[5].trim() && s === lineEnd) { this.replace(lineStart, lineEnd, ''); return; } // empty item ends the list
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
        this.replace(s, s, e.key + close, s + 1);
      }
      return;
    }
    if (!mod && [')', ']', '}'].includes(e.key) && s === end && value[s] === e.key) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return; }
    if (e.key === 'Backspace' && s === end && s > 0 && PAIRS[value[s - 1]] === value[s] && value[s]) {
      e.preventDefault();
      this.replace(s - 1, s + 1, '');
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
      strike: () => this._wrap('~~'),
      'toggle-task': () => this._toggleTask(),
      'duplicate-line': () => this._duplicateLine(),
      'move-line-up': () => this._moveLines(-1),
      'move-line-down': () => this._moveLines(1),
    }[cmd];
    return !!run && run() !== false;
  }

  _wrap(open, close = open) {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const sel = value.slice(s, e);
    if (sel.startsWith(open) && sel.endsWith(close) && sel.length >= open.length + close.length) {
      this.replace(s, e, sel.slice(open.length, sel.length - close.length), s, e - open.length - close.length);
    } else if (value.slice(s - open.length, s) === open && value.slice(e, e + close.length) === close) {
      this.replace(s - open.length, e + close.length, sel, s - open.length, e - open.length);
    } else {
      this.replace(s, e, open + sel + close, s + open.length, e + open.length);
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
    this.replace(a, b, out.join('\n'), Math.max(a, s + delta0), Math.max(a, e + total));
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
    this.replace(a, b, text, Math.min(a + text.length, s + (text.length - (b - a))));
  }

  _duplicateLine() {
    const [a, b] = this._lineRange();
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const block = value.slice(a, b);
    this.replace(b, b, `\n${block}`, s + block.length + 1, e + block.length + 1);
  }

  _moveLines(dir) {
    const [a, b] = this._lineRange();
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    const block = value.slice(a, b);
    if (dir < 0) {
      if (a === 0) return;
      const pa = value.lastIndexOf('\n', a - 2) + 1;
      const prev = value.slice(pa, a - 1);
      this.replace(pa, b, `${block}\n${prev}`, s - prev.length - 1, e - prev.length - 1);
    } else {
      if (b >= value.length) return;
      const nb = value.indexOf('\n', b + 1);
      const nextEnd = nb === -1 ? value.length : nb;
      const next = value.slice(b + 1, nextEnd);
      this.replace(a, nextEnd, `${next}\n${block}`, s + next.length + 1, e + next.length + 1);
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
    this.scrollToOffset(i, 0.4);
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
    this.replace(from, to, out, main, main);
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
    this.replace(blockStart, blockEnd, text, move ? cellStart + lead : this.ta.selectionStart, move ? cellEnd : this.ta.selectionStart);
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
      this.replace(s, end, `[${value.slice(s, end)}](${text.trim()})`);
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

  // ---------------- autocomplete ([[links]] and #tags)
  _maybeComplete() {
    const { selectionStart: s, selectionEnd: e, value } = this.ta;
    if (s !== e) return this._closePopup();
    const before = value.slice(Math.max(0, s - 120), s);
    let m;
    let ctx = null;
    if ((m = before.match(/\[\[([^\]\n|#]*)$/))) ctx = { kind: 'link', query: m[1], from: s - m[1].length };
    else if ((m = before.match(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)$/u))) ctx = { kind: 'tag', query: m[1], from: s - m[1].length };
    else ctx = this._stepContext(s, value);
    if (!ctx) return this._closePopup();
    const items = this.complete(ctx.kind, ctx.query).slice(0, 12);
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
    if (kind === 'link' && after !== ']]') text += ']]';
    else if (kind === 'link') { this._closePopup(); this.replace(from, s + 2, `${text}]]`); return; }
    this._closePopup();
    this.replace(from, s, text + (kind === 'tag' ? ' ' : ''));
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
      if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); }
      else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); this._step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && e.target === rep) { e.preventDefault(); (modKey(e) ? this._replaceAll() : this._replaceOne()); }
      else if (['find-next', 'find-prev'].includes(commandOf(e))) { e.preventDefault(); this._step(commandOf(e) === 'find-next' ? 1 : -1); }
    };
    input.addEventListener('keydown', keys);
    rep.addEventListener('keydown', keys);
    this.findInput = input;
    this.findCount = count;
    return bar;
  }

  _pattern() {
    const { query, caseSensitive, regex } = this.find;
    if (!query) return null;
    try {
      return new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
    } catch { return null; }
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
    this.replace(a, b, rep, a + rep.length);
    this._runFind(false);
    if (this.find.matches.length) { this.find.index = Math.min(index, this.find.matches.length - 1); this._reveal(this.find.index, false); this._renderFind(); }
  }

  _replaceAll() {
    const re = this._pattern();
    if (!re || !this.find.matches.length) return;
    const count = this.find.matches.length;
    const next = this.ta.value.replace(re, (m) => this._replacement(m));
    this.replace(0, this.ta.value.length, next, 0);
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
