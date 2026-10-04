// Forks (experimental): a paragraph and the agent's other ways of writing
// it, side by side; the one in view is shown in the note, in its place, so
// you read it with what comes before and after. Taking one makes it a
// change of the proposal (server.js takeFork): accepted and applied as any
// other, or left. Nothing in the note changes until then.

// What the command asks the agent, for this paragraph.
export const forkTask = (paragraph) => `Write this paragraph of the note two or three other ways — each different in approach (shorter, more concrete, another order or tone) and each able to stand in its place. Do not change the note: write them to .agent-notes/forks.json, quoting the paragraph exactly.\n<<<\n${paragraph}\n>>>`;

const fence = (l) => /^\s*(```|~~~)/.test(l);

// The paragraph at pos: its lines up to the blank lines (or fences) around
// it, exactly as in the text; '' on a blank line.
export function paragraphAt(text, pos) {
  const lines = text.split('\n');
  let at = 0;
  let i = 0;
  while (i < lines.length - 1 && at + lines[i].length < pos) { at += lines[i].length + 1; i++; }
  if (!lines[i]?.trim() || fence(lines[i])) return '';
  let a = i;
  let b = i;
  while (a > 0 && lines[a - 1].trim() && !fence(lines[a - 1])) a--;
  while (b < lines.length - 1 && lines[b + 1].trim() && !fence(lines[b + 1])) b++;
  return lines.slice(a, b + 1).join('\n');
}

// The text with the paragraph swapped, and the lines it takes there.
export function swapIn(base, quote, text) {
  const at = base.indexOf(quote);
  if (at < 0) return { text: base, from: -1, to: -1 };
  const from = base.slice(0, at).split('\n').length - 1;
  return { text: base.slice(0, at) + text + base.slice(at + quote.length), from, to: from + text.split('\n').length - 1 };
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}

// opts: { path, n (the fork's number in the run), fork: { quote, options:
// [{ text, why }], pick }, base (the note as shared), render(markdown) →
// html, take(k) (k: an option's number, or null for the paragraph as it
// is; none when the run is settled) }.
// → the page; page.forkPreview(k) shows option k (or 'o') in the note.
export function forksPage(opts) {
  const { fork, n } = opts;
  const md = (text) => { const d = el('div', 'md'); d.innerHTML = opts.render(text); return d; };
  const cols = [{ k: 'o', title: 'As it is', text: fork.quote, why: '' }, ...fork.options.map((o, k) => ({ k: String(k), title: `Option ${k + 1}`, text: o.text, why: o.why }))];
  const inUse = fork.pick == null ? 'o' : String(fork.pick);
  const row = el('div', 'forks-row', cols.map((c) => {
    const take = opts.take && c.k !== inUse && el('button', 'btn small', c.k === 'o' ? 'Keep it' : 'Take');
    if (take) {
      take.title = c.k === 'o' ? 'Back to the paragraph as it is (Enter)' : 'Put this one in the proposal (Enter)';
      take.addEventListener('click', (e) => { e.stopPropagation(); opts.take(c.k === 'o' ? null : Number(c.k)); });
    }
    const col = el('div', `fork-col kb-item${c.k === inUse ? ' fork-in' : ''}`,
      el('div', 'fork-col-head', el('span', 'fork-title', c.title), c.k === inUse ? el('span', 'fork-badge', fork.pick == null ? 'in the note' : 'taken') : null, take),
      c.why ? el('div', 'fork-why', c.why) : null,
      md(c.text));
    Object.assign(col.dataset, { path: opts.path, hunk: `F${n}.${c.k}`, fork: n, opt: c.k });
    col.addEventListener('mouseenter', () => preview(c.k));
    return col;
  }));
  const doc = el('div', 'forks-doc');
  const page = el('div', 'forks-page',
    el('div', 'forks-head', el('span', 'forks-badge', 'Forks · experimental'), el('span', 'forks-hint', 'j k · Enter takes it · below: the note with it, in its place')),
    row,
    el('div', 'forks-in', el('div', 'forks-label', 'In the note'), doc));

  let shown = null;
  function preview(k) {
    if (k === shown) return;
    shown = k;
    for (const c of row.children) c.classList.toggle('fork-shown', c.dataset.opt === k);
    const text = k === 'o' ? fork.quote : fork.options[Number(k)]?.text ?? fork.quote;
    const s = swapIn(opts.base, fork.quote, text);
    doc.replaceChildren(md(s.text));
    // The paragraph's blocks (the outermost ones on its lines) lit.
    const here = [...doc.querySelectorAll('[data-line]')].filter((x) => { const l = Number(x.dataset.line); return l >= s.from && l <= s.to; });
    const top = here.filter((x) => !here.some((y) => y !== x && y.contains(x)));
    for (const x of top) {
      x.classList.add('fork-here');
      // Its block of the note stays clear (a list's items are in it).
      let b = x;
      while (b.parentElement && !b.parentElement.classList.contains('md')) b = b.parentElement;
      b.classList.add('fork-block');
    }
    if (top[0]) doc.scrollTop = Math.max(0, top[0].offsetTop - doc.clientHeight / 3);
  }
  page.forkPreview = preview;
  // Laid out first, then scrolled to the paragraph.
  requestAnimationFrame(() => { const k = shown ?? inUse; shown = null; preview(k); });
  preview(inUse);
  return page;
}
