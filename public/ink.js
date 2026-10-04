// ```ink blocks: marks drawn on the picture right above them, written as
// lines a person (or an agent) can read and write. Coordinates are the
// picture's own pixels, from its top left.
//
//   ![Login](assets/login.png)
//
//   ```ink
//   box red: 280,120 200x80
//   arrow red: 410,220 -> 300,160
//   arrow blue curved: 100,300 -> 180,240 -> 300,260
//   arrow elbow: 500,100 -> 700,300
//   text red: 420,230 The button is hidden
//   pen blue: 100,100 120,104 140,112
//   num red: 300,110 1
//   hide: 40,20 300x30
//   ```
//
// - pen: a line through the points · arrow: from → to, any points between;
//   straight (corners at the points), curved (one curve through them: a
//   point between is a lever) or elbow (across and down, out of the sides
//   of the boxes it joins and round the others in its way; points between
//   are its corners, a way set by hand, kept at right angles) · box: corner and
//   size · text: where it starts, then the words · num: a numbered dot, its
//   centre and number — item 1 of the numbered list in the picture's section
//   says what it is (linkCallouts) · hide: a part covered, corner and size
//   (gray unless a colour is given); covered on screen, in a copy, and in the
//   copy an agent gets (server.js masks the pictures it shares).
// - The colour is optional (red, the pen's), any of the flow colours or black;
//   so is an arrow's kind (straight when not said), before or after it.
// - Other apps show the picture and the lines as code; Margin draws them on
//   the picture. `#` or `//` starts a comment. Plain logic, tested without a
//   page (test/ink.test.mjs), but for inkSvg.
// - A block with a `board: 1600x900` line and no picture above it is a
//   sketch: the marks on a blank page that size, drawn in a meeting say. It
//   grows as it is drawn past its edge (fitBoard).

import { COLORS, colorKey } from './flow.js';

// Also in Korean: pen, arrow, box, text, number, hide.
const KINDS = { pen: 'pen', arrow: 'arrow', box: 'box', text: 'text', num: 'num', number: 'num', hide: 'hide', blur: 'hide', '\uAC00\uB9AC\uAE30': 'hide', '\uD39C': 'pen', '\uD654\uC0B4\uD45C': 'arrow', '\uC0C1\uC790': 'box', '\uAE00': 'text', '\uBC88\uD638': 'num', board: 'board', '\uBCF4\uB4DC': 'board' };
const LINE = /^(\S+?)((?:\s+[^\s:]+)*)\s*:\s*(.*)$/;
// An arrow's kinds (also in Korean: straight, curved, elbow).
const STYLES = { straight: 'straight', line: 'straight', curved: 'curved', curve: 'curved', elbow: 'elbow', '\uC9C1\uC120': 'straight', '\uACE1\uC120': 'curved', '\uAEBE\uC740\uC120': 'elbow' };
export const ARROW_STYLES = ['straight', 'curved', 'elbow'];
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const POINT = new RegExp(`^${NUM},${NUM}$`);
const BOX = new RegExp(`^${NUM},${NUM}\\s+${NUM}\\s*[x×]\\s*${NUM}$`);
const TEXT = new RegExp(`^${NUM},${NUM}\\s+(.+)$`);
const SIZE = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/;
export const BOARD_MAX = 8000;
const LABEL = new RegExp(`^${NUM},${NUM}\\s+([\\p{L}\\p{N}]{1,3})$`, 'u');

// The pens: the flow colours, and black (to write with on a sketch).
export const INK = { ...COLORS, black: ['#e8e9ec', '#1f2328'] };
export const INK_COLORS = Object.keys(INK);
const inkColor = (word) => (/^(black|\uAC80\uC815)$/i.test(word) ? 'black' : colorKey(word));

