// Space (experimental): a review's red pen as a space. The paragraphs of
// the note float as cards, one above another; the one in view faces you, flat
// and sharp, and the rest fall back into the dark, tilting away. What waits
// for a decision comes forward; what is decided settles back (taken: green,
// left: faint). j/k go from paragraph to paragraph, J/K from change to
// change, y/n decide as in the red pen, c writes a comment on the paragraph
// (for the agent: f follows up with them), z steps back to see the whole note.
//
// Only a way to look: the cards are the red pen's own page (app.js penPage),
// and every decision goes through the review's (app.js), so nothing here
// writes. The text in view is never scaled or turned, so it stays sharp.

const el = (tag, cls = '', ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};

const GAP = 30;
const DEPTH = 70; // how far back each card further away is
const FAR = 9; // cards further than this are not drawn
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// opts: {
//   title, blocks: [Element] (the note's blocks, the red pen's marks in them),
//   marks: [{ key, line, notes: [{ text, who }], stuck }] in the note's order,
//   stateOf(key) → 'open' | 'y' | 'n', decide(key, said) → bool (taken),
//   comments: [{ block, text }] (kept by the caller), comment({ block, quote, text }),
//   start (a mark key), mine (the pen is yours: blue),
//   followUp(), open(block, key), apply(), file(dir) (another note of the run),
//   close({ key }) (the mark in view when it closed)
// }
export function openSpace(opts) {
  const root = el('div', `space${opts.mine ? ' mine' : ''}`);
  root.tabIndex = 0;
  const world = el('div', 'space-world');
  const floor = el('div', 'space-floor');
  const strip = el('div', 'space-strip');
  const count = el('span', 'space-count');
  const head = el('div', 'space-head', el('span', 'space-badge', 'Space · experimental'), el('span', 'space-title', opts.title), count);
  const hint = el('div', 'space-hint', 'j k paragraph · J K change · y n decide · x toggle · c comment · f follow up · z whole note · o open · a apply · [ ] note · Esc back');
  root.append(floor, world, head, strip, hint);

  // The cards: a block each, a heading a sign of its own.
  const cards = opts.blocks.map((b, i) => {
    const sign = /^H[1-6]$/.test(b.tagName);
    const body = el('div', 'space-body md', b);
    const notes = el('div', 'space-notes');
    const mine = el('div', 'space-mine');
    const card = el('div', `space-card${sign ? ' sign' : ''}`, el('div', 'space-float', body, notes, mine));
    card.dataset.i = i;
    card.style.setProperty('--i', i);
    world.append(card);
    return { el: card, body, notes, mine, marks: [], h: 0, top: 0 };
  });
  const cardOfEl = (x) => { const c = x?.closest?.('.space-card'); return c ? Number(c.dataset.i) : -1; };
  // Each mark to the card it is in (a picture's marks come when it is drawn:
  // until then, by its line).
  const place = () => {
    for (const c of cards) c.marks = [];
    for (const m of opts.marks) {
      let i = cardOfEl(world.querySelector(`[data-mark="${m.key}"]`));
      if (i < 0) {
        i = 0;
        cards.forEach((c, k) => { if (Number(opts.blocks[k].dataset.line) <= m.line) i = k; });
      }
      m.card = i;
      cards[i]?.marks.push(m);
    }
  };

  let cur = 0;
  let mark = null; // the key of the mark in view
  let pan = 0;
  let whole = false;
  let writing = null;

  const states = () => new Map(opts.marks.map((m) => [m.key, opts.stateOf(m.key)]));
  const cardState = (c, st) => {
    if (!c.marks.length) return 'plain';
    const s = c.marks.map((m) => st.get(m.key));
    return s.includes('open') ? 'open' : s.every((x) => x === 'n') ? 'n' : 'y';
  };

  // Notes in the margins: the agent's reasons (right), your comments (left).
  const drawNotes = (st) => {
    for (const c of cards) {
      c.notes.replaceChildren(...c.marks.filter((m) => m.notes.length || m.stuck).map((m) => el('div', `space-note pen-${st.get(m.key)}${m.key === mark ? ' on' : ''}`,
        m.notes.map((n) => el('div', '', n.who ? el('b', '', `@${n.who} `) : null, n.text)), m.stuck ? el('div', 'space-stuck', m.stuck) : null)));
    }
    cards.forEach((c, i) => c.mine.replaceChildren(...opts.comments.filter((x) => x.block === i).map((x) => el('div', 'space-comment', x.text)),
      ...(writing && writing.card === i ? [writing.input] : [])));
  };

  const measure = () => {
    let y = 0;
    for (const c of cards) {
      c.h = c.el.offsetHeight;
      c.top = y;
      y += c.h + GAP;
    }
    return y;
  };

  // Where every card goes, for the card in view (or the whole note).
  const layout = () => {
    const st = states();
    const vh = root.clientHeight;
    const total = measure();
    let done = 0;
    let all = 0;
    for (const m of opts.marks) { all++; if (st.get(m.key) !== 'open') done++; }
    count.textContent = all ? `${done} of ${all} decided` : 'no changes';
    const c0 = cards[cur];
    if (whole) {
      const s = Math.min(1, (vh - 140) / Math.max(1, total));
      world.style.transform = `translate3d(0, ${Math.round(-vh / 2 + 70)}px, 0) scale(${s})`;
      world.classList.add('whole');
    } else {
      world.style.transform = 'none';
      world.classList.remove('whole');
    }
    // The card in view: in the middle, or its top near the top when it is tall.
    const lift = c0 ? (c0.h > vh - 200 ? -vh / 2 + 90 : -c0.h / 2) : 0;
    cards.forEach((c, i) => {
      const d = i - cur;
      const a = Math.abs(d);
      const s = cardState(c, st);
      c.el.classList.toggle('cur', d === 0);
      c.el.dataset.state = s;
      if (whole) {
        c.el.style.transform = `translate3d(-50%, ${c.top}px, 0)`;
        c.el.style.opacity = '';
        c.el.style.visibility = '';
        return;
      }
      c.el.style.visibility = a > FAR ? 'hidden' : '';
      if (a > FAR) return;
      if (!d) {
        c.el.style.transform = `translate3d(-50%, ${Math.round(lift + pan)}px, 0)`;
        c.el.style.opacity = '';
        return;
      }
      // Further: back, tilted away, a little aside; waiting ones come forward,
      // decided ones settle.
      // (spread a little more with depth: further cards shrink toward the middle)
      const y = lift + pan + (c.top - c0.top) + d * Math.min(a, 6) * 6;
      const z = -Math.min(a, 7) * DEPTH + (s === 'open' ? 40 : s === 'y' || s === 'n' ? -60 : 0);
      const x = Math.round(Math.sin(i * 1.7) * 22 + (s === 'y' ? -30 : s === 'n' ? 30 : 0));
      const tilt = Math.max(-18, Math.min(18, -d * 5));
      c.el.style.transform = `translate3d(calc(-50% + ${x}px), ${Math.round(y)}px, ${z}px) rotateX(${tilt}deg)`;
      c.el.style.opacity = String(Math.max(0.1, (s === 'n' ? 0.6 : 0.92) - a * 0.13));
    });
    strip.replaceChildren(...cards.map((c, i) => {
      const dot = el('button', `space-dot ${c.el.dataset.state}${i === cur ? ' cur' : ''}`);
      dot.title = c.el.textContent.trim().slice(0, 80);
      dot.addEventListener('click', () => go(i));
      return dot;
    }));
    for (const x of world.querySelectorAll('.pen-on')) x.classList.remove('pen-on');
    if (mark) for (const x of world.querySelectorAll(`[data-mark="${mark}"]`)) x.classList.add('pen-on');
    for (const [k, s] of st) {
      for (const x of world.querySelectorAll(`[data-mark="${k}"]`)) {
        x.classList.remove('pen-open', 'pen-y', 'pen-n');
        x.classList.add(`pen-${s}`);
      }
    }
    drawNotes(st);
  };

  const go = (i, key = null) => {
    if (!cards.length) return;
    cur = Math.max(0, Math.min(cards.length - 1, i));
    pan = 0;
    const ms = cards[cur].marks;
    mark = key || (ms.find((m) => opts.stateOf(m.key) === 'open') || ms[0])?.key || null;
    layout();
  };
  // The next (previous) change: a mark in this card after the one in view, or the next card's.
  const stepMark = (dir, open = false) => {
    const list = opts.marks.filter((m) => !open || opts.stateOf(m.key) === 'open');
    if (!list.length) return false;
    const at = opts.marks.findIndex((m) => m.key === mark);
    const order = (m) => opts.marks.indexOf(m);
    const pick = dir > 0
      ? list.find((m) => (at >= 0 ? order(m) > at : m.card >= cur))
      : [...list].reverse().find((m) => (at >= 0 ? order(m) < at : m.card <= cur));
    if (!pick) return false;
    go(pick.card, pick.key);
    return true;
  };
  const decide = (said, toggle = false) => {
    if (!mark) { flash('No change in this paragraph'); return; }
    const was = opts.stateOf(mark);
    const want = toggle ? (was === 'y' ? 'n' : 'y') : said;
    const taken = opts.decide(mark, want);
    root.focus({ preventScroll: true });
    if (!taken) { layout(); return; }
    if (toggle) { layout(); return; }
    if (!stepMark(1, true)) { layout(); flash(opts.marks.every((m) => opts.stateOf(m.key) !== 'open') ? 'All decided · a applies the accepted ones' : 'No change waiting after this one'); }
  };

  let flashTimer = null;
  const flash = (text) => {
    hint.dataset.msg = text;
    hint.classList.add('msg');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => hint.classList.remove('msg'), 1800);
  };

  // A comment on the paragraph in view, written where it will be.
  const write = () => {
    const c = cards[cur];
    if (!c || writing) return;
    const input = el('input', 'space-input');
    input.placeholder = 'Comment for the agent… (Enter, Esc)';
    input.spellcheck = false;
    writing = { input, card: cur };
    const end = (keep) => {
      if (writing?.input !== input) return;
      writing = null;
      const text = input.value.trim();
      input.remove();
      if (keep && text) {
        const q = opts.blocks[cur].cloneNode(true);
        q.querySelectorAll('.pen-ins, .pen-insl').forEach((x) => x.remove());
        q.querySelectorAll('li, p, br, td, th').forEach((x) => x.after(' '));
        opts.comment({ block: cur, quote: q.textContent.replace(/\s+/g, ' ').trim().slice(0, 80), text });
      }
      layout();
      root.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); }
    });
    input.addEventListener('blur', () => setTimeout(() => end(true), 100));
    layout();
    input.focus();
  };

  const close = () => {
    if (!root.isConnected) return;
    ro.disconnect();
    root.remove();
    opts.close({ key: mark });
  };

  root.addEventListener('keydown', (e) => {
    if (e.target !== root || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const k = e.key;
    const keys = {
      j: () => go(cur + 1), ArrowDown: () => go(cur + 1), k: () => go(cur - 1), ArrowUp: () => go(cur - 1),
      J: () => stepMark(1) || flash('No change after this'), K: () => stepMark(-1) || flash('No change before this'),
      l: () => stepMark(1), h: () => stepMark(-1),
      g: () => go(0), Home: () => go(0), G: () => go(cards.length - 1), End: () => go(cards.length - 1),
      y: () => decide('y'), n: () => decide('n'), x: () => decide(null, true), ' ': () => decide(null, true),
      c: () => write(), f: () => { close(); opts.followUp(); }, a: () => { close(); opts.apply(); },
      z: () => { whole = !whole; layout(); }, Enter: () => { if (whole) { whole = false; layout(); } else { close(); opts.open(cur, mark); } },
      o: () => { close(); opts.open(cur, mark); }, ']': () => { close(); opts.file(1); }, '[': () => { close(); opts.file(-1); },
      Escape: () => (whole ? (whole = false, layout()) : close()), q: () => close(),
    }[k];
    // The app's own keys stay behind the space (but ⌘ and ⌃ ones).
    e.stopPropagation();
    if (!keys) return;
    e.preventDefault();
    e.stopPropagation();
    keys();
  });
  root.addEventListener('wheel', (e) => {
    if (whole) return;
    e.preventDefault();
    pan -= e.deltaY;
    const c = cards[cur];
    if (c) pan = Math.max(-c.h, Math.min(root.clientHeight / 2, pan));
    layout();
  }, { passive: false });
  world.addEventListener('click', (e) => {
    const i = cardOfEl(e.target);
    if (i < 0) return;
    if (e.target.closest('a')) e.preventDefault();
    const key = e.target.closest('[data-mark]')?.dataset.mark;
    whole = false;
    if (i !== cur || key) go(i, key && cards[i].marks.some((m) => m.key === key) ? key : null);
    root.focus({ preventScroll: true });
  });

  document.body.append(root);
  root.classList.toggle('still', reduced());
  place();
  const startMark = opts.marks.find((m) => m.key === opts.start);
  go(startMark ? startMark.card : Math.max(0, opts.marks.find((m) => opts.stateOf(m.key) === 'open')?.card ?? 0), startMark?.key);
  // A picture drawn, a window resized: placed and laid out again.
  const ro = new ResizeObserver(() => { place(); layout(); });
  ro.observe(root);
  for (const c of cards) ro.observe(c.body);
  requestAnimationFrame(() => root.classList.add('in'));
  root.focus({ preventScroll: true });
  return { close, refresh: layout };
}
