// Where caret moves land in plain text: by character, word, line, page, to
// the ends. Shared by keyboard macros (macro.js), which do the moves again,
// and Emacs keys (emacs.js), which make them. Plain logic, tested without a
// page (test/macro.test.mjs).

export const WORD = /[\p{L}\p{N}_]/u;

// Where a caret move lands. goal: the column up/down keep to.
export function moveCaret(value, pos, how, { goal = null, page = 20 } = {}) {
  const lineStart = (p) => value.lastIndexOf('\n', p - 1) + 1;
  const lineEnd = (p) => { const n = value.indexOf('\n', p); return n < 0 ? value.length : n; };
  const vertical = (p, lines) => {
    const col = goal ?? p - lineStart(p);
    let s = lineStart(p);
    for (let i = 0; i < Math.abs(lines); i++) {
      if (lines < 0) { if (s === 0) return { pos: 0, goal: col }; s = lineStart(s - 1); } else { const e = lineEnd(s); if (e === value.length) return { pos: value.length, goal: col }; s = e + 1; }
    }
    return { pos: Math.min(s + col, lineEnd(s)), goal: col };
  };
  switch (how) {
    case 'left': return { pos: Math.max(0, pos - (/[\uDC00-\uDFFF]/.test(value[pos - 1] || '') ? 2 : 1)) };
    case 'right': return { pos: Math.min(value.length, pos + (/[\uD800-\uDBFF]/.test(value[pos] || '') ? 2 : 1)) };
    case 'wordLeft': { let p = pos; while (p > 0 && !WORD.test(value[p - 1])) p--; while (p > 0 && WORD.test(value[p - 1])) p--; return { pos: p }; }
    case 'wordRight': { let p = pos; while (p < value.length && !WORD.test(value[p])) p++; while (p < value.length && WORD.test(value[p])) p++; return { pos: p }; }
    case 'lineStart': return { pos: lineStart(pos) };
    case 'lineEnd': return { pos: lineEnd(pos) };
    case 'docStart': return { pos: 0 };
    case 'docEnd': return { pos: value.length };
    case 'up': return vertical(pos, -1);
    case 'down': return vertical(pos, 1);
    case 'pageUp': return vertical(pos, -page);
    case 'pageDown': return vertical(pos, page);
    default: return { pos };
  }
}
