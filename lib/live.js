'use strict';
// The live margin (experimental): while a meeting is written, a fast model
// writes its minutes beside each line, a few words at a time. Not a run: no
// copy, no review; what it writes is only shown, and kept in the note only
// when the person takes it (Tab). It goes through the claude CLI the user
// signed in to, so this app holds no key: one resident session, kept open
// (the meeting so far is its context), a line at a time; a line still being
// written is interrupted when it changes.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODEL = 'haiku';
// Then a fresh session (warmed beforehand, told the last minutes): each turn
// adds its line to what every later one sends, and a context this small is
// below what the API caches, so a shorter one is cheaper.
const MAX_TURNS = 20;
const WARM_MS = 3500; // the CLI is ready this long after it starts (it says so only after a first message)
const RECENT = 6; // minutes a fresh session is told about

const SYSTEM = [
  'You keep the minutes of a meeting, in the margin of the note someone is typing while it happens.',
  'Each message gives the agenda item and one line they typed. Reply with exactly one line:',
  'a head in brackets, then the minutes for that line as one clean sentence.',
  'Head: [decision], [todo], [question], [risk] (something that may go wrong or blocks), [idea] (a proposal, not decided), [next] (left for a later meeting) or [note]. A todo names its owner and due date when the line says them: [todo @bob 2026-10-15].',
  'Rules:',
  '- The same language as the line: a Korean line gets Korean minutes, an English line English ones.',
  '- Keep names, numbers and dates; resolve shorthand from the meeting so far; never add facts.',
  '- Dates come from the calendar under Today.',
  '- A line from a list comes with the line it is under (Under:): read it in that light. Items under "to do before …:" are todos, due by the date the meeting set for it.',
  '- One head and one sentence of at most 20 words (two tasks in a line: one sentence). No markdown, no quotes.',
  'Examples:',
  'Line: 20th? mkt ok, support ok → [note] Marketing and support are ready for the 20th.',
  'Line: -> go w/ 20th → [decision] We launch on October 20.',
  'Line: ann: survey thurs → [todo @ann 2026-10-15] Ann sends the beta survey by Thursday.',
  'Line: store review can take a week → [risk] The store review may take a week and delay the launch.',
  '(after "launch is Oct 10") Under: before that we need: Line: - book the venue → [todo 2026-10-10] Book the venue before the October 10 launch.',
  'Line: \uC624\uD37C \uBC94\uC704\uB294 \uB2E4\uC74C \uD68C\uC758\uC5D0\uC11C → [next] \uC624\uD37C \uBC94\uC704\uB294 \uB2E4\uC74C \uD68C\uC758\uC5D0\uC11C \uB17C\uC758\uD55C\uB2E4.',
  'Line: \uBCF4\uB3C4\uC790\uB8CC \uD544\uC694? \uBBFC\uC218\uAC00 \uD655\uC778 → [todo @\uBBFC\uC218] \uBBFC\uC218\uAC00 \uBCF4\uB3C4\uC790\uB8CC\uAC00 \uD544\uC694\uD55C\uC9C0 \uD655\uC778\uD55C\uB2E4.',
  'Line: 20\uC77C\uB85C \uD655\uC815 → [decision] \uCD9C\uC2DC\uC77C\uC744 20\uC77C\uB85C \uD655\uC815\uD588\uB2E4.',
].join('\n');

// One line of the model's reply, as it streams: the head once its bracket
// closes, then the sentence. → { kind, owner, due, sentence, head }.
function parseReply(text) {
  const m = /^\s*\[([^\]\n]*)\]\s*/.exec(text);
  if (!m) return /^\s*\[/.test(text) ? { head: false, sentence: '' } : { head: true, kind: null, sentence: text.replace(/^\s+/, '').split('\n')[0] };
  const parts = m[1].trim().split(/\s+/);
  const kind = ['decision', 'todo', 'question', 'risk', 'idea', 'next', 'note'].includes(parts[0]?.toLowerCase()) ? parts[0].toLowerCase() : null;
  const owner = parts.find((p) => p.startsWith('@'))?.slice(1).replace(/[^\p{L}\p{N}_.-]/gu, '') || null;
  const due = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p)) || null;
  return { head: true, kind, owner, due, sentence: text.slice(m[0].length).replace(/\s*\n+\s*(?:\[[^\]\n]*\]\s*)?/g, ' ').replace(/\s*\[(?:decision|todo|question|risk|idea|next|note)\b[^\]\n]*\]\s*/gi, ' ').trimEnd() };
}

