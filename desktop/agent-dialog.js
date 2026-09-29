'use strict';
(async () => {
  const { agents, defaultName, presets } = await window.agentSettings.get();
  let rows = agents.map((a) => ({ ...a }));
  let def = defaultName || rows[0]?.name || '';
  const list = document.getElementById('list');
  const error = document.getElementById('error');
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  function render() {
    list.replaceChildren();
    if (!rows.length) { list.append(el('div', { className: 'empty', textContent: 'No agents — delegation is off.' })); return; }
    rows.forEach((r, i) => {
      const radio = el('input', { type: 'radio', name: 'default', checked: r.name === def, title: 'Default agent' });
      radio.addEventListener('change', () => { def = r.name; });
      const name = el('input', { type: 'text', className: 'name', value: r.name, spellcheck: false, placeholder: 'Name' });
      name.addEventListener('input', () => { if (def === r.name) def = name.value; r.name = name.value; });
      const remove = el('button', { type: 'button', className: 'remove', textContent: 'Remove' });
      remove.addEventListener('click', () => { rows.splice(i, 1); if (def === r.name) def = rows[0]?.name || ''; render(); });
      const cmd = el('input', { type: 'text', className: 'cmd', value: r.command, spellcheck: false, placeholder: 'Shell command, e.g. my-agent --edit' });
      cmd.addEventListener('input', () => { r.command = cmd.value; });
      const bin = r.command.trim().split(/\s+/)[0];
      const preset = presets.find((p) => p.command === r.command) || presets.find((p) => p.bin === bin);
      const note = !preset ? 'Custom command' : preset.installed ? preset.detail : `${preset.detail} — “${preset.bin}” was not found on your PATH.`;
      list.append(el('div', { className: 'agent' }, radio, name, remove, cmd,
        el('span', { className: 'default-label', textContent: note })));
    });
  }

  const uniqueName = (base) => { let n = base; for (let k = 2; rows.some((r) => r.name.toLowerCase() === n.toLowerCase()); k++) n = `${base} ${k}`; return n; };
  const add = (name, command) => { const n = uniqueName(name); rows.push({ name: n, command }); if (!def) def = n; render(); list.lastElementChild?.querySelector(command ? '.name' : '.cmd')?.focus(); };
  const presetBox = document.getElementById('presets');
  for (const p of presets) {
    const b = el('button', { type: 'button', textContent: p.installed ? p.name : `${p.name} (not installed)`, title: `${p.detail}\n${p.command}` });
    b.addEventListener('click', () => add(p.name, p.command));
    presetBox.append(b);
  }
  document.getElementById('add-custom').addEventListener('click', () => add('Custom', ''));

  const save = async () => {
    const clean = rows.map((r) => ({ name: r.name.trim(), command: r.command.trim() }));
    const names = clean.map((r) => r.name.toLowerCase());
    if (clean.some((r) => !r.name || !r.command)) { error.textContent = 'Every agent needs a name and a command.'; return; }
    if (new Set(names).size !== names.length) { error.textContent = 'Agent names must be unique.'; return; }
    const ok = await window.agentSettings.set({ agents: clean, defaultName: def.trim() });
    if (!ok) error.textContent = 'Could not save these settings.';
  };
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('cancel').addEventListener('click', () => window.agentSettings.cancel());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.agentSettings.cancel();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  });
  render();
})();
