// The live margin (experimental): while a meeting is written, its minutes
// beside each line — a chip at once (by rule: a decision, a to-do, a
// question, a risk, an idea, one for next time, whose, by when), then a fast model's clean sentence, written in
// as it comes (server.js → lib/live.js). It is only shown: Tab keeps it (the
// line in the note becomes it, in the meeting's own Markdown), Esc lets it go.

const KIND = { decision: 'Decided', question: 'Open', todo: 'To-do', risk: 'Risk', idea: 'Idea', next: 'Next time', note: 'Note' };

// Lines worth minutes: words, not a heading, a fence, a rule or the link
// to the previous meeting.
export function wanted(line) {
  const t = line.trim();
  if (t.length < 3 || /^(#{1,6}\s|```|~~~|---+$|\*\*\*+$|<!--)/.test(t)) return false;
  if (/^(?:\*\*)?Previous meeting/i.test(t)) return false;
  return /[\p{L}\p{N}]/u.test(t);
}

const CALL = /^\s*>\s*\[!(decision|decided|question|warning|risk|idea)\][+-]?\s*(.*)$/i;
const callKind = (type) => (/^q/i.test(type) ? 'question' : /^(warning|risk)$/i.test(type) ? 'risk' : /^idea$/i.test(type) ? 'idea' : 'decision');
const TASK = /^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/;
const AT = /(?:^|[\s(])@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;
// "ann: survey thurs": someone's.
const WHO = /^\s*([\p{L}][\p{L}\p{N}_.-]{1,20}):\s+\S/u;
const DECIDE = /^\s*(?:!|→|->|=>)\s*|\b(?:decided|decision|agreed|go with|go w\/|approved|final)\b|\uACB0\uC815|\uD655\uC815|\uD558\uAE30\uB85C/i;
const ASK = /\?\s*$|^\s*\?|\?\?|\uC9C8\uBB38/;
const DO = /^\s*(?:\[\]|todo\b|action\b)|\b(?:will|needs? to|follow up|send|draft|book|write|fix|review|prepare|drafts|sends|reviews?)\b|\uD574\uC57C|\uBCF4\uB0B4|\uC791\uC131|\uC815\uB9AC/i;
const RISK = /\b(?:risks?|risky|blockers?|blocked|concerns?|worried|might slip|may slip)\b|\uC704\uD5D8|\uB9AC\uC2A4\uD06C|\uC6B0\uB824|\uAC71\uC815|\uB9C9\uD798|\uB9C9\uD600/i;
const IDEA = /\b(?:idea|what if|how about|maybe we|could we|proposal|propose)\b|\uC544\uC774\uB514\uC5B4|\uC5B4\uB54C|\uC5B4\uB5A8\uAE4C|\uC81C\uC548|\uD574\uBCF4\uBA74|\uD574 \uBCF4\uBA74/i;
const LATER = /(?:^|\s)#next\b|\bnext (?:meeting|time)\b|\bpark(?:ed|ing lot)?\b|\btable (?:it|this)\b|\uB2E4\uC74C\s?\uD68C\uC758|\uB2E4\uC74C\uC5D0|\uB098\uC911\uC5D0|\uBCF4\uB958/i;
const DAYS = [/\bsun(?:day)?\b|\uC77C\uC694\uC77C/i, /\bmon(?:day)?\b|\uC6D4\uC694\uC77C/i, /\btue(?:s|sday)?\b|\uD654\uC694\uC77C/i, /\bwed(?:nesday)?\b|\uC218\uC694\uC77C/i,
  /\bthu(?:r|rs|rsday)?\b|\uBAA9\uC694\uC77C/i, /\bfri(?:day)?\b|\uAE08\uC694\uC77C/i, /\bsat(?:urday)?\b|\uD1A0\uC694\uC77C/i];

// Today and the week ahead, for the model's dates ("thurs" → which day).
export function weekAhead(today = new Date()) {
  const name = (d) => d.toLocaleDateString('en-US', { weekday: 'short' });
  const days = [];
  for (let k = 1; k <= 7; k++) { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k); days.push(`${name(d)} ${isoDay(d)}`); }
  return `${isoDay(today)} ${today.toLocaleDateString('en-US', { weekday: 'long' })}; the next days: ${days.join(', ')}`;
}

export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// By when, if the line says: a weekday (the next one), tomorrow, 10/15 or 2026-10-15.
export function dueOf(line, today = new Date()) {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(line);
  if (iso) return iso[1];
  const md = /(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/.exec(line);
  if (md) {
    const d = new Date(today.getFullYear(), Number(md[1]) - 1, Number(md[2]));
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
    return isoDay(d);
  }
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (/\btomorrow\b|\uB0B4\uC77C/i.test(line)) { d.setDate(d.getDate() + 1); return isoDay(d); }
  const w = DAYS.findIndex((re) => re.test(line));
  if (w < 0) return null;
  d.setDate(d.getDate() + (((w - d.getDay()) + 7) % 7 || 7));
  return isoDay(d);
}

// What a line is, at once, before any model: { kind, fixed (written as
// one already), owner, due }.
export function ruleOf(line, today = new Date()) {
  const c = CALL.exec(line);
  const t = !c && TASK.exec(line);
  const owner = AT.exec(line)?.[1] || WHO.exec(line)?.[1]?.toLowerCase() || null;
  let kind;
  const later = !c && !t && /(?:^|\s)#next\b/i.test(line);
  if (c) kind = callKind(c[1]);
  else if (t) kind = 'todo';
  else if (LATER.test(line)) kind = 'next';
  else if (RISK.test(line)) kind = 'risk';
  else if (IDEA.test(line)) kind = 'idea';
  else if (ASK.test(line)) kind = 'question';
  else if (DECIDE.test(line)) kind = 'decision';
  else if (DO.test(line) || owner) kind = 'todo';
  else kind = 'note';
  return { kind, fixed: !!(c || t || later), owner: kind === 'todo' || kind === 'question' ? owner : null, due: kind === 'todo' ? dueOf(line, today) : null };
}

// The model's reply as it streams: "[todo @bob 2026-10-15] Draft the notes."
// → { head (its bracket closed), kind, owner, due, sentence }.
export function parseReply(text) {
  const m = /^\s*\[([^\]\n]*)\]\s*/.exec(text);
  if (!m) return /^\s*\[/.test(text) ? { head: false, sentence: '' } : { head: true, kind: null, sentence: text.replace(/^\s+/, '').split('\n')[0] };
  const parts = m[1].trim().split(/\s+/);
  const kind = Object.hasOwn(KIND, parts[0]?.toLowerCase()) ? parts[0].toLowerCase() : null;
  const owner = parts.find((p) => p.startsWith('@'))?.slice(1).replace(/[^\p{L}\p{N}_.-]/gu, '') || null;
  const due = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p)) || null;
  // One head: a second one, or a second line, joins the sentence.
  return { head: true, kind, owner, due, sentence: text.slice(m[0].length).replace(/\s*\n+\s*(?:\[[^\]\n]*\]\s*)?/g, ' ').replace(/\s*\[(?:decision|todo|question|risk|idea|next|note)\b[^\]\n]*\]\s*/gi, ' ').trimEnd() };
}