const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`);

class Session {
  constructor(bin, env, warmMs = WARM_MS) {
    this.turns = 0;
    this.cost = 0;
    this.ready = false;
    this.dead = false;
    this.job = null;
    this.waiting = [];
    this.context = null; // the meeting header it has been told
    const args = ['-p', '--model', MODEL, '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages',
      '--verbose', '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--no-session-persistence', '--disable-slash-commands',
      '--system-prompt', SYSTEM];
    const win = process.platform === 'win32';
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-live-'));
    this.cwd = cwd;
    this.startedAt = Date.now();
    this.warm = setTimeout(() => { this.ready = true; }, warmMs);
    this.warm.unref?.();
    this.child = spawn(win ? [bin, ...args].map(quote).join(' ') : bin, win ? [] : args, {
      cwd, env: { ...env, MAX_THINKING_TOKENS: '0' }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: win,
    });
    this.child.stdin.on('error', () => {});
    this.child.on('error', (e) => this._die(e.code === 'ENOENT' ? `“${bin}” was not found on your PATH.` : e.message));
    this.child.on('close', () => this._die('The live margin session ended.'));
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let j;
        try { j = JSON.parse(line); } catch { continue; }
        this._event(j);
      }
    });
  }

  _event(j) {
    if (j.type === 'system' && j.subtype === 'init') { this.ready = true; return; }
    const job = this.job;
    if (!job) return;
    if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.text) {
      if (!job.cancelled) {
        if (!job.firstAt) job.firstAt = Date.now();
        job.onText(j.event.delta.text);
      }
      return;
    }
    if (j.type === 'result') {
      this.job = null;
      this.turns++;
      const total = Number(j.total_cost_usd) || 0;
      const cost = Math.max(0, total - this.cost);
      this.cost = Math.max(this.cost, total);
      const u = j.usage || {};
      if (!job.cancelled) {
        job.onDone({
          ok: j.subtype === 'success', model: Object.keys(j.modelUsage || {})[0] || MODEL, cost,
          inTokens: u.input_tokens || 0, outTokens: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0,
          firstMs: job.firstAt ? job.firstAt - job.sentAt : null, doneMs: Date.now() - job.sentAt, waitMs: job.sentAt - job.askedAt, turn: this.turns,
        });
      }
      this._next();
    }
  }

  _write(obj) { try { this.child.stdin.write(`${JSON.stringify(obj)}\n`); } catch { /* closed */ } }

  // A line's minutes: onText(piece) as they come, onDone(info) at the end.
  // → cancel(): it is not wanted any more (the line changed).
  ask(text, onText, onDone) {
    const job = { text, onText, onDone, askedAt: Date.now(), cancelled: false };
    if (this.dead) { onDone({ ok: false, error: this.error }); return () => {}; }
    // Whatever was being written is old now.
    for (const w of this.waiting) w.cancelled = true;
    this.waiting = [job];
    if (this.job && !this.job.cancelled) this._interrupt();
    this._next();
    return () => {
      if (job.cancelled) return;
      job.cancelled = true;
      if (this.job === job) this._interrupt();
      this.waiting = this.waiting.filter((w) => w !== job);
    };
  }

  _interrupt() {
    this.job.cancelled = true;
    this._write({ type: 'control_request', request_id: `int${Date.now()}`, request: { subtype: 'interrupt' } });
  }

  _next() {
    if (this.job || this.dead) return;
    const job = this.waiting.shift();
    if (!job) return;
    if (job.cancelled) { this._next(); return; }
    this.job = job;
    job.sentAt = Date.now();
    this._write({ type: 'user', message: { role: 'user', content: job.text } });
  }

  _die(error) {
    if (this.dead) return;
    this.dead = true;
    setImmediate(() => this.onEnd?.());
    clearTimeout(this.warm);
    this.error = error;
    const jobs = [this.job, ...this.waiting].filter((j) => j && !j.cancelled);
    this.job = null;
    this.waiting = [];
    for (const j of jobs) j.onDone({ ok: false, error });
    // At once: the server may be exiting (shutdown) right after.
    try { fs.rmSync(this.cwd, { recursive: true, force: true }); } catch { /* gone */ }
  }

  close() {
    this.closed = true;
    this._die('closed');
    try { this.child.stdin.end(); } catch { /* closed */ }
    setTimeout(() => { try { this.child.kill(); } catch { /* gone */ } }, 1500).unref();
  }
}

// The resident session: started with the app while the live margin is on
// (warm()), kept open however long it waits (a session waiting costs
// nothing), started again if it ends, and handed from meeting to meeting —
// a meeting it was not on gets a fresh session (warmed beforehand) told that
// meeting's last minutes, as does a session grown long.
function liveMargin({ bin, env, warmMs = WARM_MS, retryMs = 2000 }) {
  let s = null; // the session lines go to
  let spare = null; // a fresh one, warming
  let key = null; // the meeting s is on
  let wanted = false; // on: kept up
  let retry = null;
  let tries = 0;
  const rooms = new Map(); // meeting → its last [line, minutes]
  const fresh = () => {
    const x = new Session(bin, env, warmMs);
    x.onEnd = () => { if (wanted && !x.closed) again(); };
    return x;
  };
  // It ended by itself (a crash, a sign-out): up again, a little later each time.
  const again = () => {
    if (retry || !wanted || tries >= 6) return;
    const wait = Math.min(60000, retryMs * 2 ** tries++);
    retry = setTimeout(() => { retry = null; if (wanted) up(); }, wait);
    retry.unref?.();
  };
  const up = () => {
    if (spare?.dead) spare = null;
    if (!s || s.dead) { s = spare && !spare.dead ? spare : fresh(); spare = null; key = null; }
    return s;
  };
  const stop = () => {
    wanted = false;
    clearTimeout(retry);
    retry = null;
    s?.close();
    spare?.close();
    s = spare = key = null;
  };
  const state = () => ({ ready: !!s?.ready, startedAt: s?.startedAt || null, turns: s?.turns || 0, error: s?.dead ? s.error : null });
  const warm = () => { wanted = true; tries = 0; up(); return state(); };
  const start = (k) => { warm(); if (key == null && !s.turns) key = k; return state(); };

  // { key, title, agenda: [titles], item, line } → streams through onText; onDone(info).
  function line(req, onText, onDone) {
    wanted = true;
    up();
    if (key !== req.key) {
      // Another meeting: a session that has heard none of this one.
      if (s.turns && spare?.ready && !s.job) { s.close(); s = spare; spare = null; }
      else if (s.turns && !spare) spare = fresh();
      if (!s.turns) key = req.key;
    }
    if (key === req.key && s.turns >= MAX_TURNS - 5 && !spare) spare = fresh();
    if (key === req.key && s.turns >= MAX_TURNS && spare?.ready && !s.job) { s.close(); s = spare; spare = null; }
    const same = key === req.key;
    const room = rooms.get(req.key) || [];
    const header = `Meeting: ${req.title || 'untitled'}${req.agenda?.length ? `\nAgenda: ${req.agenda.join('; ')}` : ''}\nToday: ${req.today || new Date().toDateString()}`;
    const parts = [];
    if (!same) parts.push('Another meeting now: the lines before were not from it.');
    if (!same || s.context !== header) {
      parts.push(header);
      if ((!s.turns || !same) && room.length) parts.push(`Minutes so far:\n${room.map(([, m]) => `- ${m}`).join('\n')}`);
      s.context = header;
    }
    parts.push(`Item: ${req.item || '(none)'}\n${req.under ? `Under: ${req.under}\n` : ''}Line: ${req.line}`);
    const x = s;
    let said = '';
    return x.ask(parts.join('\n\n'), (t) => { said += t; onText(t); }, (info) => {
      if (info.ok) {
        tries = 0;
        const r = parseReply(said);
        if (r.sentence) {
          rooms.delete(req.key);
          rooms.set(req.key, [...room, [req.line, r.sentence]].slice(-RECENT));
          if (rooms.size > 30) rooms.delete(rooms.keys().next().value);
        }
      }
      onDone({ ...info, cold: x.turns <= 1 });
    });
  }

  return { warm, start, line, stop, state, get session() { return s; } };
}

module.exports = { liveMargin, parseReply, SYSTEM, MODEL };
