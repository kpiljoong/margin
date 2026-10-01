// Note templates: notes in the workspace's templates/ folder. A new note made
// from one gets its text with these filled in:
//   {{title}}           the new note's name
//   {{date}} {{time}}   today, now (2026-10-02, 14:05)
//   {{date:FORMAT}}     YYYY YY MM M DD D HH H mm ss, dddd (Friday) ddd (Fri)
//   {{yesterday}} {{tomorrow}}
//   {{cursor}}          where the caret goes (once)
// Anything else in {{ }} is left as it is. Plain logic, tested without a page
// (test/templates.test.mjs).

export const TEMPLATE_DIR = 'templates';

export const isTemplate = (path) => path.toLowerCase().startsWith(`${TEMPLATE_DIR}/`);

const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(d, fmt) {
  const parts = {
    YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1), M: String(d.getMonth() + 1),
    DD: pad(d.getDate()), D: String(d.getDate()),
    HH: pad(d.getHours()), H: String(d.getHours()),
    mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3),
  };
  return fmt.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|ss|dddd|ddd/g, (t) => parts[t]);
}

const day = (now, by) => { const d = new Date(now); d.setDate(d.getDate() + by); return d; };

// → { text, cursor } (cursor: an offset into text, or null).
export function fillTemplate(src, { title = '', now = new Date() } = {}) {
  let cursor = null;
  let out = '';
  let last = 0;
  for (const m of src.matchAll(/\{\{\s*([a-z]+)(?::([^}\n]*))?\s*\}\}/gi)) {
    const [whole, rawName, fmt] = m;
    const name = rawName.toLowerCase();
    let value = null;
    if (name === 'title' && fmt === undefined) value = title;
    else if (name === 'date') value = formatDate(now, fmt?.trim() || 'YYYY-MM-DD');
    else if (name === 'time') value = formatDate(now, fmt?.trim() || 'HH:mm');
    else if (name === 'yesterday' || name === 'tomorrow') value = formatDate(day(now, name === 'tomorrow' ? 1 : -1), fmt?.trim() || 'YYYY-MM-DD');
    else if (name === 'cursor' && fmt === undefined && cursor == null) value = '';
    out += src.slice(last, m.index);
    if (value === null) out += whole;
    else { if (name === 'cursor') cursor = out.length; out += value; }
    last = m.index + whole.length;
  }
  return { text: out + src.slice(last), cursor };
}
