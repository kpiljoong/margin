// The live margin (experimental): while a meeting is written, its minutes
// beside each line — a chip at once (by rule: a decision, a to-do, a
// question, a risk, an idea, one for next time, whose, by when), then a fast model's clean sentence, written in
// as it comes (server.js → lib/live.js). It is only shown: ⌃↩ keeps what
// the line is (a tag at its end, a to-do's box; the words and the list as they
// were written), Esc lets it go.
import { markLine } from './meeting.js';

const KIND = { decision: 'Decided', question: 'Open', todo: 'To-do', risk: 'Risk', idea: 'Idea', next: 'Next time', note: 'Note', answer: 'Answer' };
// "?? when did we say": a question to the margin, not for the minutes.
const ASKED = /^\s*\?\?/;
export const asked = (line) => ASKED.test(line);

// Its keys: ⌃↩ on a Mac (Alt+Enter elsewhere) keeps the minutes, Esc lets
// them go. Not ⌥↩ alone on a Mac: the Korean input takes it as its hanja key
// (it still keeps, with another input); not ⌘↩ (it ticks a box), nor Ctrl+Enter
// off a Mac (the same). Never Tab or ⇧Tab: they indent and outdent the list.
// Never while an input method is composing.
const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
export const keepKey = (mac = MAC) => (mac ? '\u2303\u21A9' : 'Alt+Enter');
export function liveKeyOf(e, mac = MAC) {
  if (e.isComposing || e.keyCode === 229 || e.metaKey || e.shiftKey) return null;
  if (e.key === 'Enter') return (mac ? !!e.ctrlKey !== !!e.altKey : e.altKey && !e.ctrlKey) ? 'keep' : null;
  if (e.key === 'Escape' && !e.altKey && !e.ctrlKey) return 'drop';
  return null;
}

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
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s+(.*)$/;
// "- We launch on the 20th #decision": marked already.
const TAGGED = /(?:^|\s)#(decision|decided|question|risk|idea)\b/i;
const AT = /(?:^|[\s(])@([\p{L}\p{N}_][\p{L}\p{N}_.-]*)/u;
// "ann: survey thurs": someone's.
const WHO = /^\s*([\p{L}][\p{L}\p{N}_.-]{1,20}):\s+\S/u;
const DECIDE = /^\s*(?:!|→|->|=>)\s*|\b(?:decided|decision|agreed|go with|go w\/|approved|final)\b|\uACB0\uC815|\uD655\uC815|\uD558\uAE30\uB85C/i;
const ASK = /\?\s*$|^\s*\?|\?\?|\uC9C8\uBB38/;
const DO = /^\s*(?:\[\]|todo\b|action\b)|\b(?:will|needs? to|follow up|send|draft|book|write|fix|review|prepare|drafts|sends|reviews?)\b|\uD574\uC57C|\uBCF4\uB0B4|\uC791\uC131|\uC815\uB9AC/i;
const RISK = /\b(?:risks?|risky|blockers?|blocked|concerns?|worried|might slip|may slip)\b|\uC704\uD5D8|\uB9AC\uC2A4\uD06C|\uC6B0\uB824|\uAC71\uC815|\uB9C9\uD798|\uB9C9\uD600/i;
const IDEA = /\b(?:idea|what if|how about|maybe we|could we|proposal|propose)\b|\uC544\uC774\uB514\uC5B4|\uC5B4\uB54C|\uC5B4\uB5A8\uAE4C|\uC81C\uC548|\uD574\uBCF4\uBA74|\uD574 \uBCF4\uBA74/i;
const LATER = /(?:^|\s)#next\b|\bnext (?:meeting|time)\b|\bpark(?:ed|ing lot)?\b|\btable (?:it|this)\b|\uB2E4\uC74C\s?\uD68C\uC758|\uB2E4\uC74C\uC5D0|\uB098\uC911\uC5D0|\uBCF4\uB958/i;
// A list's lead-in line saying what follows is to be done ("to do before
// the launch:", "\uADF8\uC804\uC5D0 \uC644\uB8CC\uD574\uC57C \uD560 \uAC83:").
const LEAD_DO = /\b(?:to ?dos?|action items?|next steps|needs? to|to be done|before)\b|\uD574\uC57C|\uD560 \uAC83|\uD560 \uC77C|\uC644\uB8CC|\uC804\uC5D0|\uAE4C\uC9C0/i;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s+/;
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

// By when, if the line says: a weekday (the next one), tomorrow, 10/15,
// 2026-10-15, or "2026\uB144 10\uC6D4 15\uC77C" / "10\uC6D4 15\uC77C".
export function dueOf(line, today = new Date()) {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(line);
  if (iso) return iso[1];
  const ko = /(?:(\d{4})\s*\uB144\s*)?(\d{1,2})\s*\uC6D4\s*(\d{1,2})\s*\uC77C/.exec(line);
  if (ko) {
    const d = new Date(ko[1] ? Number(ko[1]) : today.getFullYear(), Number(ko[2]) - 1, Number(ko[3]));
    if (!ko[1] && d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
    return isoDay(d);
  }
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

// A list item's lead-in: the line with words above the list it is in
// (not a heading), or null.
export function leadOf(lines, i) {
  if (!LIST.test(lines[i] || '')) return null;
  let k = i - 1;
  while (k >= 0 && LIST.test(lines[k])) k--;
  const t = (lines[k] || '').trim();
  return t && !/^#{1,6}\s/.test(t) && !/^>/.test(t) ? t : null;
}

// What a line is, at once, before any model: { kind, fixed (written as
// one already), owner, due }. lead: its list's lead-in.
export function ruleOf(line, today = new Date(), lead = null) {
  if (ASKED.test(line)) return { kind: 'answer', fixed: true, owner: null, due: null };
  const c = CALL.exec(line);
  const t = !c && TASK.exec(line);
  const g = !c && !t && TAGGED.exec(line);
  const owner = AT.exec(line)?.[1] || WHO.exec(line)?.[1]?.toLowerCase() || null;
  let kind;
  const later = !c && !t && !g && /(?:^|\s)#next\b/i.test(line);
  if (c) kind = callKind(c[1]);
  else if (t) kind = 'todo';
  else if (g) kind = callKind(g[1]);
  else if (lead && LEAD_DO.test(lead) && /:\s*$/.test(lead)) kind = 'todo';
  else if (LATER.test(line)) kind = 'next';
  else if (RISK.test(line)) kind = 'risk';
  else if (IDEA.test(line)) kind = 'idea';
  else if (ASK.test(line)) kind = 'question';
  else if (DECIDE.test(line)) kind = 'decision';
  else if (DO.test(line) || owner) kind = 'todo';
  else kind = 'note';
  return { kind, fixed: !!(c || t || g || later), owner: kind === 'todo' || kind === 'question' ? owner : null, due: kind === 'todo' ? dueOf(line, today) || (lead ? dueOf(lead, today) : null) : null };
}

// The model talking to the person instead of keeping minutes ("I'm ready
// to take minutes…", "Sure, what…"): not minutes, so not shown.
const CHAT = /^(?:I(?:'m| am) (?:ready|here|happy|sorry)|I (?:see|can|could|notice)\b|I'd (?:be|like|need)|I'll (?:be|help|take|keep)|Sure[,!.]|Certainly\b|Of course\b|Got it\b|Okay[,!]|Hello[,!.]|Hi[,!.]|Happy to\b|Let me\b|Please (?:share|provide|send|type|give|let)|Could you\b|Would you\b|What would you\b|How can I\b|It (?:looks|seems) like you|You (?:haven't|have not|seem|might|may want)|\uB124[,.!]|\uC54C\uACA0\uC2B5\uB2C8\uB2E4|\uC88B\uC2B5\uB2C8\uB2E4[,.!]|\uC548\uB155\uD558\uC138\uC694|\uD68C\uC758\uB85D\uC744 (?:\uC791\uC131|\uAE30\uB85D)\uD560 \uC900\uBE44)/i;

// The model's reply as it streams: "[todo @bob 2026-10-15] Draft the notes."
// → { head (its bracket closed), kind, owner, due, sentence }; talk: true
// when it has no head or talks to the person — nothing to show.
export function parseReply(text) {
  const m = /^\s*\[([^\]\n]*)\]\s*/.exec(text);
  if (!m) return !text.trim() || /^\s*\[/.test(text) ? { head: false, sentence: '' } : { head: true, kind: null, talk: true, sentence: '' };
  if (CHAT.test(text.slice(m[0].length))) return { head: true, kind: null, talk: true, sentence: '' };
  const parts = m[1].trim().split(/\s+/);
  const kind = Object.hasOwn(KIND, parts[0]?.toLowerCase()) ? parts[0].toLowerCase() : null;
  const owner = parts.find((p) => p.startsWith('@'))?.slice(1).replace(/[^\p{L}\p{N}_.-]/gu, '') || null;
  const due = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p)) || null;
  // One head: a second one, or a second line, joins the sentence.
  const said = text.slice(m[0].length).replace(/\s*\n+\s*(?:\[[^\]\n]*\]\s*)?/g, ' ').replace(/\s*\[(?:decision|todo|question|risk|idea|next|note)\b[^\]\n]*\]\s*/gi, ' ');
  return { head: true, kind, owner, due, ...remarkOf(said) };
}