// The line as the meeting writes it down: a decision or question callout,
// a to-do with its owner and date, or the sentence.
export function keptLine(e) {
  const s = e.sentence.trim().replace(/\s+/g, ' ');
  if (e.kind === 'decision') return `> [!decision] ${s}`;
  if (e.kind === 'question') return `> [!question] ${s}${e.owner && !s.includes(`@${e.owner}`) ? ` @${e.owner}` : ''}`;
  if (e.kind === 'todo') return `- [ ] ${s}${e.owner && !s.includes(`@${e.owner}`) ? ` @${e.owner}` : ''}${e.due ? ` \u{1F4C5} ${e.due}` : ''}`;
  if (e.kind === 'risk') return `> [!warning] ${s}`;
  if (e.kind === 'idea') return `> [!idea] ${s}`;
  if (e.kind === 'next') return `- ${s.replace(/(^|\s)#next\b/gi, ' ').trim()} #next`;
  return s;
}

// Keeping it: the edit to the note — line i becomes the kept line; a
// callout stands apart (a blank line before and after). With the cursor on
// that line it goes to the kept line's end; on the empty line right under a
// callout, one line further, so what comes next isn't part of it.
// → { from, to, insert, caret }.
export function keepEdit(text, i, e, at = -1) {
  const lines = text.split('\n');
  let from = 0;
  for (let k = 0; k < i; k++) from += lines[k].length + 1;
  const to = from + lines[i].length;
  const indent = e.kind === 'todo' || e.kind === 'next' || e.kind === 'note' ? /^\s*/.exec(lines[i])[0] : '';
  let insert = indent + keptLine(e);
  const callout = insert.startsWith('>');
  if (callout) {
    if (i > 0 && lines[i - 1].trim()) insert = `\n${insert}`;
    if (i < lines.length - 1 && lines[i + 1].trim()) insert += '\n';
  }
  const end = from + insert.replace(/\n+$/, '').length;
  let caret = end;
  if (at > to) {
    caret = at + insert.length - (to - from);
    if (callout && at === to + 1 && !lines[i + 1]?.trim()) { insert += '\n'; caret++; }
  } else if (at >= 0 && at < from) caret = at;
  return { from, to, insert, caret };
}

