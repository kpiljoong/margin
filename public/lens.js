// The lens (experimental): what an agent sees in a note — claims with no
// support, places that disagree, what is decided and what is still open —
// drawn on the note as it was shared, never written in it. A finding is on
// its quotes: the places are marked, and joined by an arc in the gutter, so
// every line goes back to the words it is about. Its card in the margin asks
// for a fix, which comes back as a red pen proposal, to accept or not.
//
// The agent writes .agent-notes/lens.json (server.js LENS_GUIDE); the run
// keeps the findings: [{ file, kind, quotes: [exact text], note }].

export const LENS_KINDS = { gap: 'No support', conflict: 'Disagree', open: 'Open', decided: 'Decided', link: 'Together' };

// What a lens asks the agent, by the command that starts it.
export const LENS_TASKS = {
  support: 'Look through this note for claims it makes without support: numbers, causes, promises and judgements given as facts. Do not change the note: write what you see to .agent-notes/lens.json, each claim as a "gap" (with a second quote where the note could support it, if it has such a place).',
  conflict: 'Look through this note for places that disagree with each other: dates, numbers, owners, decisions or claims that don\'t match. Do not change the note: write each disagreement to .agent-notes/lens.json as a "conflict", quoting every place it involves.',
  decisions: 'Look through this note for what is decided and what is still open. Do not change the note: write to .agent-notes/lens.json each decision as "decided" and each open question or undecided point as "open", quoting with it the places it depends on or that answer it; a decision that goes against another is a "conflict".',
};

