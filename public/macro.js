// Keyboard macros, as in Emacs: F3 starts recording, F4 stops — and then
// plays it back. In a browser, keys sent by a script neither type nor move
// the caret, so a macro keeps what the keys did, and does it again:
//   text typed (Korean too, once composed) and deleted, caret moves (by
//   character, word, line, page, to the ends), finds (⌘F … Esc: "the next
//   match"), the editor's own keys (Enter in a list, Tab, ⌘B, ⌥↑…) and
//   commands (⌥X, the palette, shortcuts like F8).
// Deleting a word or to the line's end is done again from where the caret is
// then, like the key would; other edits keep their size around the caret.
// Mouse clicks are not recorded.

import { editorWatch } from './editor.js';
import { moveCaret } from './caret.js';

export { moveCaret };

// A key the browser itself moves the caret for → the move (or null).
export function caretMove(e, mac) {
  const word = mac ? e.altKey : e.ctrlKey;
  if ((mac ? e.metaKey : e.ctrlKey) && e.code === 'KeyA' && !e.shiftKey && !e.altKey) return 'all';
  if (mac && e.ctrlKey && !e.metaKey && !e.altKey) {
    const emacs = { KeyA: 'lineStart', KeyE: 'lineEnd', KeyF: 'right', KeyB: 'left', KeyN: 'down', KeyP: 'up' }[e.code];
    if (emacs) return emacs;
  }
  switch (e.key) {
    case 'ArrowLeft': return mac && e.metaKey ? 'lineStart' : word ? 'wordLeft' : 'left';
    case 'ArrowRight': return mac && e.metaKey ? 'lineEnd' : word ? 'wordRight' : 'right';
    case 'ArrowUp': return (mac && e.metaKey) || (!mac && e.ctrlKey) ? 'docStart' : 'up';
    case 'ArrowDown': return (mac && e.metaKey) || (!mac && e.ctrlKey) ? 'docEnd' : 'down';
    case 'Home': return !mac && e.ctrlKey ? 'docStart' : 'lineStart';
    case 'End': return !mac && e.ctrlKey ? 'docEnd' : 'lineEnd';
    case 'PageUp': return 'pageUp';
    case 'PageDown': return 'pageDown';
    default: return null;
  }
}
const BACKWARD = new Set(['left', 'wordLeft', 'lineStart', 'docStart', 'up', 'pageUp']);

// Deletions that depend on the text (a word, to the line's start or end).
const DELETE_MOVES = {
  deleteWordBackward: 'wordLeft', deleteWordForward: 'wordRight',
  deleteSoftLineBackward: 'lineStart', deleteHardLineBackward: 'lineStart',
  deleteSoftLineForward: 'lineEnd', deleteHardLineForward: 'lineEnd',
};

export class Stop extends Error {}

const frames = (n = 2) => new Promise((r) => { const f = (k) => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n); });

// editorNow(): the editor to type into now (the active note's), or null.
// onChange(recording): to show it. isAppKey(e): a key the app has taken.
export class Macros {
  constructor({ editorNow, onChange = () => {}, isAppKey = () => false, mac = false }) {
    this.editorNow = editorNow;
    this.onChange = onChange;
    this.isAppKey = isAppKey;
    this.mac = mac;
    this.recording = null; // steps being recorded
    this.last = null; // the last macro: steps
    this.playing = false;
    this.quiet = 0;
    this.snap = null;
    this.warned = false;
    this.listen();
  }

  get canRecord() { return !!this.recording && !this.playing && !this.quiet; }

  start() {
    if (this.playing) return;
    this.recording = [];
    this.warned = false;
    this.onChange(true);
  }

  // → the steps kept (null: nothing was recorded, the last macro stays).
  stop() {
    const steps = this.recording;
    this.recording = null;
    this.onChange(false);
    if (steps?.length) this.last = steps;
    return steps?.length ? steps : null;
  }

  push(step) {
    if (!this.canRecord) return;
    const prev = this.recording.at(-1);
    // Typing comes one character at a time: keep it as one step.
    if (step.t === 'edit' && prev?.t === 'edit' && !step.before && !step.after && !prev.before && !prev.after && prev.text && step.text && !step.sel && !prev.sel) { prev.text += step.text; return; }
    this.recording.push(step);
  }

  // A command that runs by itself (from the ⌥X menu): kept.
  note(label, run) { if (this.canRecord) this.recording.push({ t: 'cmd', label, run }); }

  // A command chosen while recording (the palette, a shortcut): kept as
  // itself. Edits it makes now are its own, not typing.
  command(label, run) {
    if (!this.canRecord) { return run(); }
    this.recording.push({ t: 'cmd', label, run });
    this.quiet++;
    try { return run(); } finally { this.quiet--; }
  }

