// Emacs keys in the editor (Settings → "Emacs keys in the editor", off until
// turned on): moving by ⌃ and ⌥ keys, the mark and the region, killing and
// yanking with a kill ring, ⌃U and M-digits, the ⌃X keys, registers, and
// the commands that tidy text (case, fill, transpose, join). ESC then a key
// is that key with ⌥ (M-), for layouts where ⌥ makes accents.
//
// The text work is plain functions, tested without a page
// (test/emacs.test.mjs). EmacsKeys works on one editor (editor.js); the
// app's own commands (save, buffers, macros, occur) come in through
// emacs.hooks (app.js). Query replace and occur work with or without the
// setting (⌥X s q, ⌥X s o).

import { moveCaret, WORD } from './caret.js';
import { diff } from './undo.js';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || '');

// ---------------------------------------------------------------- text

const lineStartOf = (v, p) => v.lastIndexOf('\n', p - 1) + 1;
const lineEndOf = (v, p) => { const n = v.indexOf('\n', p); return n < 0 ? v.length : n; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// n characters on (back, n < 0), a surrogate pair being one.
export function charsFrom(v, pos, n) {
  let p = pos;
  for (let i = 0; i < Math.abs(n); i++) p = moveCaret(v, p, n > 0 ? 'right' : 'left').pos;
  return p;
}

// The end of the nth word on (its start, n < 0).
export function wordEdge(v, pos, n) {
  let p = pos;
  for (let i = 0; i < Math.abs(n); i++) p = moveCaret(v, p, n > 0 ? 'wordRight' : 'wordLeft').pos;
  return p;
}

// ⌃K: from pos to the line's end, or through the line break when only blanks
// are left. With a count: through n line breaks; 0 (or less): back to the
// line's start (and -n lines before it).
export function killLineRange(v, pos, n = null) {
  if (n == null) {
    const e = lineEndOf(v, pos);
    return [pos, e < v.length && /^[ \t]*$/.test(v.slice(pos, e)) ? e + 1 : e];
  }
  if (n > 0) {
    let e = pos;
    for (let i = 0; i < n && e < v.length; i++) e = lineEndOf(v, e) + 1;
    return [pos, Math.min(e, v.length)];
  }
  let s = lineStartOf(v, pos);
  for (let i = 0; i < -n && s > 0; i++) s = lineStartOf(v, s - 1);
  return [s, pos];
}

// M-u, M-l, M-c: up, down, or Capitalized words.
export function recase(text, how) {
  if (how === 'up') return text.toUpperCase();
  if (how === 'down') return text.toLowerCase();
  return text.replace(/[\p{L}\p{N}_]+/gu, (w) => { const [first, ...rest] = w; return first.toUpperCase() + rest.join('').toLowerCase(); });
}

// An edit, as { from, to, text, caret }, or null when there is nothing to do.
const edit = (from, to, text, caret = from + text.length) => ({ from, to, text, caret });
const charLen = (v, p) => (/[\uD800-\uDBFF]/.test(v[p] || '') && /[\uDC00-\uDFFF]/.test(v[p + 1] || '') ? 2 : 1);

// ⌃T: the characters on both sides of the caret change places, and the caret
// moves on; at the end of a line, the two before it.
export function transposeChars(v, pos) {
  let p = pos;
  if (p >= v.length || v[p] === '\n') p = charsFrom(v, p, -1);
  if (p <= 0 || p >= v.length) return null;
  const a = charsFrom(v, p, -1);
  const b = p + charLen(v, p);
  return edit(a, b, v.slice(p, b) + v.slice(a, p), pos === p ? b : pos);
}

// M-t: the word before the caret and the one after change places; in a
// word, it and the next. The caret ends after both.
export function transposeWords(v, pos) {
  let p = pos;
  if (WORD.test(v[p - 1] || '') && WORD.test(v[p] || '')) p = wordEdge(v, p, 1);
  const end2 = wordEdge(v, p, 1);
  const start2 = wordEdge(v, end2, -1);
  const start1 = wordEdge(v, Math.min(start2, p), -1);
  const end1 = wordEdge(v, start1, 1);
  if (start2 < p && !WORD.test(v[p] || '')) return null; // no word after
  if (end1 > start2 || start1 === start2 || !WORD.test(v[start2] || '')) return null;
  const text = v.slice(start2, end2) + v.slice(end1, start2) + v.slice(start1, end1);
  return edit(start1, end2, text);
}

// ⌃X ⌃T: this line and the one before change places; the caret goes to the
// start of the next line.
export function transposeLines(v, pos) {
  const ls = lineStartOf(v, pos);
  if (ls === 0) return null;
  const ps = lineStartOf(v, ls - 1);
  const le = lineEndOf(v, pos);
  const text = `${v.slice(ls, le)}\n${v.slice(ps, ls - 1)}`;
  return edit(ps, le, text, Math.min(v.length, ps + text.length + 1));
}

// M-^: this line joined to the one before, with one space between (none
// before a closing bracket, after an opening one, or with an empty line).
// A quote's ">" goes too.
export function joinLine(v, pos) {
  const ls = lineStartOf(v, pos);
  if (ls === 0) return null;
  const prev = v.slice(lineStartOf(v, ls - 1), ls - 1);
  const quoted = /^\s*>/.test(prev);
  const lead = (quoted ? /^[ \t]*(?:>[ \t]?)*[ \t]*/ : /^[ \t]*/).exec(v.slice(ls, lineEndOf(v, ls)))[0];
  const rest = v.slice(ls + lead.length, lineEndOf(v, ls));
  const tail = /[ \t]*$/.exec(prev)[0].length;
  const space = !rest || !prev.trim() || /^[)\]}.,;:!?]/.test(rest) || /[([{]$/.test(prev.trimEnd()) ? '' : ' ';
  const from = ls - 1 - tail;
  return edit(from, ls + lead.length, space, from);
}

// M-SPC (n spaces, 0: none) and M-\ (none): the spaces and tabs around the caret.
export function spaceAround(v, pos, n = 1) {
  let a = pos;
  let b = pos;
  while (a > 0 && /[ \t]/.test(v[a - 1])) a--;
  while (b < v.length && /[ \t]/.test(v[b])) b++;
  const text = ' '.repeat(Math.max(0, n));
  if (v.slice(a, b) === text) return null;
  return edit(a, b, text);
}

// ⌃X ⌃O: on a line with text, the blank lines after it go; on a blank line
// among others, all but one; on a lone blank line, that line.
export function deleteBlankLines(v, pos) {
  const lines = v.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) { starts.push(o); o += l.length + 1; }
  let i = 0;
  while (i + 1 < lines.length && starts[i + 1] <= pos) i++;
  const blank = (k) => k >= 0 && k < lines.length && /^[ \t]*$/.test(lines[k]);
  const end = (k) => starts[k] + lines[k].length;
  if (!blank(i)) {
    let j = i + 1;
    while (blank(j)) j++;
    if (j === i + 1) return null;
    return edit(end(i), end(j - 1), '', pos);
  }
  let a = i;
  let b = i;
  while (blank(a - 1)) a--;
  while (blank(b + 1)) b++;
  if (a === b) {
    if (lines.length === 1) return lines[0] ? edit(0, lines[0].length, '') : null;
    return i + 1 < lines.length ? edit(starts[i], starts[i + 1], '') : edit(starts[i] - 1, end(i), '');
  }
  return edit(starts[a], end(b), '');
}

// M-z: through the nth `ch` on (back, n < 0) → [from, to], or null.
export function zapRange(v, pos, ch, n = 1) {
  if (!ch) return null;
  let p = pos;
  for (let i = 0; i < Math.abs(n); i++) {
    const at = n > 0 ? v.indexOf(ch, p) : v.lastIndexOf(ch, p - 1);
    if (at < 0) return null;
    p = n > 0 ? at + ch.length : at;
  }
  return n > 0 ? [pos, p] : [p, pos];
}

// M-} and M-{: to the blank line after this paragraph (before it).
export function paragraphEdge(v, pos, dir) {
  const lines = v.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) { starts.push(o); o += l.length + 1; }
  let i = 0;
  while (i + 1 < lines.length && starts[i + 1] <= pos) i++;
  const blank = (k) => /^[ \t]*$/.test(lines[k]);
  let j = i;
  if (dir > 0) {
    while (j < lines.length && blank(j)) j++;
    while (j < lines.length && !blank(j)) j++;
    return j < lines.length ? starts[j] : v.length;
  }
  if (pos === starts[i] && !blank(i)) j = i - 1;
  while (j >= 0 && blank(j)) j--;
  while (j >= 0 && !blank(j)) j--;
  return j >= 0 ? starts[j] : 0;
}