// The marks: [{ kind, color, line, … }] (pts: [[x, y]] for a pen; from, to,
// via, style for an arrow; x, y, w, h for a box; x, y, text for text), and the lines
// that aren't marks (0-based); board: { w, h, line } of a sketch (the
// largest, if it says more than once), or null.
export function parseInk(src) {
  const marks = [];
  const bad = [];
  let board = null;
  String(src).replace(/\r\n?/g, '\n').split('\n').forEach((raw, line) => {
    const body = raw.trim();
    if (!body || body.startsWith('#') || body.startsWith('//')) return;
    const m = LINE.exec(body);
    const kind = m && KINDS[m[1].toLowerCase()];
    let color = null;
    let style = null;
    let ok = !!kind;
    for (const w of ok ? m[2].trim().split(/\s+/).filter(Boolean) : []) {
      const s = kind === 'arrow' && STYLES[w.toLowerCase()];
      if (s && !style) style = s;
      else if (!color && inkColor(w)) color = inkColor(w);
      else ok = false;
    }
    if (!ok) { bad.push(line); return; }
    color ||= kind === 'hide' ? 'gray' : 'red';
    const rest = m[3].trim();
    const n = (v) => Number(v);
    let mark = null;
    if (kind === 'board') {
      const b = SIZE.exec(rest);
      const [w, h] = b ? [n(b[1]), n(b[2])] : [0, 0];
      if (w >= 100 && h >= 100 && w <= BOARD_MAX && h <= BOARD_MAX) { if (!board || w * h > board.w * board.h) board = { w, h, line }; } else bad.push(line);
      return;
    }
    if (kind === 'pen') {
      const pts = rest.split(/\s+/).map((p) => POINT.exec(p)).filter(Boolean).map((p) => [n(p[1]), n(p[2])]);
      if (pts.length >= 2 && pts.length === rest.split(/\s+/).length) mark = { pts };
    } else if (kind === 'arrow') {
      const ps = rest.split(/\s*(?:->|→)\s*/).map((p) => POINT.exec(p));
      if (ps.length >= 2 && ps.every(Boolean)) {
        const at = ps.map((p) => [n(p[1]), n(p[2])]);
        mark = { from: at[0], to: at[at.length - 1], via: at.slice(1, -1), style: style || 'straight' };
      }
    } else if (kind === 'box' || kind === 'hide') {
      const b = BOX.exec(rest);
      if (b) mark = { x: n(b[1]), y: n(b[2]), w: n(b[3]), h: n(b[4]) };
    } else if (kind === 'num') {
      const t = LABEL.exec(rest);
      if (t) mark = { x: n(t[1]), y: n(t[2]), text: t[3] };
    } else {
      const t = TEXT.exec(rest);
      if (t) mark = { x: n(t[1]), y: n(t[2]), text: t[3].trim() };
    }
    if (mark) marks.push({ kind, color, line, ...mark });
    else bad.push(line);
  });
  return { marks, bad, board };
}

// ---- sketches

export const BOARD_SIZE = [1600, 900];
export const boardLine = (w = BOARD_SIZE[0], h = BOARD_SIZE[1]) => `board: ${w}x${h}`;
const strokeOf = (w, h) => Math.max(2, Math.round(Math.max(w, h) / 320));

// A sketch's block grown to hold its marks (a margin past the farthest, in
// steps of 100), its board line rewritten; the block as it was when they fit.
export function fitBoard(src, margin = 80) {
  const { marks, board } = parseInk(src);
  if (!board) return src;
  const sw = strokeOf(board.w, board.h);
  let [x, y] = [0, 0];
  const reach = (px, py) => { x = Math.max(x, px); y = Math.max(y, py); };
  for (const m of marks) {
    if (m.kind === 'pen') m.pts.forEach((p) => reach(...p));
    else if (m.kind === 'arrow') [m.from, ...(m.via || []), m.to].forEach((p) => reach(...p));
    else if (m.kind === 'box' || m.kind === 'hide') reach(m.x + m.w, m.y + m.h);
    else if (m.kind === 'text') reach(m.x + m.text.length * sw * 5, m.y + sw * 12);
    else reach(m.x + sw * 7, m.y + sw * 7);
  }
  const grow = (has, far) => (far + margin > has ? Math.min(BOARD_MAX, Math.ceil((far + margin) / 100) * 100) : has);
  const [w, h] = [grow(board.w, x), grow(board.h, y)];
  if (w === board.w && h === board.h) return src;
  const ls = String(src).split('\n');
  ls[board.line] = ls[board.line].replace(/\d{2,5}\s*[x×]\s*\d{2,5}\s*$/, `${w}x${h}`);
  return ls.join('\n');
}

const r = (v) => Math.round(v);
const pt = ([x, y]) => `${r(x)},${r(y)}`;

// A mark as its line.
export function inkLine(mark) {
  const kind = mark.kind === 'arrow' && mark.style && mark.style !== 'straight' ? ` ${mark.style}` : '';
  const head = `${mark.kind} ${mark.color || 'red'}${kind}: `;
  if (mark.kind === 'pen') return head + mark.pts.map(pt).join(' ');
  if (mark.kind === 'arrow') return head + [mark.from, ...(mark.via || []), mark.to].map(pt).join(' -> ');
  if (mark.kind === 'box' || mark.kind === 'hide') return `${head}${pt([mark.x, mark.y])} ${r(mark.w)}x${r(mark.h)}`;
  return `${head}${pt([mark.x, mark.y])} ${String(mark.text).replace(/\s+/g, ' ').trim()}`;
}

