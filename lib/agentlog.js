'use strict';
// Turn an agent's output into something a person can read. Claude Code
// (`--output-format stream-json`) and Codex (`exec --json`) print one JSON
// event per line; any other output is treated as plain text.
//
// Result: { format: 'claude'|'codex'|'text', activity: [{ kind, text }],
//           reply, error, usage: { input, cached, output, costUsd } | null, model }
// activity kinds: 'say' (agent message), 'tool' (read/edit/run…), 'text' (other output), 'error'.

const MAX_ACTIVITY = 400;

function oneLine(s, max = 160) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function parseAgentLog(text, workDir = '') {
  const out = { format: 'text', activity: [], reply: '', error: '', usage: null, model: '' };
  // Agents see absolute paths inside the staged copy; show them relative.
  const roots = [workDir, workDir && `/private${workDir}`].filter(Boolean).map((r) => r.replace(/\/?$/, '/')).sort((a, b) => b.length - a.length);
  const rel = (p) => { let s = String(p || ''); for (const r of roots) if (s.startsWith(r)) s = s.slice(r.length); return s; };
  // …also inside free text, e.g. a reply that links to "/…/runs/<id>/work/note.md".
  const relAll = (t) => roots.reduce((acc, r) => acc.split(r).join(''), String(t || ''));
  const add = (kind, t) => { if (t) out.activity.push({ kind, text: relAll(t) }); };
  let lastSay = '';

  const tool = (name, input = {}) => {
    const file = rel(input.file_path || input.path || input.notebook_path || '');
    switch (name) {
      case 'Read': return `Read ${file}`;
      case 'Edit': case 'MultiEdit': return `Edit ${file}`;
      case 'Write': return `Write ${file}`;
      case 'Glob': return `Find files ${oneLine(input.pattern, 60)}`;
      case 'Grep': return `Search “${oneLine(input.pattern, 60)}”`;
      case 'Bash': return `Run ${oneLine(input.command, 100)}`;
      case 'TodoWrite': return 'Update plan';
      case 'WebFetch': case 'WebSearch': return `${name} ${oneLine(input.url || input.query, 80)}`;
      default: return name;
    }
  };
  const unwrapShell = (cmd) => {
    const inner = String(cmd || '').replace(/^\S*sh -l?c\s+/, '');
    const m = /^(['"])([^'"]*)\1$/.exec(inner);
    return m ? m[2] : inner;
  };

  function claude(ev) {
    if (ev.type === 'system') { if (ev.subtype === 'init') { out.format = 'claude'; out.model = ev.model || out.model; } return true; }
    if (ev.type === 'assistant' && ev.message) {
      out.format = 'claude';
      for (const c of ev.message.content || []) {
        if (c.type === 'text' && c.text.trim()) { lastSay = c.text.trim(); add('say', oneLine(c.text, 300)); }
        else if (c.type === 'tool_use') add('tool', tool(c.name, c.input));
      }
      return true;
    }
    if (ev.type === 'user' || ev.type === 'rate_limit_event' || ev.type === 'stream_event') return true;
    if (ev.type === 'result') {
      out.format = 'claude';
      if (typeof ev.result === 'string') { if (ev.is_error) out.error = ev.result; else out.reply = ev.result.trim(); }
      if (ev.is_error && !ev.result && ev.subtype) out.error = ev.subtype;
      const u = ev.usage || {};
      out.usage = {
        input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
        cached: u.cache_read_input_tokens || 0,
        output: u.output_tokens || 0,
        costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null,
      };
      return true;
    }
    return false;
  }

  function codex(ev) {
    if (ev.type === 'thread.started' || ev.type === 'turn.started') { out.format = 'codex'; return true; }
    if ((ev.type === 'item.started' || ev.type === 'item.completed' || ev.type === 'item.updated') && ev.item) {
      out.format = 'codex';
      const it = ev.item;
      const done = ev.type === 'item.completed';
      if (it.type === 'agent_message' && done) { lastSay = String(it.text || '').trim(); add('say', oneLine(it.text, 300)); }
      else if (it.type === 'command_execution' && ev.type === 'item.started') add('tool', `Run ${oneLine(unwrapShell(it.command), 100)}`);
      else if (it.type === 'file_change' && done) for (const c of it.changes || []) add('tool', `${c.kind === 'add' ? 'Create' : c.kind === 'delete' ? 'Delete' : 'Edit'} ${rel(c.path)}`);
      else if (it.type === 'web_search' && ev.type === 'item.started') add('tool', `Web search ${oneLine(it.query, 80)}`);
      else if (it.type === 'mcp_tool_call' && ev.type === 'item.started') add('tool', `${it.server || 'tool'}: ${it.tool || ''}`);
      else if (it.type === 'error' && done) add('error', oneLine(it.message, 300));
      return true;
    }
    if (ev.type === 'turn.completed') {
      const u = ev.usage || {};
      out.usage = { input: u.input_tokens || 0, cached: u.cached_input_tokens || 0, output: u.output_tokens || 0, costUsd: null };
      return true;
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      out.format = 'codex';
      const msg = ev.error?.message || ev.message || 'error';
      let detail = msg;
      try { detail = JSON.parse(msg)?.error?.message || msg; } catch { /* plain message */ }
      out.error = detail;
      add('error', oneLine(detail, 300));
      return true;
    }
    return false;
  }

  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let ev = null;
    if (line[0] === '{') { try { ev = JSON.parse(line); } catch { /* not JSON */ } }
    if (ev && typeof ev.type === 'string' && (claude(ev) || codex(ev))) continue;
    add('text', oneLine(raw, 300));
  }
  if (out.format !== 'text' && !out.reply) out.reply = lastSay;
  out.reply = relAll(out.reply);
  out.error = relAll(out.error);
  if (out.activity.length > MAX_ACTIVITY) out.activity = [{ kind: 'text', text: `… ${out.activity.length - MAX_ACTIVITY} earlier steps` }, ...out.activity.slice(-MAX_ACTIVITY)];
  return out;
}

module.exports = { parseAgentLog };