// How wide text is on the screen, in columns: Korean, Chinese, Japanese and
// emoji take two.
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
export function displayWidth(s) {
  let w = 0;
  for (const c of s) w += WIDE.test(c) ? 2 : 1;
  return w;
}

// The lines a paragraph to fill may hold: not blank, not a heading, a
// table row, a rule, a fence or a line of HTML, and outside code blocks.
const FENCE = /^\s*(`{3,}|~{3,})/;
const ITEM = /^([ \t]*(?:>[ \t]?)*[ \t]*)((?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/;
const QUOTE = /^[ \t]*(?:>[ \t]?)*/;
function fillable(line) {
  const t = line.replace(QUOTE, '');
  return !!t.trim() && !/^\s*(#{1,6}\s|\||<|(?:[-*_]\s*){3,}$)/.test(t) && !FENCE.test(t);
}
const hardBreak = (line) => / {2,}$|\\$/.test(line);

// M-q: the paragraph at the caret, its words wrapped to `width` columns —
// keeping a list item's marker (the lines after it under its text) and a
// quote's ">". width Infinity: one line (unfill). → an edit with the caret
// kept by the same word, or null (not in a paragraph; already so).
export function fillParagraph(v, pos, width = 70) {
  const lines = v.split('\n');
  const starts = [];
  let o = 0;
  for (const l of lines) { starts.push(o); o += l.length + 1; }
  let i = 0;
  while (i + 1 < lines.length && starts[i + 1] <= pos) i++;
  let inCode = false;
  for (let k = 0; k < i; k++) if (FENCE.test(lines[k].replace(QUOTE, ''))) inCode = !inCode;
  if (inCode || !fillable(lines[i])) return null;
  const quoteOf = (k) => QUOTE.exec(lines[k])[0].replace(/[ \t]/g, '');
  const item = (k) => ITEM.test(lines[k]);
  let a = i;
  while (a > 0 && !item(a) && fillable(lines[a - 1]) && !hardBreak(lines[a - 1]) && quoteOf(a - 1) === quoteOf(a)) a--;
  let b = i;
  while (b + 1 < lines.length && !hardBreak(lines[b]) && fillable(lines[b + 1]) && !item(b + 1) && quoteOf(b + 1) === quoteOf(a)) b++;
  // The prefixes: the first line's, and the one the lines after it take.
  const m = ITEM.exec(lines[a]);
  const first = m ? m[1] + m[2] : /^[ \t]*(?:>[ \t]?)*[ \t]*/.exec(lines[a])[0];
  const quote = QUOTE.exec(lines[a])[0];
  const next = m ? quote + ' '.repeat(displayWidth(first) - displayWidth(quote)) : first;
  // The words, each with where it was.
  const words = [];
  for (let k = a; k <= b; k++) {
    const lead = k === a ? first.length : /^[ \t]*(?:>[ \t]?)*[ \t]*/.exec(lines[k])[0].length;
    for (const w of lines[k].slice(lead).matchAll(/\S+/g)) words.push({ text: w[0], at: starts[k] + lead + w.index });
  }
  if (!words.length) return null;
  let out = first;
  let col = displayWidth(first);
  const placed = [];
  words.forEach((w, n) => {
    const ww = displayWidth(w.text);
    if (n > 0) {
      if (col + 1 + ww > width && col > displayWidth(next)) { out += `\n${next}`; col = displayWidth(next); }
      else { out += ' '; col += 1; }
    }
    placed.push(out.length);
    out += w.text;
    col += ww;
  });
  const from = starts[a];
  const to = starts[b] + lines[b].length;
  if (out === v.slice(from, to)) return null;
  // The caret: by the same word, as far into it; between words, after one.
  let caret = from + out.length;
  for (let n = words.length - 1; n >= 0; n--) {
    if (pos >= words[n].at) { caret = from + placed[n] + Math.min(pos - words[n].at, words[n].text.length); break; }
    if (n === 0) caret = from + placed[0];
  }
  return edit(from, to, out, caret);
}

// Sort the lines of `text` (reversed: the other way round).
export function sortLines(text, reverse = false) {
  const lines = text.split('\n');
  lines.sort((x, y) => x.localeCompare(y));
  if (reverse) lines.reverse();
  return lines.join('\n');
}

// Spaces and tabs at the ends of lines, gone — but a Markdown line break
// (two spaces after text) stays one. → { text, count }.
export function trimTrailing(text) {
  let count = 0;
  const out = text.replace(/[ \t]+$/gm, (ws, at, all) => {
    const keep = /^ {2,}$/.test(ws) && at > 0 && all[at - 1] !== '\n' ? '  ' : '';
    if (keep !== ws) count++;
    return keep;
  });
  return { text: out, count };
}

// occur: the lines that match `re` (a global RegExp), with where.
// → [{ line (1-based), text, ranges: [[from, to]] }].
export function occurLines(text, re, max = 2000) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const ranges = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(lines[i]))) {
      if (m[0] === '') { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
    if (ranges.length) out.push({ line: i + 1, text: lines[i], ranges });
  }
  return out;
}

// What occur looks for: a regular expression (a broken one: the text as it
// is), case-sensitive only when there is a capital in it (as Emacs).
export function occurPattern(q) {
  const flags = /\p{Lu}/u.test(q) ? 'gu' : 'giu';
  try { return new RegExp(q, flags); } catch { return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
}

// M-/: the word started before the caret, and the words in the text that
// complete it, the nearest first (before the caret, then after).
export function expansions(v, pos) {
  let s = pos;
  while (s > 0 && WORD.test(v[s - 1])) s--;
  const prefix = v.slice(s, pos);
  if (!prefix) return { start: s, prefix, list: [] };
  const found = [];
  for (const m of v.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (m.index === s || m[0] === prefix || !m[0].startsWith(prefix)) continue;
    found.push({ w: m[0], d: m.index < s ? s - m.index : 1e9 + m.index });
  }
  found.sort((x, y) => x.d - y.d);
  return { start: s, prefix, list: [...new Set(found.map((f) => f.w))] };
}

// ---------------------------------------------------------------- kill ring

// What was killed and copied, newest first: ⌃Y takes the newest, M-y the
// ones before. Copies made with ⌘C/⌘X (the copy history) are in it too.
export class KillRing {
  constructor(max = 60) { this.items = []; this.max = max; this.at = 0; }

  // how: 'append' or 'prepend' to the newest (kills one after another).
  push(text, how = null) {
    if (!text) return;
    if (how && this.items.length) this.items[0] = how === 'prepend' ? text + this.items[0] : this.items[0] + text;
    else {
      const i = this.items.indexOf(text);
      if (i >= 0) this.items.splice(i, 1);
      this.items.unshift(text);
      if (this.items.length > this.max) this.items.pop();
    }
    this.at = 0;
  }

  current(n = 0) { return this.items.length ? this.items[(((this.at + n) % this.items.length) + this.items.length) % this.items.length] : null; }

  rotate(n = 1) {
    if (!this.items.length) return null;
    this.at = (((this.at + n) % this.items.length) + this.items.length) % this.items.length;
    return this.items[this.at];
  }
}

// ---------------------------------------------------------------- keys

// event → Emacs's name for it: "C-a", "M-f", "C-M-%", "C-x" … (null: ⌘,
// a lone modifier). Keys go by their place on the keyboard (Korean input
// too); a plain character by itself.
const SHIFTED = { Digit1: '!', Digit2: '@', Digit3: '#', Digit4: '$', Digit5: '%', Digit6: '^', Digit7: '&', Digit8: '*', Digit9: '(', Digit0: ')', Minus: '_', Equal: '+', BracketLeft: '{', BracketRight: '}', Backslash: '|', Semicolon: ':', Quote: '"', Comma: '<', Period: '>', Slash: '?', Backquote: '~' };
const PLAIN = { Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', Space: 'SPC', Backspace: 'DEL', Enter: 'RET', NumpadEnter: 'RET', Tab: 'TAB', Escape: 'ESC', Delete: 'deletechar' };
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn', 'OS', 'AltGraph']);
export function keyName(e, mac = isMac) {
  if (e.metaKey || MODIFIERS.has(e.key)) return null;
  const c = e.code || '';
  let base;
  if (!e.ctrlKey && !e.altKey && e.key?.length === 1 && /^[\x21-\x7e]$/.test(e.key)) base = e.key;
  else if (/^Key[A-Z]$/.test(c)) base = e.shiftKey ? c[3] : c[3].toLowerCase();
  else if (/^Digit\d$/.test(c)) base = e.shiftKey ? SHIFTED[c] : c[5];
  else if (e.shiftKey && SHIFTED[c]) base = SHIFTED[c];
  else if (PLAIN[c]) base = PLAIN[c];
  else if (!c && e.key?.length === 1) base = e.key === ' ' ? 'SPC' : e.key;
  else if (!c && { Enter: 'RET', Escape: 'ESC', Backspace: 'DEL', Tab: 'TAB' }[e.key]) base = { Enter: 'RET', Escape: 'ESC', Backspace: 'DEL', Tab: 'TAB' }[e.key];
  else base = e.key;
  if (!base) return null;
  // Ctrl+Alt is AltGr off a Mac: a character, not a key for Emacs.
  if (!mac && e.ctrlKey && e.altKey) return null;
  return `${e.ctrlKey ? 'C-' : ''}${e.altKey ? 'M-' : ''}${base}`;
}

// key → command. Off a Mac, Ctrl+V stays paste (and Ctrl+C copy, Ctrl+Z undo).
const KEYS = {
  'C-f': 'forward-char', 'C-b': 'backward-char', 'C-n': 'next-line', 'C-p': 'previous-line',
  'C-a': 'beginning-of-line', 'C-e': 'end-of-line', 'M-f': 'forward-word', 'M-b': 'backward-word',
  'M-<': 'beginning-of-buffer', 'M->': 'end-of-buffer', 'C-v': 'scroll-up', 'M-v': 'scroll-down',
  'M-{': 'backward-paragraph', 'M-}': 'forward-paragraph', 'M-m': 'back-to-indentation', 'C-l': 'recenter',
  'C-SPC': 'set-mark', 'C-@': 'set-mark', 'C-g': 'keyboard-quit', 'M-h': 'mark-paragraph',
  'C-k': 'kill-line', 'C-w': 'kill-region', 'M-w': 'copy-region', 'M-d': 'kill-word', 'M-DEL': 'backward-kill-word',
  'C-y': 'yank', 'M-y': 'yank-pop', 'C-d': 'delete-char', 'M-z': 'zap-to-char',
  'C-s': 'isearch-forward', 'C-r': 'isearch-backward', 'M-%': 'query-replace', 'C-M-%': 'query-replace-regexp',
  'M-u': 'upcase-word', 'M-l': 'downcase-word', 'M-c': 'capitalize-word', 'M-q': 'fill-paragraph',
  'C-t': 'transpose-chars', 'M-t': 'transpose-words', 'M-^': 'join-line', 'M-SPC': 'just-one-space', 'M-\\': 'delete-horizontal-space',
  'C-o': 'open-line', 'C-/': 'undo', 'C-_': 'undo', 'C-?': 'redo', 'C-M-_': 'redo', 'M-/': 'dabbrev-expand',
  'C-x': 'ctl-x', 'M-g': 'goto-map', 'M-s': 'search-map', 'C-u': 'universal-argument', 'M--': 'negative-argument', ESC: 'meta-prefix',
  ...Object.fromEntries([...'0123456789'].map((d) => [`M-${d}`, 'digit-argument'])),
};
const MAPS = {
  'C-x': {
    'C-s': 'save-buffer', 'C-f': 'find-file', b: 'switch-to-buffer', 'C-b': 'list-buffers', k: 'kill-buffer',
    o: 'other-window', 2: 'split-window', 3: 'split-window', d: 'dired', u: 'undo', 'C-u': 'upcase-region', 'C-l': 'downcase-region',
    'C-t': 'transpose-lines', 'C-o': 'delete-blank-lines', h: 'mark-whole-buffer', 'C-x': 'exchange-point-and-mark',
    z: 'repeat', '(': 'kmacro-start', ')': 'kmacro-end', e: 'kmacro-play', 'C-SPC': 'pop-global-mark', 'C-@': 'pop-global-mark',
    f: 'set-fill-column', r: 'ctl-x-r', n: 'narrow-map',
  },
  'C-x r': { SPC: 'point-to-register', 'C-SPC': 'point-to-register', 'C-@': 'point-to-register', j: 'jump-to-register', s: 'copy-to-register', x: 'copy-to-register', i: 'insert-register', g: 'insert-register' },
  'C-x n': { n: 'narrow', w: 'widen' },
  'M-g': { g: 'goto-line', 'M-g': 'goto-line', n: 'next-error', 'M-n': 'next-error', p: 'previous-error', 'M-p': 'previous-error' },
  'M-s': { o: 'occur' },
};
export const PREFIXES = { 'ctl-x': 'C-x', 'ctl-x-r': 'C-x r', 'narrow-map': 'C-x n', 'goto-map': 'M-g', 'search-map': 'M-s' };
const PREFIX_LABELS = { 'C-x r': 'registers', 'C-x n': 'narrow', 'M-g': 'go to', 'M-s': 'search' };
// A prefix typed and this long without the next key: the keys that can
// follow, shown (as which-key does); ? or C-h shows them at once.
export const PREFIX_HELP_DELAY = 800;
// Plain keys, while the mark is active: they move the point, as these.
const ARROWS = { ArrowLeft: 'backward-char', ArrowRight: 'forward-char', ArrowUp: 'previous-line', ArrowDown: 'next-line', Home: 'beginning-of-line', End: 'end-of-line', PageDown: 'scroll-up', PageUp: 'scroll-down' };

const KILLS = new Set(['kill-line', 'kill-word', 'backward-kill-word', 'kill-region', 'zap-to-char']);
const VERTICAL = new Set(['next-line', 'previous-line']);
// Commands that take no part in "the last command" (a run of kills, yank then M-y).
const ARGS = new Set(['universal-argument', 'digit-argument', 'negative-argument', 'meta-prefix', ...Object.keys(PREFIXES)]);

// What each command does, in a line (describe a key, the guide).
export const COMMAND_DOCS = {
  'forward-char': 'Forward a character', 'backward-char': 'Back a character', 'next-line': 'Down a line (as it is on the screen)', 'previous-line': 'Up a line (as it is on the screen)',
  'beginning-of-line': 'To the start of the line', 'end-of-line': 'To the end of the line', 'forward-word': 'Forward a word', 'backward-word': 'Back a word',
  'beginning-of-buffer': 'To the start of the note (the mark stays where you were)', 'end-of-buffer': 'To the end of the note (the mark stays where you were)',
  'scroll-up': 'Down a screen', 'scroll-down': 'Up a screen', 'forward-paragraph': 'To the end of the paragraph', 'backward-paragraph': 'To the start of the paragraph',
  'back-to-indentation': 'To the first character of the line', recenter: 'The line with the caret to the middle, top, bottom of the view',
  'set-mark': 'Set the mark: moves now select from it (again: off; ⌃U first: back to the mark before)', 'keyboard-quit': 'Quit: the mark, a prefix, a search', 'mark-paragraph': 'Select the paragraph',
  'kill-line': 'Kill to the end of the line (a run of kills is one piece to yank)', 'kill-region': 'Kill the region (cut)', 'copy-region': 'Copy the region', 'kill-word': 'Kill the word after the caret', 'backward-kill-word': 'Kill the word before the caret',
  yank: 'Yank: put back what was killed or copied last', 'yank-pop': 'Right after a yank: the piece before it instead; else pick from the copy history', 'delete-char': 'Delete the character after the caret', 'zap-to-char': 'Kill through the next given character',
  'isearch-forward': 'Search forward as you type (again: the next match; Enter stays there, ⌃G goes back)', 'isearch-backward': 'Search back as you type',
  'query-replace': 'Replace match by match: y replace, n skip, ! all the rest, . this and stop, ^ back, q stop', 'query-replace-regexp': 'Query replace with a regular expression',
  'upcase-word': 'Uppercase the word (or the region)', 'downcase-word': 'Lowercase the word (or the region)', 'capitalize-word': 'Capitalize the word (or the region)',
  'fill-paragraph': 'Wrap the paragraph to the fill column, keeping list and quote marks (⌃U first: one line)',
  'transpose-chars': 'Swap the characters around the caret', 'transpose-words': 'Swap the words around the caret', 'transpose-lines': 'Swap this line and the one before',
  'join-line': 'Join this line to the one before', 'just-one-space': 'One space around the caret', 'delete-horizontal-space': 'No spaces around the caret',
  'open-line': 'A line break after the caret', 'delete-blank-lines': 'Delete the blank lines around', undo: 'Undo', redo: 'Redo', 'dabbrev-expand': 'Complete the word from words in the note (again: the next)',
  'universal-argument': 'Prefix: 4 times (again: 16), or type a number', 'digit-argument': 'Prefix: a number', 'negative-argument': 'Prefix: backwards',
  'meta-prefix': 'The next key with ⌥ (M-)', 'ctl-x': 'Prefix for ⌃X keys',
  'save-buffer': 'Save', 'find-file': 'Open a note', 'switch-to-buffer': 'Switch note (buffers)', 'list-buffers': 'Switch note (buffers)', 'kill-buffer': 'Close the tab',
  'other-window': 'The other pane', 'split-window': 'Split to the side', dired: 'Dired: this folder as text', 'upcase-region': 'Uppercase the region', 'downcase-region': 'Lowercase the region',
  'mark-whole-buffer': 'Select the whole note', 'exchange-point-and-mark': 'Swap the caret and the mark', repeat: 'Repeat the last command (z again: once more)',
  'kmacro-start': 'Start recording a keyboard macro', 'kmacro-end': 'Stop recording', 'kmacro-play': 'Play the macro (e again: once more)', 'pop-global-mark': 'Back to where you were',
  'set-fill-column': 'Set the fill column (to the caret’s column, or the number)', 'point-to-register': 'Keep this place in a register (a letter)', 'jump-to-register': 'Go to the place in a register',
  'copy-to-register': 'Copy the region into a register', 'insert-register': 'Insert the text in a register', narrow: 'Narrow to this section or the selected lines', widen: 'Widen: the whole note',
  'goto-line': 'Go to line', 'next-error': 'The next occur (or search) result', 'previous-error': 'The occur (or search) result before', occur: 'Lines that match, as a buffer',
  'capitalize-region': 'Capitalize the words in the region', 'unfill-paragraph': 'Join the paragraph’s lines into one', 'sort-lines': 'Sort the lines of the region (⌃U first: reversed)',
  'delete-trailing-whitespace': 'Delete spaces at the ends of lines (the region’s, else the note’s)',
};

// Emacs's own names, where ours are shorter: M-x and describe-key show these.
const NAMES = {
  'set-mark': 'set-mark-command', 'copy-region': 'kill-ring-save', narrow: 'narrow-to-region', 'split-window': 'split-window-right',
  'kmacro-start': 'kmacro-start-macro', 'kmacro-end': 'kmacro-end-macro', 'kmacro-play': 'kmacro-end-and-call-macro', redo: 'undo-redo',
};
export const emacsName = (cmd) => NAMES[cmd] || cmd;

// The keys a command is on ("C-x C-s"), the fewest keys first.
export function keysOf(cmd) {
  const out = [];
  const walk = (map, path) => {
    for (const [k, c] of Object.entries(map)) {
      if (c === cmd) out.push([...path, k].join(' '));
      else if (PREFIXES[c] && MAPS[PREFIXES[c]]) walk(MAPS[PREFIXES[c]], [...path, k]);
    }
  };
  walk(KEYS, []);
  return out.sort((a, b) => a.split(' ').length - b.split(' ').length);
}

// The commands M-x lists by their Emacs names: { cmd, name, keys, doc }.
// Prefixes, arguments and C-g are keys only.
export function emacsCommands() {
  return Object.keys(COMMAND_DOCS).filter((cmd) => !ARGS.has(cmd) && cmd !== 'keyboard-quit' && cmd !== 'ctl-x')
    .map((cmd) => ({ cmd, name: emacsName(cmd), keys: keysOf(cmd)[0] || '', doc: COMMAND_DOCS[cmd] }));
}

// The command a key (or a key after a prefix: "C-x C-s") is on, or null.
export function commandOf(keys) {
  const parts = keys.split(' ');
  let map = KEYS;
  for (let i = 0; i < parts.length; i++) {
    const cmd = map[parts[i]];
    if (!cmd) return null;
    if (i === parts.length - 1) return cmd;
    map = MAPS[PREFIXES[cmd]];
    if (!map) return null;
  }
  return null;
}

// The keys after a prefix ("C-x"), as the help shows them: [{ keys, cmd,
// doc }] — the keys of one command together; a prefix's doc is "+its name".
// (In key order: the maps' own order puts digits first.)
export function prefixKeys(map) {
  const out = [];
  for (const [k, cmd] of Object.entries(MAPS[map] || {})) {
    const had = out.find((x) => x.cmd === cmd);
    if (had) { had.keys.push(k); continue; }
    const sub = PREFIXES[cmd];
    out.push({ keys: [k], cmd, doc: sub ? `+${PREFIX_LABELS[sub] || sub}` : COMMAND_DOCS[cmd] || emacsName(cmd) });
  }
  // By their letter (a plain key before its C- one), prefixes last.
  const rank = (x) => [x.doc.startsWith('+') ? 1 : 0, x.keys[0].replace(/^C-/, '').toLowerCase(), x.keys[0].startsWith('C-') ? 1 : 0];
  return out.sort((a, b) => { const [p, q] = [rank(a), rank(b)]; return p[0] - q[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0) || p[2] - q[2]; });
}

// Shared by every editor: the setting, the kill ring, registers, the
// fill column, and the app's commands (hooks).
export const emacs = {
  on: false,
  fillColumn: 70,
  ring: new KillRing(),
  registers: new Map(), // name → { text } or { path, offset }
  hooks: {},
};
const echo = (text, sticky = false) => emacs.hooks.echo?.(text, sticky);
const writeClipboard = (text) => { try { navigator.clipboard?.writeText(text).catch(() => {}); } catch { /* not allowed here */ } };

// The keys on one editor: its mark, mark ring, prefix and last command.
// Places kept are in the whole note (the part in view moves when narrowed).
export class EmacsKeys {
  constructor(ed) {
    this.ed = ed;
    this.mark = null;
    this.active = false; // the region shows (transient mark)
    this.marks = []; // the mark ring, newest first
    this.arg = null; // ⌃U, M-digits: { n, u, digits, neg, open }
    this.pending = null; // a prefix waiting for its key: { map, keys } or { read, prompt, run } or { meta }
    this.transient = null; // after ⌃X z, ⌃X e: the last key alone again
    this.last = null; // the last command
    this.lastArg = null;
    this.goal = null; // the x up and down keep to
    this.yanked = null;
    this.failed = null; // a command that could not go on (stops a macro)
    this.editing = false;
    this.sticky = false;
    this.recentered = 0;
    this.helping = null; // the prefix whose keys show (which-key)
    this.helpTimer = null;
    this.helpOn = false; // they showed for the prefix before: at once for the next
  }

  get ta() { return this.ed.ta; }
  point() { const ta = this.ta; return ta.selectionDirection === 'backward' ? ta.selectionStart : ta.selectionEnd; }
  markV() { return this.mark == null ? null : clamp(this.mark - this.ed._off, 0, this.ta.value.length); }

  // The region: the selection, else between the mark and the caret. → [a, b] or null.
  // The region when it shows (the mark is active, or text is selected).
  shownRegion() {
    return this.active || this.ta.selectionStart !== this.ta.selectionEnd ? this.region() : null;
  }
  region() {
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) return [ta.selectionStart, ta.selectionEnd];
    const m = this.markV();
    if (m == null) return null;
    const p = this.point();
    return [Math.min(m, p), Math.max(m, p)];
  }

  // The caret to p; with the mark active, the region from the mark to it.
  goto(p) {
    const ta = this.ta;
    p = clamp(p, 0, ta.value.length);
    const m = this.active ? this.markV() : null;
    if (m != null) ta.setSelectionRange(Math.min(m, p), Math.max(m, p), p < m ? 'backward' : 'forward');
    else ta.setSelectionRange(p, p);
    this.ed._keepInView(p);
  }

  pushMark(p, { activate = false, quiet = false } = {}) {
    if (this.mark != null) { this.marks.unshift(this.mark); if (this.marks.length > 16) this.marks.pop(); }
    this.mark = p + this.ed._off;
    this.active = activate;
    if (!quiet) echo('Mark set');
  }

  deactivate() {
    this.active = false;
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) { const p = this.point(); ta.setSelectionRange(p, p); }
  }

  // An edit made by a command: an undo step of its own.
  edit(a, b, text, s = a + text.length, e = s) {
    this.editing = true;
    this.ed._closeStep();
    try { this.ed._edit(a, b, text, s, e); } finally { this.editing = false; }
  }

  apply(x) { if (x) this.edit(x.from, x.to, x.text, x.caret); return !!x; }

  fail(msg) { this.failed = msg; echo(msg); }

  argN(def = 1) {
    const a = this.arg;
    if (!a) return def;
    if (a.digits) return (a.neg ? -1 : 1) * Number(a.digits);
    if (a.neg) return -1;
    return a.n;
  }

  echoArg() {
    const a = this.arg;
    const k = Math.round(Math.log(a.n) / Math.log(4));
    const head = a.u ? Array(Math.max(1, k)).fill('C-u').join(' ') : 'M-';
    this.say(a.digits || a.neg ? `${a.u ? 'C-u ' : 'M-'}${a.neg ? '-' : ''}${a.digits}-` : `${head}-`, true);
  }

  say(text, sticky = false) { this.sticky = sticky; echo(text, sticky); }
  unsay() { if (this.sticky) { this.sticky = false; echo(''); } }

  // Typing, deleting, a click: no longer a run of kills, a yank to change;
  // places kept move with the text.
  changed(old, next, at) {
    if (!this.editing) { this.active = false; this.last = null; this.yanked = null; }
    if (this.mark == null && !this.marks.length) return;
    const c = diff(old, next, at);
    // Text typed right at a mark goes after it (as Emacs's markers).
    const move = (m) => (m > c.at && m >= c.at + c.removed.length ? m + c.inserted.length - c.removed.length : m > c.at ? c.at : m);
    if (this.mark != null) this.mark = move(this.mark);
    this.marks = this.marks.map(move);
  }

  mouse() {
    this.active = false;
    this.last = null;
    this.arg = null;
    this.pending = null;
    this.transient = null;
    this.hideKeys();
    this.unsay();
  }

  // The keys after a prefix: shown after a pause (at once: now), hidden.
  showKeys(map, now = false) {
    this.hideKeys();
    const show = () => {
      this.helpTimer = null;
      if (this.pending?.map !== map) return;
      this.helping = map;
      emacs.hooks.prefixHelp?.(map, prefixKeys(map));
    };
    if (now) show(); else this.helpTimer = setTimeout(show, PREFIX_HELP_DELAY);
  }
  hideKeys() {
    clearTimeout(this.helpTimer);
    this.helpTimer = null;
    if (this.helping) { this.helping = null; emacs.hooks.prefixHelp?.(null); }
  }

  // ---------------------------------------------------------------- keydown
  // → true when the key was one of these (and is done).
  key(e) {
    if (MODIFIERS.has(e.key)) return false;
    this.failed = null;
    this.keyDigit = /^Digit\d$/.test(e.code || '') ? e.code[5] : /^\d$/.test(e.key) ? e.key : '';
    const name = keyName(e);
    if (this.pending) { e.preventDefault(); this.pendingKey(e, name); return true; }
    if (!emacs.on || this.ed.extra.length) return false;
    if (this.transient && name === this.transient.key) { e.preventDefault(); this.run(this.transient.cmd, true); return true; }
    this.transient = null;
    // Digits (and -) after ⌃U or M-digit: the number.
    if (this.arg?.open && !e.ctrlKey && !e.altKey && (/^\d$/.test(name) || (name === '-' && !this.arg.digits && !this.arg.neg))) {
      e.preventDefault();
      if (name === '-') this.arg.neg = true; else this.arg.digits += name;
      this.echoArg();
      return true;
    }
    let cmd = name && KEYS[name];
    if (name === 'C-v' && !isMac) cmd = null;
    if (cmd === 'meta-prefix' && this.ed.find.open) cmd = null;
    if (!cmd && this.active && name in ARROWS) cmd = ARROWS[name];
    if (!cmd) {
      // A character typed after a count: that many of it.
      if (this.arg && name && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const n = this.argN();
        const [a, b] = [this.ta.selectionStart, this.ta.selectionEnd];
        this.arg = null;
        this.unsay();
        if (n > 0) this.edit(a, b, e.key.repeat(Math.min(n, 10_000)));
        return true;
      }
      this.arg = null;
      this.last = null;
      this.unsay();
      return false;
    }
    e.preventDefault();
    this.run(cmd);
    return true;
  }

  pendingKey(e, name) {
    const p = this.pending;
    this.pending = null;
    const shown = !!this.helping;
    this.hideKeys();
    if (name === 'C-g') { this.run('keyboard-quit'); return; }
    // ? or C-h after a prefix: its keys, now (the prefix still waits).
    if (p.map && (name === '?' || name === 'C-h')) { this.pending = p; this.showKeys(p.map, true); return; }
    if (p.read) {
      this.unsay();
      const ch = !e.ctrlKey && !e.altKey && name?.length === 1 ? name : null;
      if (ch) p.run(ch);
      return;
    }
    if (p.meta) {
      if (name === 'ESC') { this.run('keyboard-quit'); return; }
      const meta = name && !name.includes('M-') ? (name.startsWith('C-') ? `C-M-${name.slice(2)}` : `M-${name}`) : name;
      const cmd = KEYS[meta];
      this.unsay();
      if (cmd) this.run(cmd); else this.say(`ESC ${name} is undefined`);
      return;
    }
    const cmd = MAPS[p.map][name] || (name?.length === 1 && MAPS[p.map][name.toLowerCase()]);
    this.unsay();
    if (!cmd) { this.arg = null; this.say(`${p.map} ${name} is undefined`); return; }
    // A prefix in it: its keys at once, when this one's showed.
    this.helpOn = shown;
    try { this.run(cmd); } finally { this.helpOn = false; }
  }

  // Run a command by name (also from the leader menu, app.js).
  command(cmd) { this.failed = null; this.run(cmd); return !this.failed; }

  run(cmd, again = false) {
    const f = this[`_${cmd.replace(/-/g, '_')}`] || (PREFIXES[cmd] && (() => this.prefix(PREFIXES[cmd])));
    if (!f) return;
    const prefixLike = ARGS.has(cmd);
    const a = this.arg;
    const ctx = again && this.lastArg ? this.lastArg : { n: this.argN(), raw: !!(a?.u && !a.digits && !a.neg), has: !!a };
    if (!prefixLike) { this.arg = null; if (this.sticky) this.unsay(); }
    this.cur = cmd;
    if (!VERTICAL.has(cmd)) this.goal = null;
    f.call(this, ctx);
    if (!prefixLike && cmd !== 'repeat') {
      if (cmd !== 'kmacro-play') this.transient = null;
      this.last = cmd;
      this.lastArg = ctx;
    }
  }

  prefix(map) {
    this.pending = { map };
    this.say(`${this.arg ? `${this.argText()} ` : ''}${map}-`, true);
    this.showKeys(map, this.helpOn);
  }
  argText() { const a = this.arg; return a.digits || a.neg ? `C-u ${a.neg ? '-' : ''}${a.digits}` : 'C-u'; }

  read(prompt, run) { this.pending = { read: true, run }; this.say(prompt, true); }

  // ---------------------------------------------------------------- moving
  moveTo(p, msg) {
    const from = this.point();
    if (p === from && msg) this.fail(msg);
    this.ed._closeStep();
    this.goto(p);
  }
  _forward_char({ n }) { this.moveTo(charsFrom(this.ta.value, this.point(), n), n > 0 ? 'End of note' : 'Start of note'); }
  _backward_char({ n }) { this._forward_char({ n: -n }); }
  _forward_word({ n }) { this.moveTo(wordEdge(this.ta.value, this.point(), n), n > 0 ? 'End of note' : 'Start of note'); }
  _backward_word({ n }) { this._forward_word({ n: -n }); }
  _next_line({ n }) {
    const p = this.point();
    const r = this.ed._screenLine(p, n, VERTICAL.has(this.last) ? this.goal : null);
    this.goal = r.x;
    this.moveTo(r.pos, n > 0 ? 'End of note' : 'Start of note');
  }
  _previous_line({ n }) { this._next_line({ n: -n }); }
  _beginning_of_line({ n, has }) {
    const v = this.ta.value;
    let p = this.point();
    if (has && n !== 1) p = moveCaret(v, p, n > 1 ? 'pageDown' : 'pageUp', { page: Math.abs(n - 1) }).pos;
    this.moveTo(lineStartOf(v, p));
  }
  _end_of_line({ n, has }) {
    const v = this.ta.value;
    let p = this.point();
    for (let i = 1; has && i < n; i++) p = Math.min(v.length, lineEndOf(v, p) + 1);
    this.moveTo(lineEndOf(v, p));
  }
  _beginning_of_buffer() { if (!this.active) this.pushMark(this.point()); this.moveTo(0); }
  _end_of_buffer() { if (!this.active) this.pushMark(this.point()); this.moveTo(this.ta.value.length); }
  _forward_paragraph({ n }) {
    let p = this.point();
    for (let i = 0; i < Math.abs(n); i++) p = paragraphEdge(this.ta.value, p, n);
    this.moveTo(p, n > 0 ? 'End of note' : 'Start of note');
  }
  _backward_paragraph({ n }) { this._forward_paragraph({ n: -n }); }
  _back_to_indentation() {
    const v = this.ta.value;
    const s = lineStartOf(v, this.point());
    this.moveTo(s + /^[ \t]*/.exec(v.slice(s))[0].length);
  }
  // A screen on (back), the caret keeping its place on the screen; with a
  // count, that many lines.
  _scroll_up({ n, has }, dir = 1) {
    const ed = this.ed;
    const ta = this.ta;
    const lh = ed.lineHeight();
    const rows = has ? n : Math.max(1, Math.floor(ta.clientHeight / lh) - 2);
    const before = ta.scrollTop;
    ta.scrollTop = before + dir * rows * lh;
    ed._syncScroll();
    const moved = Math.round((ta.scrollTop - before) / lh);
    if (!moved) { this.moveTo(dir > 0 ? ta.value.length : 0, dir > 0 ? 'End of note' : 'Start of note'); return; }
    const r = ed._screenLine(this.point(), moved, null);
    this.goto(r.pos);
  }
  _scroll_down(ctx) { this._scroll_up(ctx, -1); }
  _recenter() {
    this.recentered = this.last === 'recenter' ? (this.recentered + 1) % 3 : 0;
    this.ed.recenter(['middle', 'top', 'bottom'][this.recentered]);
  }

  // ---------------------------------------------------------------- the mark
  _set_mark({ raw }) {
    const p = this.point();
    if (raw) {
      if (this.mark == null) { this.fail('No mark set in this note'); return; }
      const to = this.markV();
      if (this.marks.length) { this.marks.push(this.mark); this.mark = this.marks.shift(); }
      this.active = false;
      this.goto(to);
      return;
    }
    if (this.last === 'set-mark' && this.active && this.markV() === p) { this.deactivate(); this.say('Mark deactivated'); return; }
    this.pushMark(p, { activate: true });
    this.goto(p);
  }
  _exchange_point_and_mark() {
    const m = this.markV();
    if (m == null) { this.fail('No mark set in this note'); return; }
    this.mark = this.point() + this.ed._off;
    this.active = true;
    this.goto(m);
  }
  _mark_whole_buffer() { this.pushMark(this.ta.value.length, { activate: true, quiet: true }); this.goto(0); }
  _mark_paragraph() {
    const v = this.ta.value;
    const p = this.point();
    const b = paragraphEdge(v, p, 1);
    this.pushMark(b, { activate: true, quiet: true });
    this.goto(paragraphEdge(v, Math.min(b, Math.max(p, lineEndOf(v, p))), -1));
  }
  _pop_global_mark() { emacs.hooks.navBack?.(); }
  _keyboard_quit() {
    this.deactivate();
    this.arg = null;
    this.pending = null;
    this.transient = null;
    if (this.ed.find.open) this.ed.closeFind();
    this.ed._clearMulti?.();
    this.say('Quit');
  }

  // ---------------------------------------------------------------- killing
  kill(a, b, dir = 1) {
    if (a === b) return;
    emacs.ring.push(this.ta.value.slice(a, b), KILLS.has(this.last) ? (dir < 0 ? 'prepend' : 'append') : null);
    writeClipboard(emacs.ring.current());
    this.active = false;
    this.edit(a, b, '', a);
  }
  _kill_line({ n, has }) {
    const [a, b] = killLineRange(this.ta.value, this.point(), has ? n : null);
    if (a === b) { this.fail('End of note'); return; }
    this.kill(a, b, has && n <= 0 ? -1 : 1);
  }
  _kill_region() {
    const r = this.region();
    if (!r) { this.fail('The mark is not set now, so there is no region'); return; }
    this.kill(r[0], r[1]);
  }
  _copy_region() {
    const r = this.region();
    if (!r) { this.fail('The mark is not set now, so there is no region'); return; }
    if (r[0] === r[1]) return;
    emacs.ring.push(this.ta.value.slice(r[0], r[1]));
    writeClipboard(emacs.ring.current());
    this.deactivate();
    this.say('Copied');
  }
  _kill_word({ n }) {
    const p = this.point();
    const q = wordEdge(this.ta.value, p, n);
    if (p === q) { this.fail(n > 0 ? 'End of note' : 'Start of note'); return; }
    this.kill(Math.min(p, q), Math.max(p, q), n < 0 ? -1 : 1);
  }
  _backward_kill_word({ n }) { this._kill_word({ n: -n }); }
  _zap_to_char({ n }) {
    this.read('Zap to char: ', (ch) => {
      const r = zapRange(this.ta.value, this.point(), ch, n);
      if (!r) { this.fail(`Search failed: “${ch}”`); return; }
      this.cur = 'zap-to-char';
      this.kill(r[0], r[1], n < 0 ? -1 : 1);
      this.last = 'zap-to-char';
    });
  }
  _delete_char({ n, has }) {
    const ta = this.ta;
    if (ta.selectionStart !== ta.selectionEnd) { this.edit(ta.selectionStart, ta.selectionEnd, ''); this.active = false; return; }
    const p = this.point();
    const q = charsFrom(ta.value, p, n);
    if (p === q) { this.fail(n > 0 ? 'End of note' : 'Start of note'); return; }
    if (has) this.kill(Math.min(p, q), Math.max(p, q), n < 0 ? -1 : 1);
    else this.edit(Math.min(p, q), Math.max(p, q), '');
  }
  _yank({ n, raw, has }) {
    const text = has && !raw ? emacs.ring.current(n - 1) : emacs.ring.current();
    if (text == null) { this.fail(`Nothing killed or copied yet (${isMac ? '⌘V' : 'Ctrl+V'} pastes from other apps)`); return; }
    const ta = this.ta;
    const [a, b] = [ta.selectionStart, ta.selectionEnd];
    this.pushMark(a, { quiet: true });
    this.edit(a, b, text, raw ? a : a + text.length);
    if (raw) this.mark = a + text.length + this.ed._off;
    this.yanked = [a, a + text.length];
  }
  _yank_pop({ n }) {
    if (!['yank', 'yank-pop'].includes(this.last) || !this.yanked) { emacs.hooks.pasteHistory?.(); return; }
    const text = emacs.ring.rotate(n);
    const [a, b] = this.yanked;
    this.edit(a, b, text);
    this.yanked = [a, a + text.length];
  }

  // ---------------------------------------------------------------- searching
  _isearch_forward() { this.ed.isearch(1); }
  _isearch_backward() { this.ed.isearch(-1); }
  _query_replace() { this.ed.queryReplace({ regex: false }); }
  _query_replace_regexp() { this.ed.queryReplace({ regex: true }); }
  _occur() { emacs.hooks.occur?.(); }
  _goto_line({ n, has }) {
    if (has) { this.pushMark(this.point(), { quiet: true }); this.ed.gotoLine(n, { select: false }); } else emacs.hooks.gotoLine?.();
  }
  _next_error({ n }) { emacs.hooks.nextMatch?.(n); }
  _previous_error({ n }) { emacs.hooks.nextMatch?.(-n); }

  // ---------------------------------------------------------------- text
  // The region when it shows, else the word(s) after the caret.
  recaseHere(how, n) {
    const v = this.ta.value;
    const r = this.shownRegion();
    if (r && r[0] !== r[1]) {
      this.edit(r[0], r[1], recase(v.slice(r[0], r[1]), how), r[0], r[1]);
      this.deactivate();
      return;
    }
    const p = this.point();
    const q = wordEdge(v, p, n);
    const [a, b] = [Math.min(p, q), Math.max(p, q)];
    const text = recase(v.slice(a, b), how);
    if (text !== v.slice(a, b)) this.edit(a, b, text, n > 0 ? a + text.length : p);
    else this.goto(n > 0 ? b : p);
  }
  _upcase_word({ n }) { this.recaseHere('up', n); }
  _downcase_word({ n }) { this.recaseHere('down', n); }
  _capitalize_word({ n }) { this.recaseHere('cap', n); }
  recaseRegion(how) {
    const r = this.region();
    if (!r || r[0] === r[1]) { this.fail('No region to change'); return; }
    const p = this.point();
    this.edit(r[0], r[1], recase(this.ta.value.slice(r[0], r[1]), how), p, p);
    this.active = false;
  }
  _upcase_region() { this.recaseRegion('up'); }
  _downcase_region() { this.recaseRegion('down'); }
  _capitalize_region() { this.recaseRegion('cap'); }
  _fill_paragraph({ raw }) {
    const x = fillParagraph(this.ta.value, this.point(), raw ? Infinity : emacs.fillColumn);
    if (!this.apply(x)) this.say(raw ? 'Nothing to unfill here' : 'Nothing to fill here');
  }
  _unfill_paragraph() { this._fill_paragraph({ raw: true }); }
  _set_fill_column({ n, has }) {
    const v = this.ta.value;
    const p = this.point();
    const col = has ? n : displayWidth(v.slice(lineStartOf(v, p), p));
    if (col < 10) { this.fail('The fill column is at least 10'); return; }
    const was = emacs.fillColumn;
    emacs.fillColumn = col;
    emacs.hooks.fillColumn?.(col);
    this.say(`Fill column set to ${col} (was ${was})`);
  }
  repeated(n, f) {
    let any = false;
    for (let i = 0; i < Math.max(1, n); i++) { const x = f(this.ta.value, this.point()); if (!x) break; this.apply(x); any = true; }
    if (!any) this.fail('Nothing to change here');
  }
  _transpose_chars({ n }) { this.repeated(n, transposeChars); }
  _transpose_words({ n }) { this.repeated(n, transposeWords); }
  _transpose_lines({ n }) { this.repeated(n, transposeLines); }
  _join_line({ has }) {
    const v = this.ta.value;
    const p = this.point();
    const at = has ? Math.min(v.length, lineEndOf(v, p) + 1) : p;
    if (has && at === v.length && lineEndOf(v, p) === v.length) { this.fail('No line after this one'); return; }
    if (!this.apply(joinLine(v, at))) this.fail('No line before this one');
  }
  _just_one_space({ n, has }) { this.apply(spaceAround(this.ta.value, this.point(), has ? n : 1)); }
  _delete_horizontal_space() { this.apply(spaceAround(this.ta.value, this.point(), 0)); }
  _open_line({ n }) { const p = this.point(); this.edit(p, p, '\n'.repeat(Math.max(1, n)), p); }
  _delete_blank_lines() { this.apply(deleteBlankLines(this.ta.value, this.point())); }
  _undo({ n }) { this.editing = true; try { for (let i = 0; i < Math.max(1, n); i++) this.ed.undo(); } finally { this.editing = false; } }
  _redo({ n }) { this.editing = true; try { for (let i = 0; i < Math.max(1, n); i++) this.ed.redo(); } finally { this.editing = false; } }
  _dabbrev_expand() {
    const v = this.ta.value;
    const p = this.point();
    let d = this.last === 'dabbrev-expand' && this.dab && this.dab.end === p ? this.dab : null;
    if (!d) {
      const x = expansions(v, p);
      if (!x.list.length) { this.fail(x.prefix ? `No completion for “${x.prefix}” in this note` : 'No word to complete'); return; }
      d = { ...x, i: -1, end: p };
    }
    d.i++;
    const word = d.i < d.list.length ? d.list[d.i] : d.prefix;
    if (d.i >= d.list.length) { this.say('No more completions'); d.i = -1; }
    this.edit(d.start, d.end, word);
    d.end = d.start + word.length;
    this.dab = d;
  }
  _sort_lines({ raw }) {
    const r = this.region();
    if (!r || r[0] === r[1]) { this.fail('Select the lines to sort'); return; }
    const v = this.ta.value;
    const a = lineStartOf(v, r[0]);
    const b = r[1] > a && v[r[1] - 1] === '\n' ? r[1] - 1 : lineEndOf(v, r[1]);
    const text = sortLines(v.slice(a, b), raw);
    this.edit(a, b, text, a, a + text.length);
    this.active = false;
  }
  _delete_trailing_whitespace() {
    const r = this.shownRegion();
    const v = this.ta.value;
    const [a, b] = r && r[0] !== r[1] ? [lineStartOf(v, r[0]), lineEndOf(v, r[1])] : [0, v.length];
    const x = trimTrailing(v.slice(a, b));
    if (!x.count) { this.say('No trailing spaces'); return; }
    const p = this.point();
    this.edit(a, b, x.text, Math.min(p, a + x.text.length));
    this.say(`Trailing spaces gone on ${x.count} line${x.count === 1 ? '' : 's'}`);
  }

  // ---------------------------------------------------------------- ⌃U
  _universal_argument() {
    const a = this.arg;
    if (a?.u && !a.digits && !a.neg) a.n *= 4;
    else if (!a) this.arg = { n: 4, u: true, digits: '', neg: false, open: true };
    this.echoArg();
  }
  _digit_argument() {
    const d = this.keyDigit || '';
    if (!this.arg) this.arg = { n: 1, u: false, digits: '', neg: false, open: true };
    this.arg.digits += d;
    this.echoArg();
  }
  _negative_argument() {
    if (!this.arg) this.arg = { n: 1, u: false, digits: '', neg: false, open: true };
    this.arg.neg = true;
    this.echoArg();
  }
  _meta_prefix() { this.pending = { meta: true }; this.say('ESC-', true); }

  // ---------------------------------------------------------------- the app's
  _save_buffer() { emacs.hooks.save?.(); }
  _find_file() { emacs.hooks.findFile?.(); }
  _switch_to_buffer() { emacs.hooks.buffers?.(); }
  _list_buffers() { emacs.hooks.buffers?.(); }
  _kill_buffer() { emacs.hooks.killBuffer?.(); }
  _other_window() { emacs.hooks.otherWindow?.(); }
  _split_window() { emacs.hooks.split?.(); }
  _dired() { emacs.hooks.dired?.(); }
  _narrow() { emacs.hooks.narrow?.(); }
  _widen() { emacs.hooks.widen?.(); }
  // The last of these commands again (else the app's last command); z again: once more.
  _repeat() {
    const prev = this.last && !this.last.startsWith('kmacro') ? this.last : null;
    if (prev) this.run(prev, true); else emacs.hooks.repeat?.();
    this.transient = { key: 'z', cmd: 'repeat' };
  }
  _kmacro_start() { this.ed._noWatch = true; emacs.hooks.macroStart?.(); }
  _kmacro_end() { emacs.hooks.macroEnd?.(); }
  // The macro's own keys come through key() too: e again only after them.
  async _kmacro_play({ n, has }) {
    this.transient = null;
    await emacs.hooks.macroPlay?.(has ? (n === 0 ? Infinity : Math.max(1, n)) : 1);
    this.transient = { key: 'e', cmd: 'kmacro-play' };
  }

  // ---------------------------------------------------------------- registers
  _point_to_register() {
    const at = this.point() + this.ed._off;
    this.read('Point to register: ', (r) => {
      emacs.registers.set(r, { path: emacs.hooks.where?.(this.ed) ?? null, offset: at });
      this.say(`This place is in register ${r}`);
    });
  }
  _jump_to_register() {
    this.read('Jump to register: ', (r) => {
      const reg = emacs.registers.get(r);
      if (!reg) { this.fail(`Register ${r} is empty`); return; }
      if (reg.text != null) { this.fail(`Register ${r} holds text: ⌃X r i inserts it`); return; }
      const here = emacs.hooks.where?.(this.ed) ?? null;
      if (reg.path === here) { this.pushMark(this.point(), { quiet: true }); this.ed.selectRange(Math.min(reg.offset, this.ed.value.length)); } else emacs.hooks.jump?.(reg.path, reg.offset);
    });
  }
  _copy_to_register({ raw }) {
    const r0 = this.region();
    if (!r0 || r0[0] === r0[1]) { this.fail('Select the text to keep first'); return; }
    const text = this.ta.value.slice(r0[0], r0[1]);
    this.read('Copy to register: ', (r) => {
      emacs.registers.set(r, { text });
      if (raw) this.edit(r0[0], r0[1], '', r0[0]); else this.deactivate();
      this.say(`Copied to register ${r}`);
    });
  }
  _insert_register({ raw }) {
    this.read('Insert register: ', (r) => {
      const reg = emacs.registers.get(r);
      if (!reg) { this.fail(`Register ${r} is empty`); return; }
      if (reg.text == null) { this.fail(`Register ${r} holds a place: ⌃X r j goes there`); return; }
      const ta = this.ta;
      const [a, b] = [ta.selectionStart, ta.selectionEnd];
      // As Emacs: the caret before the text, the mark after (⌃U: the other way).
      this.edit(a, b, reg.text, raw ? a + reg.text.length : a);
      this.mark = (raw ? a : a + reg.text.length) + this.ed._off;
    });
  }
}