// The kind to show: the model's, but a line asking ("\uBCF4\uB3C4\uC790\uB8CC \uD544\uC694?? bob
// \uBAA8\uB984", "a press kit?") is a question whatever the model makes of it
// (an idea, a risk or one for next time may ask too).
export function kindFor(line, kind) {
  if (!kind || ASKED.test(line) || !/\?\s*$|\?\?/.test(line)) return kind;
  return ['idea', 'risk', 'next', 'question'].includes(kind) ? kind : 'question';
}

// "We launch on Oct 27. || Last week: the 20th. Changed?": the sentence, and
// what the margin remarks on it (the last meeting, earlier in this one).
export function remarkOf(said) {
  const at = said.indexOf('||');
  if (at < 0) return { sentence: said.replace(/\s*\|$/, '').trimEnd(), remark: '' };
  return { sentence: said.slice(0, at).trimEnd(), remark: said.slice(at + 2).replace(/\s*\|+\s*/g, ' ').trim() };
}

// A request's reply (an answer, a summary): its sentences, on one line.
export const plainReply = (text) => text.replace(/^\s*\[[^\]\n]*\]\s*/, '').replace(/\s*\n+\s*/g, ' ').trim();

// The project's other notes, as the margin is told them, newest first:
// what each decided and left open; a note with none, its first words.
// notes: [{ name, items, text }]. Up to max characters, whole notes only.
export function projectMemory(label, notes, max = 3000) {
  const say = (i) => `${i.body}${i.owner ? ` @${i.owner}` : ''}${i.due ? ` (due ${i.due})` : ''}`;
  const out = [];
  let size = 0;
  for (const n of notes) {
    const pick = (kind, f = () => true) => n.items.filter((i) => i.kind === kind && f(i)).map(say);
    const parts = [['Decided', pick('decision')], ['Open to-dos', pick('todo', (i) => !i.done)], ['Open questions', pick('question')], ['Risks', pick('risk')]]
      .filter(([, xs]) => xs.length).map(([h, xs]) => `${h}: ${xs.join('; ')}`);
    const about = !parts.length && aboutOf(n.text);
    if (!parts.length && !about) continue;
    const line = `- ${n.name}: ${parts.length ? parts.join(' | ') : `About: ${about}`}`;
    if (size + line.length > max) break;
    out.push(line);
    size += line.length + 1;
  }
  return out.length ? `Project notes (${label}), newest first:\n${out.join('\n')}` : '';
}
// A note's first words: its first paragraph that isn't a heading.
function aboutOf(text) {
  const body = (text || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const para = body.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^(#|```|~~~|>|<!--)/.test(x) && /[\p{L}\p{N}]/u.test(x));
  return para ? para.replace(/\s+/g, ' ').slice(0, 200) : '';
}

// Lines of the notes that may answer a question: those with most of its
// words (a Korean word also without its last syllable, the particle).
// notes: [{ name, text }], newest first. → "- name: line" lines, or ''.
export function snippetsFor(question, notes, max = 8) {
  const words = new Set();
  for (const w of question.replace(/^\s*\?\?/, '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []) {
    words.add(w);
    if (/[\uAC00-\uD7A3]$/.test(w) && w.length >= 3) words.add(w.slice(0, -1));
  }
  if (!words.size) return '';
  const hits = [];
  notes.forEach((n, k) => {
    const body = (n.text || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---/, '');
    for (const l of body.split('\n')) {
      const t = l.trim();
      if (t.length < 3 || /^(#|```|~~~|Previous meeting)/i.test(t)) continue;
      const low = t.toLowerCase();
      let score = 0;
      for (const w of words) if (low.includes(w)) score++;
      if (score) hits.push({ score, k, line: `- ${n.name}: ${t.slice(0, 240)}` });
    }
  });
  hits.sort((a, b) => b.score - a.score || a.k - b.k);
  const out = [];
  for (const h of hits) { if (!out.includes(h.line)) out.push(h.line); if (out.length >= max) break; }
  return out.join('\n');
}

// Fold's reply: the summary, then "Settled: 1, 3" — the questions (by
// number, from 1) the meeting decided or answered. → { summary, settled: [index] }.
export function foldReply(text, count) {
  const m = /(?:^|\n)\s*\**Settled:?\**:?\s*([^\n]*)\s*$/i.exec(text);
  const settled = m ? [...new Set((m[1].match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= count).map((n) => n - 1))] : [];
  return { summary: plainReply(m ? text.slice(0, m.index) : text), settled };
}

// The last meeting, as the margin is told it: what it decided, the to-dos
// still open and done, its questions, risks and what it left for this one.
export function memoryOf(name, items, max = 1500) {
  const say = (i) => `${i.body}${i.owner ? ` @${i.owner}` : ''}${i.due ? ` (due ${i.due})` : ''}`;
  const pick = (kind, f = () => true) => items.filter((i) => i.kind === kind && f(i)).map(say);
  const parts = [['Decided', pick('decision')], ['Open to-dos', pick('todo', (i) => !i.done)], ['Done', pick('todo', (i) => i.done)],
    ['Open questions', pick('question')], ['Risks', pick('risk')], ['Left for this meeting', pick('next')]]
    .filter(([, xs]) => xs.length).map(([h, xs]) => `${h}: ${xs.join('; ')}`);
  if (!parts.length) return '';
  const s = `Last meeting (${name}):\n${parts.join('\n')}`;
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

// The line as the meeting keeps it: the words as they were written, in their
// list, with what it is at the end (#decision, #question, #risk, #idea,
// #next; a to-do gets its box, its owner and date). The margin's sentence
// stays in the margin. An answer takes the question's place.
export function keptLine(e, line) {
  if (e.kind === 'answer') return `${/^\s*/.exec(line)[0]}${e.sentence.trim().replace(/\s+/g, ' ')}`;
  return markLine(line, e.kind, e);
}

// Every line's minutes the margin wrote and nobody let go, kept (as ⌃↩
// would), from the last line up. Lines written as minutes already, and
// answers, stay as they are.
export function keepAll(text, entries) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = lines[i].trim() && entries.get(lines[i].trim());
    if (!e || e.state !== 'done' || e.fixed || e.kind === 'answer' || !e.sentence.trim()) continue;
    const { from, to, insert } = keepEdit(text, i, e);
    text = text.slice(0, from) + insert + text.slice(to);
  }
  return text;
}

// Keeping it: the edit to the note — line i becomes the kept line, where it
// is. With the cursor on that line it goes to the kept line's end.
// → { from, to, insert, caret }.
export function keepEdit(text, i, e, at = -1) {
  const lines = text.split('\n');
  let from = 0;
  for (let k = 0; k < i; k++) from += lines[k].length + 1;
  const to = from + lines[i].length;
  const insert = keptLine(e, lines[i]);
  let caret = from + insert.length;
  if (at > to) caret = at + insert.length - (to - from);
  else if (at >= 0 && at < from) caret = at;
  return { from, to, insert, caret };
}

// The time it took, as people read it.
// Settings' status of the live margin (server.js liveStatus) as lines to
// show → [{ text, warn }].
export function statusLines(r, now = Date.now()) {
  if (!r?.agent) return [{ text: 'No Claude Code agent: add one in Settings \u2192 Agents (its command is claude).', warn: true }];
  const ago = (t) => { const m = Math.round((now - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const sign = r.signIn?.ok === true ? ' \u00b7 signed in' : r.signIn?.ok === false ? ` \u00b7 ${r.signIn.message || 'not signed in'}${r.signIn.login ? ` (run ${r.signIn.login})` : ''}` : '';
  const out = [{ text: `Agent: ${r.agent}${r.chosen ? '' : ' (automatic)'} \u2014 runs \u201c${r.bin}\u201d${sign}`, warn: r.signIn?.ok === false }];
  const x = r.session;
  if (x?.error) out.push({ text: `Session: ended \u2014 ${x.error}`, warn: true });
  else if (!x?.up) out.push({ text: r.on ? 'Session: starting\u2026' : 'Session: not running (it starts when the live margin is on).', warn: false });
  else {
    const stuck = x.busy > 15000;
    out.push({ text: `Session: up${x.ready ? '' : ' (warming up)'} \u00b7 ${x.turns} line${x.turns === 1 ? '' : 's'}${x.startedAt ? ` \u00b7 started ${ago(x.startedAt)}` : ''}${stuck ? ` \u00b7 waiting on a line for ${Math.round(x.busy / 1000)} s` : ''}`, warn: stuck });
  }
  if (x?.lastOkAt) out.push({ text: `Last answer ${ago(x.lastOkAt)}.`, warn: false });
  if (x?.lastError && (!x.lastOkAt || x.lastErrorAt > x.lastOkAt)) out.push({ text: `Last error ${ago(x.lastErrorAt)}: ${x.lastError}`, warn: true });
  return out;
}

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
  const remark = el('div', 'live-remark');
  const keys = el('div', 'live-keys', `${keepKey()} keep \u00B7 Esc not this`);
  const card = el('div', 'mnote live-note', el('div', 'live-body', chip, who, due, text, ms), remark, keys);
  card.show = (e) => {
    card.className = `mnote live-note k-${e.kind} s-${e.state}${e.offer ? ' offer' : ''}`;
    chip.textContent = e.state === 'kept' ? '\u2713 Kept' : KIND[e.kind];
    who.textContent = e.owner ? `@${e.owner}` : '';
    due.textContent = e.due ? `\u{1F4C5} ${e.due.slice(5).replace('-', '/')}` : '';
    const t = e.t;
    ms.textContent = t.first ? `${secs(t.first - t.stop)} \u00B7 ${t.done ? secs(t.done - t.stop) : '\u2026'}` : '';
    text.textContent = e.sentence || (e.state === 'error' ? e.error || 'No answer' : '');
    card.title = e.sentence || '';
    remark.textContent = e.remark ? `\u21B3 ${e.remark}` : '';
    remark.hidden = !e.remark || e.state === 'kept';
    keys.hidden = !e.offer;
  };
  return card;
}

// The corner: how quick it is (each line: from the last key to the first
// word, and to the whole line), the median and p90 so far, and the cost.
export function liveHud() {
  const last = el('span', 'live-hud-last');
  const stats = el('span', 'live-hud-stats');
  const ctx = el('span', 'live-hud-ctx');
  const model = el('span', 'live-hud-model');
  const hud = el('div', 'live-hud', el('span', 'live-hud-dot'), el('b', null, 'Live margin'), model, ctx, last, stats);
  hud.show = (s) => {
    // The model that wrote the last line (as the CLI says), else the one asked for.
    model.textContent = s.model ? `${String(s.model).replace(/^claude-/, '').replace(/-\d{8}$/, '')}${s.effort ? ` \u00b7 ${s.effort}` : ''}` : '';
    model.title = s.model ? `Model: ${s.model}${s.effort ? `, effort ${s.effort}` : ''}` : '';
    hud.classList.toggle('busy', !!s.busy);
    ctx.textContent = s.context ? `knows ${s.context}` : '';
    ctx.title = s.context ? 'The other notes of this project the margin is told about (not private ones)' : '';
    last.textContent = s.note || (s.last ? `first ${secs(s.last.first)} · line ${secs(s.last.line)}` : 'waiting for a line…');
    last.classList.toggle('live-hud-warn', /Settings/.test(s.note || ''));
    const firsts = s.times.map((x) => x.first);
    const lines = s.times.map((x) => x.line);
    stats.textContent = s.times.length
      ? `median ${secs(quantile(firsts, 0.5))} / ${secs(quantile(lines, 0.5))} · p90 ${secs(quantile(firsts, 0.9))} / ${secs(quantile(lines, 0.9))} · ${s.times.length} lines · $${s.cost.toFixed(4)}`
      : '';
    hud.dataset.times = JSON.stringify({ times: s.times, cost: s.cost, calls: s.calls, cancelled: s.cancelled });
  };
  return hud;
}
