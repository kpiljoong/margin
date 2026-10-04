// The film (experimental): a note through the rounds of a run, in one
// place — as it was, each round's proposal (with what you asked for it and
// what the agent noted), and what was applied. Each frame shows its changes
// from the one before as the red pen does: struck through, written in.
// Only a way to look back; nothing here changes a note.
//
// frames (server.js filmOf): [{ kind: 'original' | 'round' | 'applied',
// text, hunks (from the frame before), task?, round?, notes?, of?, undone? }]

export function frameLabel(f) {
  if (f.kind === 'original') return 'As it was';
  if (f.kind === 'applied') return f.undone ? 'Applied, undone' : 'Applied';
  return `Round ${f.round}`;
}

// What a frame says beside the note.
export function frameCaption(f) {
  const lines = [];
  if (f.kind === 'original') lines.push(`You asked: ${f.task}`);
  if (f.kind === 'round') {
    lines.push(f.round > 1 ? `You followed up: ${f.task}` : 'The agent’s proposal');
    if (!f.hunks?.length) lines.push('No change to this note in this round.');
  }
  if (f.kind === 'applied') lines.push(`You applied ${f.of[0]} of ${f.of[1]} change${f.of[1] === 1 ? '' : 's'}${f.undone ? ', then undid it' : ''}.`);
  return lines;
}

// How much a frame changes from the one before: the characters taken out
// and put in.
export const changeAmount = (f) => (f.hunks || []).reduce((n, hk) => n + hk.removed.join('\n').length + hk.added.join('\n').length, 0);

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...kids.flat().filter((k) => k != null && k !== false));
  return e;
}

const PLAY_MS = 1800;

// opts: { path, frames, pen (redpen.js), render(markdown) → html, start,
// close() }.
export function openFilm(opts) {
  const { frames, pen } = opts;
  let cur = Math.max(0, Math.min(frames.length - 1, opts.start ?? frames.length - 1));
  let timer = null;

  const strip = el('div', 'film-strip', frames.map((f, k) => {
    const b = el('button', `film-frame film-${f.kind}`, frameLabel(f));
    b.addEventListener('click', () => { stop(); show(k); root.focus({ preventScroll: true }); });
    return b;
  }));
  const range = el('input', 'film-range');
  Object.assign(range, { type: 'range', min: 0, max: frames.length - 1, step: 1 });
  range.addEventListener('input', () => { stop(); show(Number(range.value)); });
  // Over the slider, a bar for each frame as tall as its change.
  const most = Math.max(1, ...frames.map(changeAmount));
  const bars = el('div', 'film-bars', frames.map((f, k) => {
    const b = el('button', `film-bar film-${f.kind}`);
    const n = changeAmount(f);
    b.style.height = `${n ? Math.max(12, Math.round((n / most) * 100)) : 4}%`;
    b.title = `${frameLabel(f)}: ${n ? `${n} character${n === 1 ? '' : 's'} changed` : 'no change'}`;
    b.tabIndex = -1;
    b.addEventListener('click', () => { stop(); show(k); root.focus({ preventScroll: true }); });
    return b;
  }));
  const caption = el('div', 'film-caption');
  const doc = el('div', 'film-doc md');
  const hint = el('div', 'film-hint', '← → (h l) a frame · Space plays · Esc closes');
  const root = el('div', 'film',
    el('div', 'film-head', el('span', 'film-badge', 'Film · experimental'), el('span', 'film-path', opts.path)),
    strip, el('div', 'film-scale', bars, range), caption, el('div', 'film-page', doc), hint);
  root.tabIndex = 0;

  function show(k) {
    const step = k !== cur;
    cur = k;
    range.value = String(k);
    [...strip.children].forEach((b, i) => b.classList.toggle('on', i === k));
    [...bars.children].forEach((b, i) => b.classList.toggle('on', i === k));
    const f = frames[k];
    caption.replaceChildren(...frameCaption(f).map((t) => el('div', 'film-said', t)),
      ...(f.notes?.length ? [el('ul', 'film-notes', f.notes.map((t) => el('li', null, t)))] : []));
    // The changes from the frame before, drawn on it as the red pen does.
    const prev = frames[k - 1];
    const marked = prev && f.hunks?.length ? pen.penSource(prev.text, f.hunks, []).text : f.text;
    doc.innerHTML = opts.render(marked);
    pen.decorate(doc);
    // Only what changed is written in again, one block after another.
    if (step) {
      [...doc.children].filter((b) => b.querySelector('[data-mark]')).forEach((b, i) => {
        b.style.animationDelay = `${i * 90}ms`;
        b.classList.add('film-write');
      });
    }
    const first = doc.querySelector('[data-mark]');
    if (first) doc.parentElement.scrollTo({ top: Math.max(0, first.offsetTop - doc.parentElement.clientHeight / 3), behavior: timer ? 'smooth' : 'auto' });
  }
  function stop() { clearInterval(timer); timer = null; root.classList.remove('playing'); }
  function play() {
    if (timer) { stop(); return; }
    if (cur >= frames.length - 1) show(0);
    root.classList.add('playing');
    timer = setInterval(() => { if (cur >= frames.length - 1) stop(); else show(cur + 1); }, PLAY_MS);
  }
  function close() { stop(); root.remove(); opts.close(); }

  root.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const go = (k) => { stop(); show(Math.max(0, Math.min(frames.length - 1, k))); };
    const keys = {
      ArrowLeft: () => go(cur - 1), h: () => go(cur - 1), ArrowRight: () => go(cur + 1), l: () => go(cur + 1),
      Home: () => go(0), End: () => go(frames.length - 1), ' ': play, Escape: close, q: close,
    }[e.key];
    // The app's keys stay behind the film.
    e.stopPropagation();
    if (!keys || e.target === range && e.key.startsWith('Arrow')) return;
    e.preventDefault();
    keys();
  });
  document.body.append(root);
  show(cur);
  root.focus({ preventScroll: true });
  return root;
}
