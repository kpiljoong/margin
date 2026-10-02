// Find in the preview: the rendered note is searched as it reads, without
// switching to the editor. Matches are painted with the CSS Custom Highlight
// API, so the preview's markup is never touched (diagrams, embeds and folds
// stay as they are). Replacing changes the text, so that stays in the editor.

// Text of hidden things (folded sections), the find bar itself and the
// buttons drawn over pictures isn't searched.
const SKIP = '.ed-find, .diagram-copy, .fold-toggle, script, style';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, figcaption, dt, dd, summary, .note-embed-head';

// Where `query` is in `root`'s visible text → [Range]. A match never spans
// two blocks (a heading and the paragraph after it).
export function findRanges(root, query, { caseSensitive = false } = {}) {
  if (!query) return [];
  const segs = [];
  let text = '';
  let block = null;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const el = n.parentElement;
      if (!n.nodeValue || !el || el.closest(SKIP) || !el.getClientRects().length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const b = n.parentElement.closest(BLOCK);
    if (b !== block) { text += '\n'; block = b; }
    segs.push({ node: n, start: text.length });
    text += n.nodeValue;
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const at = (i, end) => {
    // The text node holding offset i (for an end, the one it closes).
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start < i || (!end && segs[mid].start === i)) lo = mid; else hi = mid - 1;
    }
    return { node: segs[lo].node, offset: i - segs[lo].start };
  };
  const out = [];
  for (let i = hay.indexOf(needle); i >= 0 && out.length < 5000; i = hay.indexOf(needle, i + needle.length)) {
    if (text.slice(i, i + needle.length).includes('\n')) continue;
    const a = at(i, false);
    const z = at(i + needle.length, true);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    out.push(r);
  }
  return out;
}

const supported = () => typeof Highlight === 'function' && !!globalThis.CSS?.highlights;

// The find bar of one preview. `onReplace(query)` opens replacing in the
// editor.
export class PreviewFind {
  constructor({ onReplace, keys }) {
    this.query = '';
    this.caseSensitive = false;
    this.open = false;
    this.ranges = [];
    this.i = -1;
    this.onReplace = onReplace;
    this.keys = keys; // (e) => 'next' | 'prev' | null
    this.bar = this.build();
  }

  build() {
    const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; };
    const bar = el('div', 'ed-find preview-find');
    const row = el('div', 'ed-find-row');
    this.input = el('input', 'ed-find-input');
    this.input.placeholder = 'Find in preview';
    this.input.spellcheck = false;
    this.count = el('span', 'ed-find-count');
    const btn = (label, title, fn) => {
      const b = el('button', 'ed-find-btn', label);
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      return b;
    };
    const caseBtn = btn('Aa', 'Match case', () => { this.caseSensitive = !this.caseSensitive; caseBtn.classList.toggle('on', this.caseSensitive); this.run(true); });
    row.append(this.input, caseBtn, this.count,
      btn('↑', 'Previous (⇧Enter)', () => this.step(-1)), btn('↓', 'Next (Enter)', () => this.step(1)),
      btn('Replace…', 'Replace in the editor', () => this.onReplace(this.query)), btn('×', 'Close (Esc)', () => this.close()));
    row.lastElementChild.previousElementSibling.classList.add('text');
    bar.append(row);
    this.input.addEventListener('input', () => { this.query = this.input.value; this.run(true); });
    this.input.addEventListener('keydown', (e) => {
      const k = this.keys?.(e);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); }
      else if (k) { e.preventDefault(); e.stopPropagation(); this.step(k === 'next' ? 1 : -1); }
    });
    return bar;
  }

  // Put the bar over this preview (the pane is rebuilt now and then).
  mount(wrap, preview) {
    this.preview = preview;
    if (this.bar.parentElement !== wrap) wrap.append(this.bar);
    this.bar.hidden = !this.open;
    if (this.open) this.run(false);
  }

  show(query) {
    this.open = true;
    this.bar.hidden = false;
    if (query) this.query = query;
    this.input.value = this.query;
    this.input.focus();
    this.input.select();
    this.run(true);
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.bar.hidden = true;
    this.ranges = [];
    this.paint();
  }

  // Search again (the text or the preview changed). fresh: start from the
  // first match below the top of the view; else keep the current one.
  run(fresh) {
    if (!this.open || !this.preview?.isConnected) return;
    this.ranges = findRanges(this.preview, this.query, { caseSensitive: this.caseSensitive });
    if (fresh) {
      const top = this.preview.getBoundingClientRect().top;
      const i = this.ranges.findIndex((r) => r.getBoundingClientRect().bottom >= top);
      this.i = this.ranges.length ? Math.max(0, i) : -1;
    } else this.i = this.ranges.length ? Math.min(Math.max(this.i, 0), this.ranges.length - 1) : -1;
    this.input.classList.toggle('bad', !!this.query && !this.ranges.length);
    this.paint();
    if (fresh) this.reveal();
  }

  step(by) {
    if (!this.ranges.length) return;
    this.i = (this.i + by + this.ranges.length) % this.ranges.length;
    this.paint();
    this.reveal();
  }

  paint() {
    this.count.textContent = !this.query || !this.open ? '' : this.ranges.length ? `${this.i + 1} / ${this.ranges.length}` : 'No results';
    if (!supported()) return;
    if (!this.open || !this.ranges.length) { CSS.highlights.delete('preview-find'); CSS.highlights.delete('preview-find-cur'); return; }
    CSS.highlights.set('preview-find', new Highlight(...this.ranges));
    CSS.highlights.set('preview-find-cur', new Highlight(this.ranges[this.i]));
  }

  // Scroll the current match into the middle of the preview if it isn't in view.
  reveal() {
    const r = this.ranges[this.i];
    const p = this.preview;
    if (!r || !p) return;
    const box = r.getBoundingClientRect();
    const view = p.getBoundingClientRect();
    const barBottom = this.bar.getBoundingClientRect().bottom;
    if (box.top >= Math.max(view.top, barBottom) && box.bottom <= view.bottom) return;
    p.scrollTop += box.top - view.top - view.height / 3;
  }
}