  listen() {
    const edOf = (t) => t?.closest?.('.ed') && this.editorNow();
    editorWatch.key = (ed, e, cmd) => {
      if (!this.canRecord) return;
      if (e.defaultPrevented) {
        if (['find', 'replace', 'find-next', 'find-prev'].includes(cmd)) return;
        this.push({ t: 'key', key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
        return;
      }
      const how = caretMove(e, this.mac);
      if (how && !this.isAppKey(e)) this.push({ t: 'move', how, extend: e.shiftKey });
    };
    editorWatch.edit = (ed, x) => {
      if (!this.canRecord) return;
      this.push({ t: 'edit', before: Math.max(0, x.selStart - x.start), after: Math.max(0, x.end - x.selEnd), text: x.text, sel: x.selStart !== x.selEnd });
    };
    editorWatch.find = (ed, x) => {
      if (!this.canRecord || !x.query) return;
      const j = x.matches.findIndex(([a, b]) => a === x.sel[0] && b === x.sel[1]);
      if (j < 0) return; // the find didn't move the caret
      let i0 = x.matches.findIndex(([a]) => a >= x.from);
      if (i0 < 0) i0 = 0;
      const k = ((j - i0 + x.matches.length) % x.matches.length) + 1;
      this.push({ t: 'find', spec: { query: x.query, caseSensitive: x.caseSensitive, regex: x.regex }, k, ...(x.collapse ? { collapse: x.collapse } : {}) });
    };
    editorWatch.replaceAll = (ed, spec) => this.push({ t: 'replaceAll', spec });

    // Typing and deleting the browser does itself: what changed around the
    // caret (or, for a word or line, the deletion to do again).
    document.addEventListener('beforeinput', (e) => {
      const ed = edOf(e.target);
      this.snap = null;
      if (!ed || !this.canRecord || ed.handlingKey || ed.busy || e.isComposing || /Composition/.test(e.inputType)) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { this.push({ t: e.inputType === 'historyUndo' ? 'undo' : 'redo' }); return; }
      if (ed.extra?.length) return; // multi-cursor typing isn't recorded
      const ta = ed.ta;
      // Cut, paste and yank go through the macro's own clipboard when played:
      // what this run cut, not what was on the clipboard when recording.
      if (e.inputType === 'deleteByCut') { this.push({ t: 'copy', cut: true }); return; }
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromYank') { this.push({ t: 'paste', text: e.dataTransfer?.getData('text/plain') ?? e.data ?? '' }); return; }
      if (DELETE_MOVES[e.inputType] && ta.selectionStart === ta.selectionEnd) { this.push({ t: 'delete', how: DELETE_MOVES[e.inputType] }); return; }
      this.snap = { ta, value: ta.value, s: ta.selectionStart, e: ta.selectionEnd };
    }, true);
    document.addEventListener('input', (e) => {
      const snap = this.snap;
      this.snap = null;
      if (!snap || snap.ta !== e.target || !this.canRecord) return;
      const a = snap.value;
      const b = snap.ta.value;
      let p = 0;
      while (p < a.length && p < b.length && a[p] === b[p]) p++;
      p = Math.min(p, snap.s);
      let q = 0;
      while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
      q = Math.min(q, a.length - snap.e);
      const end = a.length - q;
      if (p === end && b.length - q === p) return;
      this.push({ t: 'edit', before: Math.max(0, snap.s - p), after: Math.max(0, end - snap.e), text: b.slice(p, b.length - q), sel: snap.s !== snap.e });
    }, true);
    document.addEventListener('copy', (e) => { if (edOf(e.target) && this.canRecord) this.push({ t: 'copy' }); }, true);
    // Korean (and other IMEs): the composed text, once it is done.
    document.addEventListener('compositionend', (e) => {
      if (!edOf(e.target) || !this.canRecord || !e.data) return;
      this.push({ t: 'edit', before: 0, after: 0, text: e.data, sel: false });
    }, true);
    document.addEventListener('mousedown', (e) => {
      if (!this.canRecord || this.warned || !edOf(e.target)) return;
      this.warned = true;
      this.onWarn?.('Clicks aren’t recorded: move with the keys while recording');
    }, true);
  }

  // Play the last macro `times` times (Infinity: until it can't go on, or
  // stops changing anything). → how many times it ran.
  async play(times = 1, steps = this.last) {
    if (!steps?.length || this.playing || this.recording) return 0;
    this.playing = true;
    let n = 0;
    try {
      for (; n < Math.min(times, 10_000); n++) {
        const before = this.state();
        await this.once(steps);
        if (times === Infinity && this.state() === before) { n++; break; }
      }
    } catch (e) {
      if (!(e instanceof Stop)) throw e;
      if (!n || times !== Infinity) { this.onWarn?.(`Macro stopped${n ? ` after ${n}` : ''}: ${e.message}`); }
    } finally { this.playing = false; }
    return n;
  }

  state() {
    const ed = this.editorNow();
    return ed ? `${ed.value.length}:${ed.selectionStart}:${ed.selectionEnd}:${ed.value}` : '';
  }

  async once(steps) {
    let goal = null;
    this.clip = null;
    for (const step of steps) {
      if (step.t === 'cmd') { await step.run(); await frames(); await new Promise((r) => setTimeout(r, 30)); goal = null; continue; }
      const ed = this.editorNow();
      if (!ed) throw new Stop('no note to type into');
      if (document.activeElement !== ed.ta) ed.focus();
      const ta = ed.ta;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const v = ta.value;
      if (step.t !== 'move' || !['up', 'down', 'pageUp', 'pageDown'].includes(step.how)) goal = null;
      if (step.t === 'key') {
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: step.key, code: step.code, shiftKey: step.shiftKey, altKey: step.altKey, metaKey: step.metaKey, ctrlKey: step.ctrlKey, bubbles: true, cancelable: true }));
        // An Emacs key that couldn't go on (the end of the note) ends the run.
        if (ed.emacs?.failed) throw new Stop(ed.emacs.failed);
      } else if (step.t === 'edit') {
        const from = Math.max(0, s - step.before);
        const to = Math.min(v.length, e + step.after);
        ed._edit(from, to, step.text);
      } else if (step.t === 'delete') {
        if (s !== e) ed._edit(s, e, '');
        else {
          let to = moveCaret(v, s, step.how).pos;
          if (to === s && step.how === 'lineEnd' && s < v.length) to = s + 1; // at the end: the line break
          if (step.how === 'lineEnd') this.clip = v.slice(s, to); // ⌃K: kept for ⌃Y
          if (to !== s) ed._edit(Math.min(s, to), Math.max(s, to), '');
        }
      } else if (step.t === 'copy') {
        this.clip = v.slice(s, e);
        if (step.cut && s !== e) ed._edit(s, e, '');
      } else if (step.t === 'paste') {
        ed._edit(s, e, this.clip ?? step.text);
      } else if (step.t === 'move' && step.how === 'all') {
        ta.setSelectionRange(0, v.length);
      } else if (step.t === 'move') {
        const backward = ta.selectionDirection === 'backward';
        const focus = step.extend ? (backward ? s : e) : s === e ? s : BACKWARD.has(step.how) ? s : e;
        const anchor = backward ? e : s;
        const collapse = !step.extend && s !== e && (step.how === 'left' || step.how === 'right');
        const page = Math.max(1, Math.floor(ta.clientHeight / (parseFloat(getComputedStyle(ta).lineHeight) || 20)) - 1);
        const r = collapse ? { pos: focus } : moveCaret(v, focus, step.how, { goal, page });
        goal = r.goal ?? null;
        // As in Emacs, a move that can't go on (the end of the note) ends the run.
        if (!collapse && r.pos === focus && ['left', 'right', 'up', 'down', 'pageUp', 'pageDown'].includes(step.how)) throw new Stop(BACKWARD.has(step.how) ? 'the start of the note' : 'the end of the note');
        if (step.extend) ta.setSelectionRange(Math.min(anchor, r.pos), Math.max(anchor, r.pos), r.pos < anchor ? 'backward' : 'forward');
        else ta.setSelectionRange(r.pos, r.pos);
      } else if (step.t === 'find') {
        if (!ed.findNth(step.spec, step.k)) throw new Stop(`no more “${step.spec.query}”`);
        // Emacs's search ends at the match, not on it.
        if (step.collapse) { const p = step.collapse === 'start' ? ta.selectionStart : ta.selectionEnd; ta.setSelectionRange(p, p); }
      } else if (step.t === 'replaceAll') {
        ed.replaceAllMatches(step.spec);
      } else if (step.t === 'undo' || step.t === 'redo') {
        ed[step.t]();
      }
    }
  }
}

// A macro, said in a few words: "⌥X s n · typed “- [ ] ” · ↓ · …".
export function describe(steps) {
  const arrows = { all: '⌘A', left: '←', right: '→', up: '↑', down: '↓', wordLeft: '⌥←', wordRight: '⌥→', lineStart: '⇤', lineEnd: '⇥', docStart: '⇱', docEnd: '⇲', pageUp: '⇞', pageDown: '⇟' };
  return steps.map((s) => (s.t === 'cmd' ? s.label
    : s.t === 'edit' ? (s.text ? `“${s.text.replace(/\n/g, '⏎').slice(0, 20)}”` : `⌫${s.before + s.after > 1 ? s.before + s.after : ''}`)
      : s.t === 'move' ? `${s.extend ? '⇧' : ''}${arrows[s.how]}`
        : s.t === 'find' ? `find “${s.spec.query}”`
          : s.t === 'copy' ? (s.cut ? 'cut' : 'copy') : s.t === 'paste' ? 'paste'
          : s.t === 'key' ? s.key
            : s.t)).join(' · ');
}
