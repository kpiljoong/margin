// Over time (the desk's, experimental): a meeting's note and the meetings
// before and after it ("Previous meeting: [[…]]"), in order, and what became
// of what they wrote — each to-do: the meeting it first came in, how many it
// came back in, when it was ticked; the questions that came back, and the
// one they were decided in; what was decided, when. Rules only: nothing here
// is sent anywhere (the server reads the notes and their kept versions,
// server.js deskTrail).
//
// Plain logic (test/trail.test.mjs); desk.js shows it.
import { meetingItems, bodyOf } from './meeting.js';

const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const FRONT = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1970 && y < 2200 ? `${y}-${pad(m)}-${pad(d)}` : null);
// A date written in words: 2026-09-03, 2026.9.3, 20260903, or the Korean way (year, month, day).
const DATES = [
  /(?<!\d)(\d{4})[-./_](\d{1,2})[-./_](\d{1,2})(?!\d)/,
  /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/,
  /(\d{4})\s*\uB144\s*(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/,
];
export function dateIn(s) {
  for (const re of DATES) {
    const m = re.exec(String(s || ''));
    const d = m && ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return d;
  }
  return null;
}
export const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const stemOf = (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|markdown|txt)$/i, '');

// When a meeting was: its front matter's date, the date in its name or its
// title; else, estimated, the earliest sign of it (its oldest kept version,
// the file made). note: { path, text, created, versions: [[ms, …]] }
// → { date, how: 'front' | 'name' | 'title' | 'kept' | 'file' | null, estimated }
export function dateOf(note) {
  const front = FRONT.exec(note.text || '')?.[1] || '';
  const fm = /^(?:date|created|meeting)\s*:\s*["']?([^\n"']+)/im.exec(front);
  const f = fm && dateIn(fm[1]);
  if (f) return { date: f, how: 'front', estimated: false };
  const n = dateIn(stemOf(note.path));
  if (n) return { date: n, how: 'name', estimated: false };
  const t = dateIn(/^#\s+(.+)$/m.exec(note.text || '')?.[1]);
  if (t) return { date: t, how: 'title', estimated: false };
  const kept = Math.min(...(note.versions || []).map((v) => v[0]));
  const at = [[kept, 'kept'], [note.created, 'file']].filter(([v]) => Number.isFinite(v) && v > 0).sort((a, b) => a[0] - b[0])[0];
  return at ? { date: dayOf(at[0]), how: at[1], estimated: true } : { date: null, how: null, estimated: true };
}

// The notes in order: by their dates, and a meeting always after the one it
// names as the meeting before (that holds over an estimated date).
export function orderNotes(notes) {
  const dated = notes.map((n) => ({ ...n, ...dateOf(n) }));
  const key = (n) => `${n.date || '9999'}\u0000${n.path}`;
  const left = new Set(dated);
  const out = [];
  while (left.size) {
    const ready = [...left].filter((n) => !n.prev || ![...left].some((m) => m.path === n.prev));
    const pick = (ready.length ? ready : [...left]).sort((a, b) => (key(a) < key(b) ? -1 : 1))[0];
    left.delete(pick);
    out.push(pick);
  }
  return out;
}

// The words that make two items one: no owner, date, tags or marks, any case.
export const sameOf = (s) => bodyOf(String(s)).replace(/(^|\s)#[\p{L}\p{N}_/-]+/gu, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

// When a to-do of a note was ticked, from its kept versions (each the text
// as it was until that moment): by the first one after the last that has it
// open, or by the file's last change. → { by, after } (ms) or null.
export function tickedAt(note, same) {
  const vs = [...(note.versions || [])].sort((a, b) => a[0] - b[0]);
  const state = (text) => {
    for (const l of String(text).split('\n')) {
      const m = TASK.exec(l);
      if (m && sameOf(m[2]) === same) return m[1] === ' ' ? 'open' : 'done';
    }
    return null;
  };
  let open = -1;
  vs.forEach((v, i) => { if (state(v[1]) === 'open') open = i; });
  if (open < 0) return null;
  const after = vs[open][0];
  const next = vs.slice(open + 1).find((v) => state(v[1]) === 'done');
  const by = next ? next[0] : note.modified;
  return Number.isFinite(by) ? { by, after } : null;
}

// notes: as the server sends them (server.js deskTrail).
// → { meetings: [{ path, name, date, how, estimated }], todos, questions, decisions }
// todos: [{ text, owner, due, in: [i], done, ticked: { by, after, how } | null }]
// (i: the meeting's place in meetings); questions: [{ text, in: [i], decided: i | null }];
// decisions: [{ text, in: i }].
export function trailOf(notes) {
  const order = orderNotes(notes);
  const meetings = order.map((n) => ({ path: n.path, name: stemOf(n.path), date: n.date, how: n.how, estimated: n.estimated }));
  const todos = new Map();
  const questions = new Map();
  const decided = new Map(); // same words → the meetings it was decided in
  order.forEach((n, i) => {
    for (const it of meetingItems(n.text || '')) {
      const same = sameOf(it.text);
      if (!same) continue;
      if (it.kind === 'todo') {
        const t = todos.get(same) || { same, in: [], states: [] };
        if (!t.in.includes(i)) { t.in.push(i); t.states.push(it.done); }
        Object.assign(t, { text: bodyOf(it.text), owner: it.owner || t.owner, due: it.due || t.due });
        todos.set(same, t);
      } else if (it.kind === 'question') {
        const q = questions.get(same) || { text: it.body, in: [] };
        if (!q.in.includes(i)) q.in.push(i);
        questions.set(same, q);
      } else if (it.kind === 'decision') {
        const d = decided.get(same) || { text: it.body, in: i, all: [] };
        if (!d.all.includes(i)) d.all.push(i);
        decided.set(same, d);
      }
    }
  });
  const out = [...todos.values()].map((t) => {
    const done = t.states.at(-1);
    // Done since: the first meeting after which it stays ticked.
    let k = t.states.length - 1;
    while (done && k > 0 && t.states[k - 1]) k--;
    let ticked = null;
    if (done) {
      const at = tickedAt(order[t.in[k]], t.same);
      if (at) ticked = { ...at, how: 'kept' };
      else if (k > 0) ticked = { by: null, after: null, how: 'meeting', in: t.in[k] };
    }
    return { text: t.text, owner: t.owner, due: t.due, in: t.in, done, ticked };
  });
  return {
    meetings,
    todos: out,
    questions: [...questions.entries()].map(([same, q]) => {
      // Decided after it was last asked (one decided before and asked again is open again).
      const d = decided.get(same)?.all.find((i) => i >= q.in.at(-1));
      return { text: q.text, in: q.in, decided: d ?? null };
    }),
    decisions: [...decided.values()].map((d) => ({ text: d.text, in: d.in })),
  };
}

// The card the desk shows of it: Markdown.
export function trailText(t, { max = 12 } = {}) {
  const ms = t.meetings;
  const years = new Set(ms.map((m) => m.date?.slice(0, 4)).filter(Boolean));
  const short = (d) => (d ? (years.size <= 1 ? d.slice(5) : d) : '?');
  const when = (i) => `${ms[i]?.estimated ? '≈' : ''}${short(ms[i]?.date)}`;
  const lines = [`**${ms.length} meeting${ms.length === 1 ? '' : 's'}**${ms.length ? `, ${when(0)}${ms.length > 1 ? ` → ${when(ms.length - 1)}` : ''}` : ''}`];
  // The dates not written in the notes: what they were taken from.
  const from = { kept: 'its oldest kept version', file: 'when its file was made' };
  const est = ms.filter((x) => x.estimated);
  if (est.length) lines.push('', ...est.map((m) => `- ≈ *${m.name}*: no date in it${m.how ? `; ${short(m.date)} from ${from[m.how]}` : ''}`));
  let any = false;
  const list = (title, rows) => {
    if (!rows.length) return;
    any = true;
    lines.push('', `**${title}** (${rows.length})`, ...rows.slice(0, max).map((r) => `- ${r}`));
    if (rows.length > max) lines.push(`- … ${rows.length - max} more`);
  };
  const who = (x) => `${x.text}${x.owner ? ` @${x.owner}` : ''}`;
  const open = t.todos.filter((x) => !x.done).sort((a, b) => b.in.length - a.in.length || a.in[0] - b.in[0]);
  list('Open to-dos', open.map((x) => `${who(x)} · since ${when(x.in[0])}${x.in.length > 1 ? ` · **in ${x.in.length} meetings**` : ''}${x.due ? ` · due ${short(x.due)}` : ''}`));
  const done = t.todos.filter((x) => x.done && (x.in.length > 1 || x.ticked));
  list('Done', done.map((x) => {
    const tk = x.ticked;
    const by = tk?.how === 'kept' ? ` → ticked ${dayOf(tk.after) === dayOf(tk.by) ? short(dayOf(tk.by)) : `by ${short(dayOf(tk.by))}`}` : tk?.how === 'meeting' ? ` → done by ${when(tk.in)}` : '';
    return `${who(x)} · ${when(x.in[0])}${by}${x.in.length > 1 ? ` · in ${x.in.length} meetings` : ''}`;
  }));
  const back = t.questions.filter((q) => q.in.length > 1 || q.decided != null);
  list('Questions that came back', back.map((q) => `${q.text} · ${q.in.map(when).join(', ')}${q.decided != null ? ` → decided ${when(q.decided)}` : ' · still open'}`));
  list('Decided', t.decisions.map((d) => `${when(d.in)} · ${d.text}`));
  if (!any) lines.push('', 'No to-dos, questions or decisions in them yet.');
  return lines.join('\n');
}