const short = (q, n = 80) => { const s = q.replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// The follow-up that asks for a fix of these findings, as a red pen proposal.
export function fixRequest(items) {
  if (!items.length) return '';
  const lines = items.map((f) => `- In ${f.file} (${LENS_KINDS[f.kind] || f.kind}): ${f.note.replace(/\s+/g, ' ')}\n  At ${f.quotes.map((q) => `“${short(q)}”`).join(' and ')}`);
  return `Fix ${items.length === 1 ? 'this' : 'these'} with the red pen: write your suggestions to .agent-notes/comments.json and leave the note itself as it is.\n${lines.join('\n')}\n`;
}

// An arc in the gutter from one place to the next, bowing out to the left.
export const arcPath = (x, y1, y2, reach) => `M${x},${y1} C${x - reach},${y1} ${x - reach},${y2} ${x},${y2}`;

// Cards at the height they want, none over another.
export function stack(wants, heights, gap = 8) {
  let next = 0;
  return wants.map((y, k) => { const top = Math.max(y, next); next = top + heights[k] + gap; return top; });
}

const NS = 'http://www.w3.org/2000/svg';
const GUTTER = 44;

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}
function svgEl(tag, cls, attrs) {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

// opts: { path, base, findings: [{ i, kind, quotes, note }] (i: the key of
// the finding in the run), pen (redpen.js), render(markdown) → html,
// hidden: Set of kinds not shown (kept by the caller), pick(i): the card
// becomes the current one, fix(i) (none when the run is settled), open(line).
// → the page; page.lensSelect(i | null) lights a finding, page.lensLayout()
// places the cards and draws the arcs.
export function lensPage(opts) {
  const { pen } = opts;
  let n = 0;
  const items = opts.findings.map((f) => ({ ...f, ns: f.quotes.map(() => n++) }));
  const comments = items.flatMap((f) => f.quotes.map((quote, k) => ({ quote, comment: '', n: f.ns[k] })));
  const { text, marks } = pen.penSource(opts.base, [], comments);
  const markOf = new Map();
  for (const m of marks) for (const c of m.notes) markOf.set(c.n, m);
  const doc = el('div', 'lens-doc md');
  doc.innerHTML = opts.render(text);
  pen.decorate(doc);

  // Each finding's places: the first mark of each quote found on the note.
  const at = (m) => (m ? [...doc.querySelectorAll(`[data-mark="${m.key}"]`)] : []);
  const owners = new Map();
  for (const f of items) {
    f.marks = f.ns.map((k) => markOf.get(k)).filter(Boolean);
    f.places = f.marks.map((m) => at(m)[0]).filter(Boolean);
    f.line = f.marks.length ? Math.min(...f.marks.map((m) => m.line)) : 0;
    for (const m of f.marks) {
      for (const span of at(m)) {
        span.classList.remove('pen-anchor');
        if (!span.dataset.k) { span.dataset.k = f.kind; span.classList.add('lens-q', `lens-k-${f.kind}`); }
        span.closest('.lens-doc > *')?.classList.add('lens-has');
      }
      if (!owners.has(m.key)) owners.set(m.key, []);
      owners.get(m.key).push(f.i);
    }
  }
  const order = [...items].sort((a, b) => a.line - b.line || (a.marks[0]?.at ?? 0) - (b.marks[0]?.at ?? 0));

  const cards = new Map();
  for (const f of order) {
    const kind = el('span', `lens-kind lens-k-${f.kind}`, LENS_KINDS[f.kind] || f.kind);
    const fix = opts.fix && el('button', 'btn small', 'Fix…');
    if (fix) { fix.title = 'Ask for a fix of this, as a red pen proposal (f)'; fix.addEventListener('click', (e) => { e.stopPropagation(); opts.fix(f.i); }); }
    const quotes = el('div', 'lens-quotes', f.quotes.map((q, k) => {
      const m = markOf.get(f.ns[k]);
      const b = el('button', `lens-quote${m ? '' : ' gone'}`, `“${short(q, 60)}”`);
      b.title = m ? 'Show it on the note' : 'Not found on the note as it is shown';
      b.addEventListener('click', (e) => { e.stopPropagation(); opts.pick(f.i); at(m)[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      return b;
    }));
    const card = el('div', `lens-card kb-item lens-k-${f.kind}`, el('div', 'lens-card-head', kind, fix), el('div', 'lens-note', f.note), quotes);
    Object.assign(card.dataset, { path: opts.path, hunk: `L${f.i}`, lens: f.i, line: f.line + 1 });
    cards.set(f.i, card);
  }

  const counts = {};
  for (const f of items) counts[f.kind] = (counts[f.kind] || 0) + 1;
  const page = el('div', 'lens-page');
  const chips = el('div', 'lens-kinds', el('span', 'lens-badge', 'Lens · experimental'),
    Object.keys(LENS_KINDS).filter((k) => counts[k]).map((k) => {
      const b = el('button', `lens-chip lens-k-${k}`, `${LENS_KINDS[k]} ${counts[k]}`);
      b.title = 'Show or hide these';
      b.addEventListener('click', () => { if (opts.hidden.has(k)) opts.hidden.delete(k); else opts.hidden.add(k); show(); });
      return b;
    }));
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'lens-arcs');
  const margin = el('div', 'lens-margin', [...cards.values()]);
  const body = el('div', 'lens-body', doc, margin);
  body.prepend(svg);
  page.append(chips, body);

  let lit = null;
  const shown = (f) => !opts.hidden.has(f.kind);
  function show() {
    for (const b of chips.querySelectorAll('.lens-chip')) b.classList.toggle('off', opts.hidden.has([...b.classList].find((c) => c.startsWith('lens-k-')).slice(7)));
    for (const f of items) {
      cards.get(f.i).hidden = !shown(f);
      // Hidden, a card is no stop for j / k.
      cards.get(f.i).classList.toggle('kb-item', shown(f));
    }
    page.classList.toggle('lens-hiding', opts.hidden.size > 0);
    for (const k of Object.keys(LENS_KINDS)) page.classList.toggle(`lens-hide-${k}`, opts.hidden.has(k));
    layout();
  }

  function layout() {
    if (!page.isConnected) return;
    const box = body.getBoundingClientRect();
    if (!box.width) return;
    const yOf = (span) => { const r = span.getClientRects()[0] || span.getBoundingClientRect(); return r.top - box.top + r.height / 2; };
    svg.replaceChildren();
    svg.setAttribute('width', GUTTER);
    svg.setAttribute('height', body.scrollHeight);
    const list = order.filter(shown);
    const ys = list.map((f) => f.places.map(yOf).sort((a, b) => a - b));
    const tops = stack(ys.map((y) => (y.length ? y[0] - 10 : 0)), list.map((f) => cards.get(f.i).offsetHeight));
    const x = GUTTER - 6;
    list.forEach((f, k) => {
      cards.get(f.i).style.top = `${tops[k]}px`;
      const y = ys[k];
      const on = lit === f.i ? ' lens-on' : '';
      for (let j = 1; j < y.length; j++) {
        const reach = Math.min(GUTTER - 8, 10 + (k % 4) * 6 + Math.min(10, (y[j] - y[j - 1]) / 40));
        const d = arcPath(x, y[j - 1], y[j], reach);
        svg.append(svgEl('path', `lens-arc lens-k-${f.kind}${on}`, { d, 'data-lens': f.i }));
        const hit = svgEl('path', 'lens-hit', { d, 'data-lens': f.i });
        hit.addEventListener('click', () => opts.pick(f.i));
        svg.append(hit);
      }
      for (const yy of y) svg.append(svgEl('circle', `lens-dot lens-k-${f.kind}${on}`, { cx: x, cy: yy, r: 3, 'data-lens': f.i }));
    });
    margin.style.minHeight = `${tops.length ? tops.at(-1) + cards.get(list.at(-1).i).offsetHeight : 0}px`;
  }

  function select(i) {
    lit = i;
    page.classList.toggle('lens-focus', i != null);
    // Words of more than one finding take the colour of the one lit.
    const tint = (span, kind) => { span.classList.remove(`lens-k-${span.dataset.kind || span.dataset.k}`); span.classList.add(`lens-k-${kind}`); span.dataset.kind = kind; };
    for (const x of page.querySelectorAll('.lens-on')) { x.classList.remove('lens-on'); if (x.dataset.k) tint(x, x.dataset.k); }
    const f = items.find((x) => x.i === i);
    if (!f) { layout(); return; }
    for (const m of f.marks) for (const span of at(m)) { span.classList.add('lens-on'); tint(span, f.kind); }
    // The card in view shows its quotes: the ones below make room.
    layout();
  }

  // A mark picks its finding (the next one on it, when it already is).
  doc.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.preventDefault();
    const span = e.target.closest('.lens-q');
    const on = span && (owners.get(span.dataset.mark) || []).filter((i) => shown(items.find((f) => f.i === i)));
    if (!on?.length) return;
    opts.pick(on[(on.indexOf(lit) + 1) % on.length]);
  });

  page.lensSelect = select;
  page.lensLayout = layout;
  const ro = new ResizeObserver(() => layout());
  ro.observe(page);
  ro.observe(doc);
  show();
  return page;
}
