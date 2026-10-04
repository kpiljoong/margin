// Comments on drawings. A comment's pin says where on a picture it is:
// { on: 'flow', box } — a box of a ```flow picture, by its name — or
// { on: 'picture' | 'sketch', x, y } — a point of a picture or a sketch, in
// its pixels. Its quote and line keep it in the text as any comment (the
// box's name, the picture's line, the sketch's `board:` line); the picture
// it is on is the one of its kind (for a box, one holding a box of that
// name) whose lines hold those words — a box's comment, failing that, stays
// with the nearest picture holding the box.

// figs: [{ start, end, on, boxes? }] (their lines in the note, end
// included). at: the line of the comment's words in the text, or null when
// they are gone; line: the line it was written on. → the index, or -1.
export function pinnedFigure(pin, figs, at, line = 0) {
  if (!pin) return -1;
  const fits = figs.map((f, i) => [f, i]).filter(([f]) => f.on === pin.on && (pin.on !== 'flow' || f.boxes?.includes(pin.box)));
  const holds = (l) => fits.find(([f]) => f.start <= l && l <= f.end);
  const inside = at != null ? holds(at) : holds(line);
  if (inside) return inside[1];
  if (pin.on !== 'flow' || !fits.length) return -1;
  const d = ([f]) => (line < f.start ? f.start - line : line > f.end ? line - f.end : 0);
  return fits.reduce((a, b) => (d(b) < d(a) ? b : a))[1];
}

// What a pinned comment is on, in a few words.
export const pinLabel = (pin) => (!pin ? '' : pin.on === 'flow' ? `on the box “${pin.box}”` : `on the ${pin.on}`);
