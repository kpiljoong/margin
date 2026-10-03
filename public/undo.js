// The editor's own undo history. The browser keeps a text box's undo only
// while the box stays in the page: switching tabs, changing Edit/Split, or
// closing a note and opening it again (it is kept, see "buffers" in app.js)
// lost it. This one lives with the editor, so ⌘Z always goes back.
//
// Each change is kept as what was replaced where ({ at, removed, inserted })
// and the selection before and after it. Typing in one run (and deleting
// one character after another) is one step, as in other editors: a step ends
// after a pause, a new line, or a word typed after a space.

const PAUSE = 1000;
const MAX = 1000;

// old → next as one replacement. selStart: where the caret was (makes the
// answer exact when the text repeats, as typing "a" before an "a").
export function diff(old, next, selStart = old.length) {
  let p = 0;
  const min = Math.min(old.length, next.length);
  while (p < min && old.charCodeAt(p) === next.charCodeAt(p)) p++;
  p = Math.min(p, selStart);
  let q = 0;
  while (q < old.length - p && q < next.length - p && old.charCodeAt(old.length - 1 - q) === next.charCodeAt(next.length - 1 - q)) q++;
  return { at: p, removed: old.slice(p, old.length - q), inserted: next.slice(p, next.length - q) };
}

export class UndoHistory {
  constructor(value = '') { this.reset(value); }

  reset(value) {
    this.value = value;
    this.done = [];
    this.undone = [];
  }

  // The text is now `next` (from this.value). selBefore / selAfter: [start, end].
  record(next, selBefore, selAfter, now = Date.now()) {
    if (next === this.value) return;
    const sb = selBefore || [next.length, next.length];
    const c = diff(this.value, next, sb[0]);
    this.value = next;
    this.undone = [];
    const prev = this.done.at(-1);
    const typing = !c.removed && c.inserted && !c.inserted.includes('\n');
    const deleting = !c.inserted && c.removed && !c.removed.includes('\n');
    if (prev && now - prev.t < PAUSE && !prev.closed) {
      // One run of typing: right after the last, and not a new word after a space.
      if (typing && prev.kind === 'type' && c.at === prev.at + prev.inserted.length && !(/\s$/.test(prev.inserted) && /^\S/.test(c.inserted))) {
        prev.inserted += c.inserted;
        prev.selAfter = selAfter;
        prev.t = now;
        return;
      }
      // Backspace after backspace, or Delete after Delete.
      if (deleting && prev.kind === 'delete' && !prev.inserted) {
        if (c.at + c.removed.length === prev.at) { prev.at = c.at; prev.removed = c.removed + prev.removed; prev.selAfter = selAfter; prev.t = now; return; }
        if (c.at === prev.at) { prev.removed += c.removed; prev.selAfter = selAfter; prev.t = now; return; }
      }
    }
    this.done.push({ ...c, selBefore: sb, selAfter, t: now, kind: typing ? 'type' : deleting ? 'delete' : 'edit' });
    if (this.done.length > MAX) this.done.shift();
  }

  // The next step ends here, whatever comes (a command, a move of the caret).
  close() { const prev = this.done.at(-1); if (prev) prev.closed = true; }

  // → { at, remove, insert, sel } to apply, or null.
  undo() {
    const c = this.done.pop();
    if (!c) return null;
    this.undone.push(c);
    this.value = this.value.slice(0, c.at) + c.removed + this.value.slice(c.at + c.inserted.length);
    return { at: c.at, remove: c.inserted.length, insert: c.removed, sel: c.selBefore };
  }

  redo() {
    const c = this.undone.pop();
    if (!c) return null;
    this.done.push({ ...c, closed: true });
    this.value = this.value.slice(0, c.at) + c.inserted + this.value.slice(c.at + c.removed.length);
    return { at: c.at, remove: c.removed.length, insert: c.inserted, sel: c.selAfter || [c.at + c.inserted.length, c.at + c.inserted.length] };
  }
}