// The time it took, as people read it.
export const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
export function quantile(xs, q) {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  if (!a.length) return null;
  const at = (a.length - 1) * q;
  const lo = Math.floor(at);
  return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (at - lo);
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

// A line's minutes in the margin, on one row when they fit (the chip, whose,
// by when, the sentence, how long it took); card.show(entry) draws it again.
export function liveCard() {
  const chip = el('span', 'live-chip');
  const who = el('span', 'live-who');
  const due = el('span', 'live-due');
  const ms = el('span', 'live-ms');
  const text = el('span', 'live-text');
  const keys = el('div', 'live-keys', 'Tab keep \u00B7 Esc not this');
  const card = el('div', 'mnote live-note', el('div', 'live-body', chip, who, due, text, ms), keys);
  card.show = (e) => {
    card.className = `mnote live-note k-${e.kind} s-${e.state}${e.offer ? ' offer' : ''}`;
    chip.textContent = e.state === 'kept' ? '\u2713 Kept' : KIND[e.kind];
    who.textContent = e.owner ? `@${e.owner}` : '';
    due.textContent = e.due ? `\u{1F4C5} ${e.due.slice(5).replace('-', '/')}` : '';
    const t = e.t;
    ms.textContent = t.first ? `${secs(t.first - t.stop)} \u00B7 ${t.done ? secs(t.done - t.stop) : '\u2026'}` : '';
    text.textContent = e.sentence || (e.state === 'error' ? e.error || 'No answer' : '');
    card.title = e.sentence || '';
    keys.hidden = !e.offer;
  };
  return card;
}

// The corner: how quick it is (each line: from the last key to the first
// word, and to the whole line), the median and p90 so far, and the cost.
export function liveHud() {
  const last = el('span', 'live-hud-last');
  const stats = el('span', 'live-hud-stats');
  const hud = el('div', 'live-hud', el('span', 'live-hud-dot'), el('b', null, 'Live margin'), last, stats);
  hud.show = (s) => {
    hud.classList.toggle('busy', !!s.busy);
    last.textContent = s.last ? `first ${secs(s.last.first)} · line ${secs(s.last.line)}` : s.note || 'waiting for a line…';
    const firsts = s.times.map((x) => x.first);
    const lines = s.times.map((x) => x.line);
    stats.textContent = s.times.length
      ? `median ${secs(quantile(firsts, 0.5))} / ${secs(quantile(lines, 0.5))} · p90 ${secs(quantile(firsts, 0.9))} / ${secs(quantile(lines, 0.9))} · ${s.times.length} lines · $${s.cost.toFixed(4)}`
      : '';
    hud.dataset.times = JSON.stringify({ times: s.times, cost: s.cost, calls: s.calls, cancelled: s.cancelled });
  };
  return hud;
}