// A drawn line, fewer points (Ramer–Douglas–Peucker, within eps).
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = len ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len : Math.hypot(p[0] - a[0], p[1] - a[1]);
    if (d > far) { far = d; at = i; }
  }
  if (far <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

// A line through the points with its corners rounded (radius at most r,
// and at most half of either side, so a line drawn bending reads as a
// curve). → the SVG path.
export function bentPath(pts, r) {
  const f = (v) => Math.round(v * 10) / 10;
  const p = (q) => `${f(q[0])},${f(q[1])}`;
  let d = `M${p(pts[0])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, c, b] = [pts[i - 1], pts[i], pts[i + 1]];
    const la = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const lb = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const k = Math.min(r, la / 2, lb / 2);
    if (!la || !lb || !k) { d += ` L${p(c)}`; continue; }
    d += ` L${p([c[0] + (a[0] - c[0]) * k / la, c[1] + (a[1] - c[1]) * k / la])} Q${p(c)} ${p([c[0] + (b[0] - c[0]) * k / lb, c[1] + (b[1] - c[1]) * k / lb])}`;
  }
  return `${d} L${p(pts[pts.length - 1])}`;
}

// A curve through the points (Catmull–Rom): a cubic piece between each two,
// [[from, c1, c2, to]].
export function curveParts(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] || pts[i], pts[i], pts[i + 1], pts[i + 2] || pts[i + 1]];
    out.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
  }
  return out;
}

// The ways out of a box's sides, as anchors() has them: top, right, bottom, left.
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Corners tidied: no point twice, none in the middle of a straight run.
function tidy(list) {
  const pts = [];
  for (const x of list) {
    const l = pts[pts.length - 1];
    if (l && l[0] === x[0] && l[1] === x[1]) continue;
    const o = pts[pts.length - 2];
    if (o && ((o[0] === l[0] && l[0] === x[0]) || (o[1] === l[1] && l[1] === x[1]))) pts.pop();
    pts.push(x);
  }
  return pts;
}

const inRect = ([x, y], r) => x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;

// Whether the part u → v (across or down) goes through the inside of r.
function crosses(u, v, r) {
  if (u[1] === v[1]) return u[1] > r.y && u[1] < r.y + r.h && Math.max(u[0], v[0]) > r.x && Math.min(u[0], v[0]) < r.x + r.w;
  return u[0] > r.x && u[0] < r.x + r.w && Math.max(u[1], v[1]) > r.y && Math.min(u[1], v[1]) < r.y + r.h;
}

// An elbow arrow's corners from a to b, going out of the sides of the boxes
// they are on (sa, sb: 0 top … 3 left, as anchors(); -1: on none, then the
// way it mostly goes), `gap` off a box before it turns, and round the
// `boxes` in its way (`gap` off them; a box holding an end isn't in its
// way). → the points, a and b with them.
export function elbowRoute(a, b, sa = -1, sb = -1, gap = 0, boxes = []) {
  const across = (s) => s === 1 || s === 3;
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const way = (h) => (h ? (dx >= 0 ? 1 : 3) : dy >= 0 ? 2 : 0);
  const [ga, gb] = [sa < 0 ? 0 : gap, sb < 0 ? 0 : gap];
  if (sa < 0) sa = way(sb >= 0 ? across(sb) : Math.abs(dx) >= Math.abs(dy));
  if (sb < 0) sb = (way(across(sa)) + 2) % 4;
  const out = (o, s, g) => [o[0] + SIDES[s][0] * g, o[1] + SIDES[s][1] * g];
  const [p, q] = [out(a, sa, ga), out(b, sb, gb)];
  // How far from u to v, the way side s faces.
  const ahead = (s, u, v) => SIDES[s][0] * (v[0] - u[0]) + SIDES[s][1] * (v[1] - u[1]);
  let mid;
  if (across(sa) === across(sb)) {
    // Both sides face along k: across at one point of k between them (past
    // both, when they face the same way), else along at one point of the other.
    const k = across(sa) ? 0 : 1;
    const at = (v, w) => (k === 0 ? [v, w] : [w, v]);
    let v = null;
    if (sa === sb) v = SIDES[sa][k] > 0 ? Math.max(p[k], q[k]) : Math.min(p[k], q[k]);
    else if (ahead(sa, p, q) >= 0) v = (p[k] + q[k]) / 2;
    if (v != null) mid = [at(v, p[1 - k]), at(v, q[1 - k])];
    else { const w = (p[1 - k] + q[1 - k]) / 2; mid = [at(p[k], w), at(q[k], w)]; }
  } else {
    const c = across(sa) ? [q[0], p[1]] : [p[0], q[1]];
    mid = [ahead(sa, p, c) >= 0 && ahead(sb, q, c) >= 0 ? c : across(sa) ? [p[0], q[1]] : [q[0], p[1]]];
  }
  const walls = boxes.map((r) => ({ x: r.x - gap / 2, y: r.y - gap / 2, w: r.w + gap, h: r.h + gap })).filter((r) => !inRect(p, r) && !inRect(q, r));
  const core = tidy([p, ...mid, q]);
  const blocked = core.slice(1).some((v, i) => walls.some((r) => crosses(core[i], v, r)));
  const round = blocked && detour(p, q, sa, (sb + 2) % 4, walls, gap);
  return tidy([a, ...(round || core), b]);
}

// The shortest way from p (going out the way s0) to q (coming in the way
// s1) across and down, on lines `gap` off the walls, not through them, a
// turn counting as a long way. → its points, or null.
function detour(p, q, s0, s1, walls, gap) {
  const xs = new Set([p[0], q[0], (p[0] + q[0]) / 2]);
  const ys = new Set([p[1], q[1], (p[1] + q[1]) / 2]);
  for (const r of walls) {
    xs.add(r.x - gap / 2); xs.add(r.x + r.w + gap / 2);
    ys.add(r.y - gap / 2); ys.add(r.y + r.h + gap / 2);
  }
  const X = [...xs].sort((u, v) => u - v);
  const Y = [...ys].sort((u, v) => u - v);
  const [W, H] = [X.length, Y.length];
  const turn = gap * 4 + Math.max(X[W - 1] - X[0], Y[H - 1] - Y[0]) / 20;
  const id = (i, j, d) => (j * W + i) * 4 + d;
  const cost = new Map();
  const back = new Map();
  // A heap of [cost, state].
  const heap = [];
  const push = (c, st) => {
    heap.push([c, st]);
    for (let i = heap.length - 1; i > 0;) { const u = (i - 1) >> 1; if (heap[u][0] <= heap[i][0]) break; [heap[u], heap[i]] = [heap[i], heap[u]]; i = u; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [i * 2 + 1, i * 2 + 2];
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const [pi, pj, qi, qj] = [X.indexOf(p[0]), Y.indexOf(p[1]), X.indexOf(q[0]), Y.indexOf(q[1])];
  const start = id(pi, pj, s0);
  cost.set(start, 0);
  push(0, start);
  const steps = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let end = null;
  while (heap.length) {
    const [c, st] = pop();
    if (c > cost.get(st)) continue;
    const d = st % 4;
    const cell = (st - d) / 4;
    const [i, j] = [cell % W, Math.floor(cell / W)];
    if (i === qi && j === qj) {
      if (d === s1) { end = st; break; }
      const k = id(i, j, s1);
      if (!cost.has(k) || c + turn < cost.get(k)) { cost.set(k, c + turn); back.set(k, st); push(c + turn, k); }
      continue;
    }
    for (let e = 0; e < 4; e++) {
      if (e === (d + 2) % 4) continue;
      const [ni, nj] = [i + steps[e][0], j + steps[e][1]];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const [u, v] = [[X[i], Y[j]], [X[ni], Y[nj]]];
      if (walls.some((r) => inRect(v, r) || crosses(u, v, r))) continue;
      const k = id(ni, nj, e);
      const nc = c + Math.abs(v[0] - u[0]) + Math.abs(v[1] - u[1]) + (e === d ? 0 : turn);
      if (!cost.has(k) || nc < cost.get(k)) { cost.set(k, nc); back.set(k, st); push(nc, k); }
    }
  }
  if (end == null) return null;
  const pts = [];
  for (let st = end; st != null; st = back.get(st)) {
    const cell = (st - (st % 4)) / 4;
    pts.unshift([X[cell % W], Y[Math.floor(cell / W)]]);
  }
  return pts;
}

// An elbow arrow's own corners (its points between), kept at right angles:
// the corner next to an end on a box in line with it out of its side, and a
// corner more where two points are not in line.
function ownRoute(m, sa, sb) {
  const pts = [m.from, ...m.via, m.to].map((q) => [...q]);
  const n = pts.length - 1;
  const fit = (e, c, s) => { if (s >= 0) c[s % 2 === 0 ? 0 : 1] = e[s % 2 === 0 ? 0 : 1]; };
  fit(pts[0], pts[1], sa);
  fit(pts[n], pts[n - 1], sb);
  const out = [pts[0]];
  let across = sa < 0 ? null : sa % 2 === 1; // the way the last part went
  for (let i = 1; i <= n; i++) {
    const [u, w] = [out[out.length - 1], pts[i]];
    if (u[0] !== w[0] && u[1] !== w[1]) {
      // Down first or across: into an end on a box, out of its side last;
      // else turning from the way it went (or as it mostly goes).
      const down = i === n && sb >= 0 ? sb % 2 === 1 : across == null ? Math.abs(w[1] - u[1]) > Math.abs(w[0] - u[0]) : across;
      out.push(down ? [u[0], w[1]] : [w[0], u[1]]);
      across = down;
    } else if (u[0] !== w[0] || u[1] !== w[1]) across = u[1] === w[1];
    out.push(w);
  }
  return tidy(out);
}

// How an elbow arrow goes (the boxes of `marks` turn it, and are gone
// round; its own corners, when it has them). → its points.
export function elbowPoints(m, marks = [], gap = 0) {
  const [sa, sb] = [sideOf(m.from, marks), sideOf(m.to, marks)];
  if (m.via?.length) return ownRoute(m, sa, sb);
  return elbowRoute(m.from, m.to, sa, sb, gap, marks.filter((b) => b.kind === 'box'));
}

// An elbow route with its part k (point k to k + 1) moved across to where
// p is; a part at an end keeps the end, going `gap` out of it first. → the points.
export function movedPart(route, k, p, gap) {
  const n = route.length - 1;
  const [A, B] = [route[k], route[k + 1]];
  if (!A || !B) return route;
  const c = A[1] === B[1] ? 1 : 0; // what moves: y of a part across, x of one down
  const len = B[1 - c] - A[1 - c];
  const step = Math.sign(len) * Math.min(gap, Math.abs(len) / 3);
  const set = (q, v, w) => { const r = [...q]; r[c] = v; if (w != null) r[1 - c] = w; return r; };
  const v = Math.round(p[c]);
  const head = k === 0 ? [A, set(A, A[c], A[1 - c] + step), set(A, v, A[1 - c] + step)] : [set(A, v)];
  const tail = k === n - 1 ? [set(B, v, B[1 - c] - step), set(B, B[c], B[1 - c] - step), B] : [set(B, v)];
  return tidy([...route.slice(0, k), ...head, ...tail, ...route.slice(k + 2)].map(([x, y]) => [Math.round(x), Math.round(y)]));
}

// The side of a box of `marks` an arrow's end at p is on (its anchor):
// 0 top … 3 left, or -1.
export function sideOf(p, marks) {
  for (const b of marks) {
    if (b.kind !== 'box') continue;
    const i = anchors(b).findIndex((q) => q[0] === Math.round(p[0]) && q[1] === Math.round(p[1]));
    if (i >= 0) return i;
  }
  return -1;
}

const fx = (q) => `${Math.round(q[0] * 10) / 10},${Math.round(q[1] * 10) / 10}`;

// How an arrow is drawn, as it says (the boxes of `marks` turn an elbow
// arrow): its SVG path, and the point its head points away from.
export function arrowPath(m, sw, marks = []) {
  const pts = [m.from, ...(m.via || []), m.to];
  if (m.style === 'elbow') {
    const route = elbowPoints(m, marks, sw * 8);
    return { d: bentPath(route, sw * 4), back: route[route.length - 2] || m.from };
  }
  if (m.style === 'curved' && pts.length > 2) {
    const parts = curveParts(pts);
    const [p, , c2, q] = parts[parts.length - 1];
    return { d: `M${fx(pts[0])}${parts.map(([, a, b, c]) => ` C${fx(a)} ${fx(b)} ${fx(c)}`).join('')}`, back: c2[0] === q[0] && c2[1] === q[1] ? p : c2 };
  }
  return { d: `M${pts.map(fx).join(' L')}`, back: pts[pts.length - 2] };
}

// Where the dots that add a point to an arrow go: halfway along each of
// its parts (none on an elbow arrow).
export function arrowMids(m) {
  const pts = [m.from, ...(m.via || []), m.to];
  if (m.style === 'elbow') return [];
  if (m.style === 'curved' && pts.length > 2) return curveParts(pts).map(([p, a, b, q]) => [0, 1].map((k) => (p[k] + 3 * a[k] + 3 * b[k] + q[k]) / 8));
  return pts.slice(1).map((p, i) => [(pts[i][0] + p[0]) / 2, (pts[i][1] + p[1]) / 2]);
}

// ---- changing a mark (the canvas: inkdraw.js)

// A mark moved by dx, dy.
export function movedMark(m, dx, dy) {
  const p = ([x, y]) => [x + dx, y + dy];
  if (m.kind === 'pen') return { ...m, pts: m.pts.map(p) };
  if (m.kind === 'arrow') return { ...m, from: p(m.from), to: p(m.to), via: (m.via || []).map(p) };
  return { ...m, x: m.x + dx, y: m.y + dy };
}

// The points that reshape a mark: a box's (or hidden part's) corners
// clockwise from the top left, an arrow's ends and points between; none for the rest.
export function grips(m) {
  if (m.kind === 'box' || m.kind === 'hide') return [[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]];
  if (m.kind === 'arrow') return [m.from, ...(m.via || []), m.to];
  return [];
}

// The mark with grip i dragged to p: a box's opposite corner stays; an
// arrow's point moves, and a bend dragged (nearly) straight, within
// `straight`, goes. mid: a new bend in the middle of side i.
export function reshapedMark(m, i, [x, y], { mid = false, straight = 0 } = {}) {
  if (m.kind === 'arrow') {
    const pts = grips(m);
    if (mid) pts.splice(i + 1, 0, [x, y]); else pts[i] = [x, y];
    const off = (a, p, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return l ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / l : Math.hypot(p[0] - a[0], p[1] - a[1]); };
    for (let k = pts.length - 2; k > 0 && m.style !== 'elbow'; k--) if (off(pts[k - 1], pts[k], pts[k + 1]) <= straight) pts.splice(k, 1);
    return { ...m, from: pts[0], to: pts[pts.length - 1], via: pts.slice(1, -1) };
  }
  if (m.kind !== 'box' && m.kind !== 'hide') return m;
  const o = grips(m)[(i + 2) % 4];
  return { ...m, x: Math.min(o[0], x), y: Math.min(o[1], y), w: Math.abs(x - o[0]), h: Math.abs(y - o[1]) };
}

// The block with line n made `mark`, its kind and colour words as they were
// (an arrow's kind changed, its word).
export function setMark(src, n, mark) {
  const ls = String(src).split('\n');
  let head = /^\s*[^:]*:/.exec(ls[n] ?? '')?.[0];
  if (head && mark.kind === 'arrow') {
    const words = head.slice(0, -1).trim().split(/\s+/);
    const was = words.slice(1).map((w) => STYLES[w.toLowerCase()]).find(Boolean) || 'straight';
    const now = mark.style || 'straight';
    if (was !== now) head = `${/^\s*/.exec(head)[0]}${[words[0], ...words.slice(1).filter((w) => !STYLES[w.toLowerCase()]), ...(now === 'straight' ? [] : [now])].join(' ')}:`;
  }
  const line = inkLine(mark);
  ls[n] = head ? `${head} ${line.slice(line.indexOf(':') + 1).trim()}` : line;
  return ls.join('\n');
}

// A line added after the marks; a line taken out.
export function addMark(src, line) {
  const body = String(src).replace(/\s+$/, '');
  return body ? `${body}\n${line}` : line;
}
export function removeMark(src, lineNo) {
  const ls = String(src).split('\n');
  ls.splice(lineNo, 1);
  return ls.join('\n');
}

// ---- sketches: arrows that stay on boxes
//
// An arrow drawn to a box of a sketch ends on the middle of one of its
// sides (an anchor); a box moved or reshaped takes the arrow ends on its
// anchors along. Nothing new in the lines: an end on an anchor is all it
// takes.

// The size words are drawn at on a picture w × h (as markEl draws them).
export const textSize = (w, h) => strokeOf(w, h) * 9;

// A box's anchors: the middles of its top, right, bottom and left sides.
export const anchors = (b) => [[b.x + b.w / 2, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h / 2]].map(([x, y]) => [Math.round(x), Math.round(y)]);

const toBox = ([x, y], b) => Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));

// The anchor an arrow's end at p goes to: of the box nearest it, within
// reach (inside one, the smallest), not box `not`. → { at, box } or null.
export function snapEnd(p, marks, reach, not = null) {
  let best = null;
  for (const b of marks) {
    if (b.kind !== 'box' || b === not || (not && b.line === not.line)) continue;
    const d = toBox(p, b);
    if (d > reach) continue;
    if (!best || d < best.d || (d === best.d && b.w * b.h < best.box.w * best.box.h)) best = { d, box: b };
  }
  if (!best) return null;
  const at = anchors(best.box).reduce((a, q) => (Math.hypot(q[0] - p[0], q[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? q : a));
  return { at, box: best.box };
}

// An arrow with its ends snapped to the boxes of `marks` (not both on one).
export function snapArrow(a, marks, reach) {
  const from = snapEnd(a.from, marks, reach);
  const to = snapEnd(a.to, marks, reach, from?.box);
  return { ...a, from: from?.at || a.from, to: to?.at || a.to };
}

// Boxes moved or reshaped ([[before, after]]): the arrows (but those on the
// lines `skip`) with an end on one of their anchors, that end on the same
// anchor after. → [[line, arrow]].
export function followBoxes(marks, moves, skip = []) {
  const to = new Map();
  for (const [before, after] of moves) {
    const now = anchors(after);
    anchors(before).forEach((q, i) => to.set(`${q[0]},${q[1]}`, now[i]));
  }
  const at = (p) => to.get(`${Math.round(p[0])},${Math.round(p[1])}`);
  const out = [];
  for (const m of marks) {
    if (m.kind !== 'arrow' || skip.includes(m.line)) continue;
    const [f, t] = [at(m.from), at(m.to)];
    if (f || t) out.push([m.line, { ...m, from: f || m.from, to: t || m.to }]);
  }
  return out;
}
export const followBox = (marks, before, after) => followBoxes(marks, [[before, after]]);

// About how wide words are drawn at `size`: wide letters (CJK) a size, others half one.
export const textWidth = (t, size) => [...t].reduce((w, ch) => w + (/[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(ch) ? size : size * 0.55), 0);

// The rectangle a mark takes on a picture w × h: { x, y, w, h }.
export function markBounds(m, w, h) {
  const sw = strokeOf(w, h);
  const of = (pts) => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  if (m.kind === 'pen') return of(m.pts);
  if (m.kind === 'arrow') return of([m.from, ...(m.via || []), m.to]);
  if (m.kind === 'box' || m.kind === 'hide') return { x: m.x, y: m.y, w: m.w, h: m.h };
  if (m.kind === 'num') return { x: m.x - sw * 7, y: m.y - sw * 7, w: sw * 14, h: sw * 14 };
  const size = textSize(w, h);
  return { x: m.x, y: m.y, w: textWidth(m.text, size), h: size * 1.2 };
}

// The words written in a box (starting in it), top to bottom.
export const wordsIn = (marks, b, size) => marks.filter((m) => m.kind === 'text' && toBox([m.x + 2, m.y + size / 2], b) <= size / 3).sort((p, q) => p.y - q.y || p.x - q.x);

// ---- drawing (needs a page)

const SVG = 'http://www.w3.org/2000/svg';
const stroke = (color) => (INK[color] || INK.red)[1];

// The marks as SVG over a picture of w × h pixels: <svg class="ink-marks">,
// each mark a <g class="ink-mark" data-line>.
export function inkSvg(marks, w, h) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'ink-marks');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const sw = Math.max(2, Math.round(Math.max(w, h) / 320));
  const make = (tag, attrs) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  // What is hidden first, under the rest.
  for (const m of [...marks.filter((x) => x.kind === 'hide'), ...marks.filter((x) => x.kind !== 'hide')]) svg.append(markEl(m, sw, make, marks));
  return svg;
}

// marks: the picture's, for an elbow arrow to go round its boxes.
export function markEl(m, sw, make, marks = []) {
  const c = stroke(m.color);
  const g = make('g', { class: 'ink-mark', 'data-line': m.line ?? '' });
  const line = { fill: 'none', stroke: c, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (m.kind === 'pen') g.append(make('polyline', { ...line, points: m.pts.map(([x, y]) => `${x},${y}`).join(' ') }));
  else if (m.kind === 'box') g.append(make('rect', { ...line, x: m.x, y: m.y, width: Math.max(1, m.w), height: Math.max(1, m.h), rx: sw * 2 }));
  else if (m.kind === 'hide') {
    g.dataset.hide = '';
    g.append(make('rect', { x: m.x, y: m.y, width: Math.max(1, m.w), height: Math.max(1, m.h), fill: c, stroke: 'none' }));
  } else if (m.kind === 'num') {
    const rr = sw * 7;
    g.dataset.num = m.text;
    g.append(make('circle', { cx: m.x, cy: m.y, r: rr, fill: c, stroke: '#fff', 'stroke-width': sw }));
    const t = make('text', { x: m.x, y: m.y, fill: '#fff', 'font-size': rr * (m.text.length > 1 ? 1 : 1.25), 'font-weight': 700, 'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = m.text;
    g.append(t);
  } else if (m.kind === 'arrow') {
    const { d, back: [x1, y1] } = arrowPath(m, sw, marks);
    const [x2, y2] = m.to;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = sw * 5;
    const wing = (s) => `${x2 - head * Math.cos(a + s)},${y2 - head * Math.sin(a + s)}`;
    g.append(make('path', { ...line, d }));
    g.append(make('polyline', { ...line, points: `${wing(0.5)} ${x2},${y2} ${wing(-0.5)}` }));
  } else {
    const size = sw * 9;
    const t = make('text', { x: m.x, y: m.y + size, fill: c, 'font-size': size, 'font-weight': 600, 'font-family': 'system-ui, sans-serif', stroke: '#fff', 'stroke-width': sw, 'paint-order': 'stroke', 'stroke-linejoin': 'round' });
    t.textContent = m.text;
    g.append(t);
  }
  // A wide clear line to point at (to erase it).
  if (m.kind !== 'text') {
    const hit = g.firstChild.cloneNode();
    hit.setAttribute('class', 'ink-hit');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', sw * 6);
    if (m.kind === 'num' || m.kind === 'hide') hit.setAttribute('fill', 'transparent');
    g.append(hit);
  }
  return g;
}

// A picture with marks: the paragraph holding only a picture and the ```ink
// block right after it, made one <figure class="ink-figure">: the picture,
// its marks over it. data-line: the picture's line; data-ink-line: the
// block's ('' when there is none); data-source: the block's text.
// all: every picture on a line of its own is one (to draw on, on the canvas).
// → a promise, once the marks are drawn.
export function pairInk(root, { all = false } = {}) {
  const drawn = [];
  for (const pre of [...root.querySelectorAll('pre[data-lang="ink" i]')]) {
    const p = pre.previousElementSibling;
    const img = soleImage(p);
    const source = pre.dataset.source ?? pre.textContent;
    if (!img) {
      // No picture above: a sketch, or else the lines stay as code.
      const b = inkBoard(source, pre.dataset.line);
      if (b) { pre.replaceWith(b.fig); drawn.push(b.drawn); }
      continue;
    }
    const fig = inkFigure(img, p.dataset.line, pre.dataset.line, source, drawn);
    p.remove();
    pre.replaceWith(fig);
  }
  if (all) {
    for (const p of [...root.querySelectorAll('p')]) {
      const img = soleImage(p);
      if (img && !p.closest('.ink-figure')) p.replaceWith(inkFigure(img, p.dataset.line, '', '', drawn));
    }
  }
  return Promise.all(drawn);
}

// A paragraph holding only a picture, made a figure with the marks of
// `source` in its place. → { fig, drawn: a promise, once the marks are on },
// or null when it isn't such a paragraph.
export function inkOn(p, source) {
  const img = soleImage(p);
  if (!img) return null;
  const drawn = [];
  const fig = inkFigure(img, p.dataset.line, '', source, drawn);
  p.replaceWith(fig);
  return { fig, drawn: Promise.all(drawn) };
}

// A sketch: its block's marks on a blank page. The figure's line and ink
// line are both the block's. → { fig, drawn }, or null when it has no board.
export function inkBoard(source, line = '') {
  const board = parseInk(source).board;
  if (!board) return null;
  const img = document.createElement('img');
  img.alt = 'Sketch';
  img.src = boardImage(board.w, board.h);
  const drawn = [];
  const fig = inkFigure(img, line, line, source, drawn);
  fig.classList.add('ink-board');
  fig.dataset.board = '';
  return { fig, drawn: Promise.all(drawn) };
}

// A blank page w × h, as a picture (data: — the page allows no other).
export const boardImage = (w, h) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/></svg>`)}`;

const soleImage = (p) => (p?.tagName === 'P' && p.children.length === 1 && p.firstElementChild.tagName === 'IMG' && !p.textContent.trim() ? p.firstElementChild : null);

function inkFigure(img, line, inkLine, source, drawn) {
  const fig = document.createElement('figure');
  fig.className = 'ink-figure';
  fig.dataset.line = line ?? '';
  fig.dataset.inkLine = inkLine ?? '';
  fig.dataset.source = source;
  img.removeAttribute('loading');
  img.draggable = false;
  // Copied with the marks on (the app's click handler for .diagram-copy).
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'diagram-copy';
  copy.title = 'Copy with its marks (PNG)';
  copy.textContent = '\u29C9';
  fig.append(img, copy);
  drawn.push(img.decode().then(() => drawInk(fig), () => {}));
  return fig;
}

// The marks of a figure, drawn again (from its data-source).
export function drawInk(fig) {
  const img = fig.querySelector(':scope > img');
  if (!img?.naturalWidth) return;
  fig.querySelector(':scope > .ink-marks')?.remove();
  fig.inkMarks = parseInk(fig.dataset.source).marks;
  fig.append(inkSvg(fig.inkMarks, img.naturalWidth, img.naturalHeight));
  linkCallouts(fig);
  fig.dispatchEvent(new Event('inkdrawn', { bubbles: true }));
}

// A figure's numbered dots and the items of the numbered lists in its
// section (from the heading above it to the next one) with the same
// number, made a pair: li.dataset.callout = the number and li.calloutFig =
// the figure; fig.callouts: number → li. Nothing to do on the canvas, where
// the text isn't shown.
export function linkCallouts(fig) {
  fig.callouts = new Map();
  const nums = (fig.inkMarks || []).filter((m) => m.kind === 'num').map((m) => m.text);
  const root = fig.closest('.md');
  if (!nums.length || !root) return;
  const at = Number(fig.dataset.line);
  let from = -1;
  let to = Infinity;
  for (const hd of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const l = Number(hd.dataset.line);
    if (Number.isNaN(l)) continue;
    if (l <= at) from = Math.max(from, l); else to = Math.min(to, l);
  }
  for (const ol of root.querySelectorAll('ol')) {
    const l = Number(ol.querySelector(':scope > li')?.dataset.line);
    if (!(l > from && l < to)) continue;
    [...ol.children].forEach((li, i) => {
      const n = String((Number(ol.getAttribute('start')) || 1) + i);
      if (!nums.includes(n) || fig.callouts.has(n)) return;
      li.dataset.callout = n;
      li.calloutFig = fig;
      fig.callouts.set(n, li);
    });
  }
}
