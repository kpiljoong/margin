// Gather (experimental): pieces of notes gathered into one, by hand. The
// blocks of a note stand as cards in a row that turns in depth; you flick
// through them (a two-finger swipe, a drag, ← →), pull the ones you want
// down into the tray (a drag down, ↓), put them in order there, and make a
// note of them. Pinch out (z) to see the whole note at once, pinch in to go
// back to a card.
//
// Only copies: the notes they come from never change, and the new note is
// plain Markdown — the pieces exactly as they were, and where from — made
// only when you say so.

const el = (tag, cls = '', ...kids) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
};
const fence = (l) => /^\s*(```|~~~)/.test(l);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const nameOf = (path) => path.split('/').pop().replace(/\.(md|markdown|mdx|txt)$/i, '');

// A note's blocks, exactly as written: paragraphs, lists and tables between
// blank lines, a fenced block whole, a heading on its own; front matter left
// out. → [{ text, line }] (line: where it starts, 0-based).
export function blocksOf(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) i = end + 1; }
  let cur = null;
  const flush = () => { if (cur) { out.push({ text: cur.lines.join('\n'), line: cur.line }); cur = null; } };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (fence(l)) {
      flush();
      const open = l.trim().slice(0, 3);
      const start = i;
      for (i++; i < lines.length && !lines[i].trim().startsWith(open); i++);
      out.push({ text: lines.slice(start, Math.min(i, lines.length - 1) + 1).join('\n'), line: start });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(l)) { flush(); out.push({ text: l, line: i }); continue; }
    if (!cur) cur = { lines: [], line: i };
    cur.lines.push(l);
  }
  flush();
  return out;
}

// The note made of the pieces: each as it was, in the order of the tray,
// and the notes they came from.
export function gatheredText(pieces, title = '') {
  const from = [...new Set(pieces.map((p) => nameOf(p.path)))];
  return `${title ? `# ${title}\n\n` : ''}${pieces.map((p) => p.text.trimEnd()).join('\n\n')}\n\n---\nGathered from ${from.map((n) => `[[${n}]]`).join(', ')}.\n`;
}

// A piece moved in the tray: from k to k + by, within it.
export function moved(list, k, by) {
  const to = Math.max(0, Math.min(list.length - 1, k + by));
  if (to === k || k < 0 || k >= list.length) return list;
  const out = [...list];
  out.splice(to, 0, out.splice(k, 1)[0]);
  return out;
}

// Where a flick ends: from the card in view and how far (in cards) and
// how fast (cards a second) it was pulled.
export const flickTo = (cur, pulled, speed, n) => Math.max(0, Math.min(n - 1, Math.round(cur - pulled - speed * 0.18)));

// opts: { sources: [{ path, text }], pieces: [{ path, line, text }] (the
// tray, kept by the caller between visits), render(markdown, path) → html,
// add() → Promise<{ path, text } | null> (another note), make(textFor)
// → Promise<bool> (a note made of them; textFor(title) its text), copy(text),
// close() }.
export function openGather(opts) {
  const sources = [...opts.sources];
  const pieces = opts.pieces;
  let src = 0;
  let cur = 0;
  let pull = 0; // cards dragged, while a drag lasts
  let whole = false;
  let wholeTop = 0;
  let sel = pieces.length - 1;
  let cards = [];

  const tabs = el('div', 'gather-sources');
  const count = el('span', 'gather-count');
  const hint = el('div', 'gather-hint', '← → (swipe) a block · ↓ (drag down) gather · z (pinch) the whole note · Tab another note · + add one · < > move in the tray · x take out · Enter make a note · Esc');
  const world = el('div', 'gather-world');
  const stage = el('div', 'gather-stage', el('div', 'gather-floor'), world);
  const tray = el('div', 'gather-tray');
  const make = el('button', 'btn primary', 'Make a note…');
  const copy = el('button', 'btn', 'Copy');
  const clear = el('button', 'btn', 'Clear');
  const root = el('div', 'gather',
    el('div', 'gather-head', el('span', 'gather-badge', 'Gather · experimental'), tabs),
    stage,
    el('div', 'gather-bottom', el('div', 'gather-tray-head', count, el('span', 'grow'), clear, copy, make), tray),
    hint);
  root.tabIndex = 0;

  let flashTimer = null;
  const flash = (text) => {
    hint.dataset.msg = text;
    hint.classList.add('msg');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => hint.classList.remove('msg'), 1800);
  };
  const has = (b) => pieces.some((p) => p.path === sources[src].path && p.line === b.line && p.text === b.text);

  // ---- the row of cards: the note in view, turning in depth.
  function showSource(k) {
    const was = src;
    src = (k + sources.length) % sources.length;
    const s = sources[src];
    const blocks = blocksOf(s.text);
    cards = blocks.map((b, i) => {
      const body = el('div', 'gather-body md');
      body.innerHTML = opts.render(b.text, s.path);
      const card = el('div', 'gather-card', body, el('span', 'gather-got', 'gathered'));
      card.dataset.i = i;
      return { el: card, b };
    });
    world.replaceChildren(...cards.map((c) => c.el));
    tabs.replaceChildren(...sources.map((x, i) => {
      const b = el('button', `gather-source${i === src ? ' on' : ''}`, nameOf(x.path));
      b.title = x.path;
      b.addEventListener('click', () => { showSource(i); root.focus({ preventScroll: true }); });
      return b;
    }), (() => { const b = el('button', 'gather-source add', '+ Note'); b.title = 'Gather from another note too (+)'; b.addEventListener('click', add); return b; })());
    cur = src === was ? Math.min(cur, Math.max(0, cards.length - 1)) : 0;
    whole = false;
    layout();
  }

  function layout() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const pos = cur - pull;
    const cols = Math.max(2, Math.floor((W - 60) / 250));
    stage.classList.toggle('whole', whole);
    // The whole note: a grid, each row as tall as its tallest card.
    const rowTop = [];
    if (whole) {
      let y = 0;
      for (let r = 0; r * cols < cards.length; r++) {
        rowTop.push(y);
        y += Math.max(...cards.slice(r * cols, (r + 1) * cols).map((c) => Math.min(c.el.offsetHeight, 380))) * 0.46 + 16;
      }
    }
    cards.forEach((c, i) => {
      c.el.classList.toggle('got', has(c.b));
      c.el.classList.toggle('cur', i === cur && !whole);
      if (whole) {
        const x = ((i % cols) - (cols - 1) / 2) * 240;
        const y = rowTop[Math.floor(i / cols)] - wholeTop - H * 0.44 + 24;
        c.el.style.transform = `translate(-50%, 0) translate3d(${x}px, ${y}px, 0) scale(.46)`;
        c.el.style.opacity = '';
        c.el.style.zIndex = '';
        c.el.style.visibility = '';
        return;
      }
      const d = i - pos;
      const a = Math.abs(d);
      const near = Math.min(a, 1);
      const far = Math.max(0, a - 1);
      const x = Math.sign(d) * (near * Math.min(360, W * 0.32) + far * 64);
      const z = -near * 200 - far * 50;
      const turn = -Math.max(-1, Math.min(1, d)) * 40;
      c.el.style.transform = `translate(-50%, -50%) translate3d(${Math.round(x)}px, ${c.drop || 0}px, ${Math.round(z)}px) rotateY(${turn}deg)`;
      c.el.style.opacity = String(a > 7 ? 0 : Math.max(0.15, 1 - far * 0.14));
      c.el.style.zIndex = String(100 - Math.round(a * 10));
      c.el.style.visibility = a > 7.5 ? 'hidden' : '';
    });
    count.textContent = pieces.length ? `${pieces.length} piece${pieces.length === 1 ? '' : 's'} gathered` : 'Nothing gathered yet: pull a card down';
    make.disabled = copy.disabled = clear.disabled = !pieces.length;
  }

  // ---- the tray: the pieces in the order they will have.
  function drawTray(fresh = -1) {
    sel = Math.max(-1, Math.min(sel, pieces.length - 1));
    tray.replaceChildren(...pieces.map((p, k) => {
      const body = el('div', 'gather-body md');
      body.innerHTML = opts.render(p.text, p.path);
      const piece = el('div', `gather-piece${k === sel ? ' on' : ''}${k === fresh ? ' fresh' : ''}`, el('span', 'gather-from', nameOf(p.path)), body);
      piece.dataset.k = k;
      piece.title = `${p.path} — drag to move it, up to take it out`;
      piece.addEventListener('pointerdown', (e) => dragPiece(e, piece, k));
      return piece;
    }));
    tray.children[sel]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    layout();
  }
  function dragPiece(e, piece, k) {
    if (e.button) return;
    e.preventDefault();
    sel = k;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const others = [...tray.children].map((x) => { const r = x.getBoundingClientRect(); return r.left + r.width / 2; });
    try { piece.setPointerCapture(e.pointerId); } catch { /* not a pointer that is down */ }
    piece.classList.add('dragging');
    const move = (ev) => { piece.style.transform = `translate(${ev.clientX - x0}px, ${Math.min(0, ev.clientY - y0)}px)`; };
    const up = (ev) => {
      piece.removeEventListener('pointermove', move);
      piece.removeEventListener('pointerup', up);
      piece.removeEventListener('pointercancel', up);
      if (ev.clientY - y0 < -70) { takeOut(k); return; }
      const at = others.filter((c, j) => j !== k && c < ev.clientX).length;
      pieces.splice(0, pieces.length, ...moved(pieces, k, at - k));
      sel = at;
      drawTray();
      root.focus({ preventScroll: true });
    };
    piece.addEventListener('pointermove', move);
    piece.addEventListener('pointerup', up);
    piece.addEventListener('pointercancel', up);
  }
  function takeOut(k) {
    if (k < 0 || k >= pieces.length) return;
    pieces.splice(k, 1);
    sel = Math.min(k, pieces.length - 1);
    drawTray();
    root.focus({ preventScroll: true });
  }

  // The card in view into the tray (out again, when it is there already).
  function gather() {
    const c = cards[cur];
    if (!c) return;
    const s = sources[src];
    const at = pieces.findIndex((p) => p.path === s.path && p.line === c.b.line && p.text === c.b.text);
    if (at >= 0) { takeOut(at); flash('Taken out of the tray'); return; }
    pieces.push({ path: s.path, line: c.b.line, text: c.b.text });
    sel = pieces.length - 1;
    drawTray(sel);
    // A copy of the card flies down to its place in the tray.
    const from = c.el.getBoundingClientRect();
    const to = tray.lastElementChild?.getBoundingClientRect();
    if (to && !reduced()) {
      const ghost = c.el.cloneNode(true);
      ghost.className = 'gather-card gather-ghost';
      Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, transform: 'none', opacity: '1', zIndex: '' });
      root.append(ghost);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const s2 = Math.min(to.width / from.width, to.height / from.height);
      ghost.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${s2})`, opacity: 0.3 }], { duration: 420, easing: 'cubic-bezier(.3,.7,.2,1)' }).onfinish = () => ghost.remove();
    }
    if (cur < cards.length - 1) setTimeout(() => go(cur + 1), reduced() ? 0 : 160);
  }

  function go(i) {
    cur = Math.max(0, Math.min(cards.length - 1, i));
    pull = 0;
    layout();
  }
  async function add() {
    const got = await opts.add();
    if (root.isConnected) root.focus({ preventScroll: true });
    if (!got) return;
    const at = sources.findIndex((s) => s.path === got.path);
    if (at < 0) sources.push(got);
    showSource(at < 0 ? sources.length - 1 : at);
  }
  async function makeNote() {
    if (!pieces.length) { flash('Pull a card down into the tray first'); return; }
    const done = await opts.make((title) => gatheredText(pieces, title));
    if (done) { pieces.splice(0); close(); } else if (root.isConnected) root.focus({ preventScroll: true });
  }
  make.addEventListener('click', makeNote);
  copy.addEventListener('click', () => { opts.copy(gatheredText(pieces)); root.focus({ preventScroll: true }); });
  clear.addEventListener('click', () => { pieces.splice(0); drawTray(); root.focus({ preventScroll: true }); });

  function close() {
    if (!root.isConnected) return;
    ro.disconnect();
    root.remove();
    opts.close();
  }

  root.addEventListener('keydown', (e) => {
    if (e.target !== root || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const keys = {
      ArrowRight: () => go(cur + 1), l: () => go(cur + 1), ArrowLeft: () => go(cur - 1), h: () => go(cur - 1),
      Home: () => go(0), End: () => go(cards.length - 1),
      ArrowDown: () => (whole ? null : gather()), ' ': () => (whole ? null : gather()),
      ArrowUp: () => takeOut(sel), x: () => takeOut(sel), Backspace: () => takeOut(sel),
      '<': () => { pieces.splice(0, pieces.length, ...moved(pieces, sel, -1)); sel = Math.max(0, sel - 1); drawTray(); },
      '>': () => { pieces.splice(0, pieces.length, ...moved(pieces, sel, 1)); sel = Math.min(pieces.length - 1, sel + 1); drawTray(); },
      z: () => { whole = !whole; wholeTop = 0; layout(); },
      Tab: () => showSource(src + (e.shiftKey ? -1 : 1)), '+': add,
      Enter: () => { if (whole) { whole = false; layout(); } else makeNote(); },
      c: () => { if (pieces.length) opts.copy(gatheredText(pieces)); },
      Escape: () => { if (whole) { whole = false; layout(); } else close(); }, q: close,
    }[e.key];
    // The app's own keys stay behind (but ⌘ and ⌃ ones).
    e.stopPropagation();
    if (!keys) return;
    e.preventDefault();
    keys();
  });

  // A swipe (or the wheel) turns the row; a pinch steps back to the whole
  // note, or in again.
  let wheelAcc = 0;
  let pinchAcc = 0;
  let last = 0;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey) {
      pinchAcc += e.deltaY;
      if (Math.abs(pinchAcc) > 40) { const out = pinchAcc > 0; pinchAcc = 0; if (out !== whole) { whole = out; wholeTop = 0; layout(); } }
      return;
    }
    if (whole) { wholeTop = Math.max(0, wholeTop + e.deltaY); layout(); return; }
    wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const now = performance.now();
    if (Math.abs(wheelAcc) > 60 && now - last > 90) { go(cur + Math.sign(wheelAcc)); wheelAcc = 0; last = now; }
  }, { passive: false });

  // A drag: sideways turns the row (and flicks on), down pulls the card in
  // view into the tray. A click picks a card.
  stage.addEventListener('pointerdown', (e) => {
    if (e.button || e.target.closest('a, button')) return;
    const card = e.target.closest('.gather-card');
    const i = card ? Number(card.dataset.i) : -1;
    if (whole) { if (i >= 0) { cur = i; whole = false; layout(); } return; }
    const x0 = e.clientX;
    const y0 = e.clientY;
    const span = Math.max(120, Math.min(360, stage.clientWidth * 0.32));
    let axis = null;
    let track = [{ t: e.timeStamp, x: x0 }];
    try { stage.setPointerCapture(e.pointerId); } catch { /* not a pointer that is down */ }
    root.classList.add('dragging');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : i === cur ? 'y' : 'x';
      if (axis === 'x') { pull = dx / span; track = [...track.slice(-4), { t: ev.timeStamp, x: ev.clientX }]; }
      if (axis === 'y' && cards[cur]) cards[cur].drop = Math.max(0, dy);
      layout();
    };
    const up = (ev) => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', up);
      stage.removeEventListener('pointercancel', up);
      root.classList.remove('dragging');
      if (axis === 'x') {
        const a = track[0];
        const b = track.at(-1);
        const speed = b.t > a.t ? ((b.x - a.x) / span) / ((b.t - a.t) / 1000) : 0;
        const to = flickTo(cur, pull, speed, cards.length);
        pull = 0;
        go(to);
      } else if (axis === 'y') {
        const dropped = (ev.clientY - y0) > 110;
        if (cards[cur]) cards[cur].drop = 0;
        if (dropped) gather(); else layout();
      } else if (i >= 0 && i !== cur) go(i);
      root.focus({ preventScroll: true });
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  });
  stage.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });

  document.body.append(root);
  root.classList.toggle('still', reduced());
  showSource(0);
  drawTray();
  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  requestAnimationFrame(() => root.classList.add('in'));
  root.focus({ preventScroll: true });
  return { close };
}
