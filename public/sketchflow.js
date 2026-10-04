// A sketch read as a flow: its boxes and the words in them are steps, its
// arrows join the steps they start and end at (the words beside an arrow's
// middle are its label), words on their own are steps too — written as a
// ```flow block (public/flow.js). What can't be read so — pen strokes,
// numbered dots, an arrow joining nothing — is counted, left to the user
// (or an agent). Plain logic, tested without a page (test/sketchflow.test.mjs).

import { parseInk, textSize, BOARD_SIZE } from './ink.js';
import { isStepText } from './flow.js';

// About how wide words are drawn: wide letters (CJK) a size, others half one.
const textWidth = (t, size) => [...t].reduce((w, ch) => w + (/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? size : size * 0.55), 0);

const inRect = ([x, y], r, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const toRect = ([x, y], r) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
function toLine(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Words as a step's name: one line, no arrows, no " : ", no ":" at the end.
function stepName(words) {
  const t = words.replace(/\s+/g, ' ').replace(/<->|\.\.>|-->|->|→|--/g, ' ').replace(/\s:\s/g, ' - ').replace(/:+$/, '').replace(/^(#|\/\/)+/, '').replace(/\s+/g, ' ').trim();
  return isStepText(t) ? t : '';
}

// src: the sketch's ```ink block. → { text, steps, arrows, unnamed, left:
// { pen, num, arrows } }, or null when there is nothing to make a step of.
export function sketchToFlow(src) {
  const { marks, board } = parseInk(src);
  const size = textSize(board?.w || BOARD_SIZE[0], board?.h || BOARD_SIZE[1]);
  const near = size * 3; // how far from a step an arrow's end may be
  const nodes = marks.filter((m) => m.kind === 'box').map((m) => ({ rect: { x: m.x, y: m.y, w: m.w, h: m.h }, words: [], box: true }));
  const loose = [];
  for (const t of marks.filter((m) => m.kind === 'text')) {
    const at = [t.x + 2, t.y + size / 2];
    const holders = nodes.filter((n) => inRect(at, n.rect, size / 3));
    if (holders.length) holders.reduce((a, b) => (b.rect.w * b.rect.h < a.rect.w * a.rect.h ? b : a)).words.push(t);
    else loose.push({ rect: { x: t.x, y: t.y, w: textWidth(t.text, size), h: size * 1.2 }, words: [t], box: false });
  }
  // An arrow's end: the nearest box near it, else the nearest words.
  const endAt = (p, from) => {
    const pick = (list) => {
      let best = null;
      for (const n of list) { const d = toRect(p, n.rect); if (n !== from && d <= near && (!best || d < best.d)) best = { n, d }; }
      return best?.n || null;
    };
    return pick(nodes) || pick(loose);
  };
  const edges = [];
  let looseArrows = 0;
  for (const a of marks.filter((m) => m.kind === 'arrow')) {
    const from = endAt(a.from, null);
    const to = from && endAt(a.to, from);
    if (!from || !to) { looseArrows++; continue; }
    edges.push({ from, to, pts: [a.from, ...a.via, a.to], label: [] });
  }
  // Words joined by no arrow: an arrow's label when beside its middle part
  // (away from its ends), else a step of their own.
  const used = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const w of loose) {
    if (used.has(w)) continue;
    const c = [w.rect.x + w.rect.w / 2, w.rect.y + w.rect.h / 2];
    let best = null;
    for (const e of edges) {
      const d = Math.min(...e.pts.slice(1).map((p, i) => toLine(c, e.pts[i], p)));
      const ends = Math.min(toRect(e.pts[0], w.rect), toRect(e.pts.at(-1), w.rect));
      if (d <= near && ends > size / 2 && (!best || d < best.d)) best = { e, d };
    }
    if (best) { best.e.label.push(w.words[0]); w.label = true; }
  }
  const steps = [...nodes, ...loose.filter((w) => !w.label)];
  if (!steps.length) return null;

  // Which way it runs: as the arrows mostly go.
  const mid = (n) => [n.rect.x + n.rect.w / 2, n.rect.y + n.rect.h / 2];
  let dx = 0;
  let dy = 0;
  for (const e of edges) { const [a, b] = [mid(e.from), mid(e.to)]; dx += b[0] - a[0]; dy += b[1] - a[1]; }
  const way = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down';
  const across = way === 'right' || way === 'left';
  const order = [...steps].sort((a, b) => {
    const [p, q] = [mid(a), mid(b)];
    return across ? p[0] - q[0] || p[1] - q[1] : p[1] - q[1] || p[0] - q[0];
  });
  if (way === 'left' || way === 'up') order.reverse();
  const rank = new Map(order.map((n, i) => [n, i]));

  // Names: the words in reading order; a box without words gets one.
  const read = (ws) => [...ws].sort((a, b) => (Math.abs(a.y - b.y) > size / 2 ? a.y - b.y : a.x - b.x)).map((t) => t.text).join(' ');
  const taken = new Set();
  let unnamed = 0;
  for (const n of order) {
    let name = stepName(read(n.words));
    if (!name) name = `Box ${++unnamed}`;
    let k = 1;
    const base = name;
    while (taken.has(name.toLowerCase())) name = `${base} ${++k}`;
    taken.add(name.toLowerCase());
    n.name = name;
  }

  // The lines: arrows in order, chained where a step has one way on.
  edges.sort((a, b) => rank.get(a.from) - rank.get(b.from) || rank.get(a.to) - rank.get(b.to));
  const outs = new Map();
  for (const e of edges) outs.set(e.from, [...(outs.get(e.from) || []), e]);
  const ins = new Map();
  for (const e of edges) ins.set(e.to, (ins.get(e.to) || 0) + 1);
  const done = new Set();
  const arrow = (e) => {
    const label = stepName(read(e.label)).replace(/[()]/g, '');
    return label ? ` -(${label})-> ` : ' -> ';
  };
  const lines = [];
  for (const e of edges) {
    if (done.has(e)) continue;
    let line = e.from.name;
    let at = e;
    for (;;) {
      done.add(at);
      line += arrow(at) + at.to.name;
      const next = outs.get(at.to);
      if (next?.length !== 1 || ins.get(at.to) !== 1 || done.has(next[0])) break;
      at = next[0];
    }
    lines.push(line);
  }
  const joined = new Set(edges.flatMap((e) => [e.from, e.to]));
  for (const n of order) if (!joined.has(n)) lines.push(n.name);
  const count = (kind) => marks.filter((m) => m.kind === kind).length;
  return {
    text: [...(way === 'down' ? [] : [`direction: ${way}`]), ...lines].join('\n'),
    steps: steps.length,
    arrows: edges.length,
    unnamed,
    left: { pen: count('pen'), num: count('num'), arrows: looseArrows },
  };
}
