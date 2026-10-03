// One key, everywhere (like Emacs M-x): the leader key opens a small menu of
// the keys that can follow — groups of commands under a letter, as in
// which-key / LazyVim (f files, s search, w windows…). No modes to remember:
// the same keys follow it in the editor, the tree, the preview.
//
// The menu takes the focus while it is open, so the next key never types into
// the editor (nor starts an IME composition); keys are matched by their place
// on the keyboard, so they work in any input source.

// event → the key as the menu writes it: a, A (shift), 1, SPC, /, ., ,
export function menuKey(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return e.shiftKey ? c.slice(3) : c.slice(3).toLowerCase();
  if (/^Digit\d$/.test(c)) return c.slice(5);
  return { Space: 'SPC', Backquote: '`', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']' }[c] || null;
}

// A tree: [{ key, label, run } | { key, label, items: [...] }]. Entries with
// `when: () => false` are left out. Returns a promise that settles when the
// menu closes. isLeader(e): the leader key again (→ onLeader). onRun(keys, it):
// a command was chosen, by these keys.
export function openLeader(tree, { isLeader, onLeader, onRun, title = 'Commands', mount = document.body } = {}) {
  return new Promise((resolve) => {
    const before = document.activeElement;
    const box = document.createElement('div');
    box.className = 'leader';
    box.tabIndex = -1;
    box.setAttribute('role', 'menu');
    let path = [];
    const level = () => path.reduce((items, k) => items.find((x) => x.key === k)?.items || [], tree).filter((x) => !x.when || x.when());
    const draw = () => {
      box.replaceChildren();
      const head = document.createElement('div');
      head.className = 'leader-head';
      const labels = [title];
      let items = tree;
      for (const k of path) { const g = items.find((x) => x.key === k); labels.push(`${k} ${g.label}`); items = g.items; }
      head.textContent = labels.join('  ›  ');
      const hint = document.createElement('span');
      hint.className = 'leader-hint';
      hint.textContent = path.length ? '⌫ back · Esc close' : 'Esc close';
      head.append(hint);
      const grid = document.createElement('div');
      grid.className = 'leader-grid';
      for (const it of level()) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `leader-item${it.items ? ' group' : ''}`;
        row.dataset.key = it.key;
        const k = document.createElement('kbd');
        k.textContent = it.key;
        const l = document.createElement('span');
        l.textContent = it.items ? `+${it.label}` : it.label;
        row.append(k, l);
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', () => choose(it));
        grid.append(row);
      }
      box.append(head, grid);
    };
    const close = (restore = true) => {
      box.remove();
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
      if (restore && before?.isConnected) before.focus({ preventScroll: true });
    };
    const choose = (it) => {
      if (it.items) { path.push(it.key); draw(); return; }
      // Back where the keys came from first: the command may move the focus.
      close(true);
      resolve(it);
      onRun?.([...path, it.key], it);
      setTimeout(() => it.run(), 0);
    };
    const onKey = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (isLeader?.(e)) { close(true); resolve(null); setTimeout(() => onLeader?.(), 0); return; }
      if (e.key === 'Escape' || (e.ctrlKey && e.code === 'KeyG')) { close(true); resolve(null); return; }
      if (e.key === 'Backspace') { if (path.length) { path.pop(); draw(); } else { close(true); resolve(null); } return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = menuKey(e);
      const it = k && level().find((x) => x.key === k);
      if (it) { choose(it); return; }
      box.classList.remove('nope');
      void box.offsetWidth; // restart the shake
      box.classList.add('nope');
    };
    const onDown = (e) => { if (!box.contains(e.target)) { close(false); resolve(null); } };
    draw();
    mount.append(box);
    box.focus({ preventScroll: true });
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
  });
}

// Link hints (as in Vimium): a letter on every link in view; typing it
// clicks that link. Resolves with the link, or null.
export async function linkHints(root, selector = 'a[href], a.internal, .note-embed-head') {
  const view = root.getBoundingClientRect();
  const links = [...root.querySelectorAll(selector)].filter((a) => {
    const r = a.getClientRects()[0];
    return r && r.bottom > view.top && r.top < view.bottom && r.right > view.left && r.left < view.right;
  });
  const a = await pickHint(links.map((el) => { const r = el.getClientRects()[0]; return { left: r.left, top: r.top, value: el }; }));
  if (a) a.click();
  return a;
}

// Letters on places on the screen ({ left, top, value }, the first ones get
// the single letters); typing one picks that place. Resolves with its value,
// or null (Esc, a click, a letter that is on none).
const HINT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';
export function pickHint(points) {
  return new Promise((resolve) => {
    if (!points.length) { resolve(null); return; }
    const n = points.length;
    const two = n > HINT_KEYS.length;
    const labels = points.map((_, i) => (two ? HINT_KEYS[Math.floor(i / HINT_KEYS.length)] + HINT_KEYS[i % HINT_KEYS.length] : HINT_KEYS[i]));
    const layer = document.createElement('div');
    layer.className = 'link-hints';
    layer.tabIndex = -1;
    const marks = points.map((p, i) => {
      const m = document.createElement('span');
      m.className = 'link-hint';
      m.textContent = labels[i];
      m.style.left = `${p.left}px`;
      m.style.top = `${p.top}px`;
      layer.append(m);
      return m;
    });
    const before = document.activeElement;
    document.body.append(layer);
    layer.focus({ preventScroll: true });
    let typed = '';
    const done = (v) => {
      layer.remove();
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', cancel, true);
      if (before?.isConnected) before.focus({ preventScroll: true });
      resolve(v);
    };
    const cancel = () => done(null);
    const onKey = (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { done(null); return; }
      if (e.key === 'Backspace') typed = typed.slice(0, -1);
      else { const k = menuKey(e); if (!k || k.length !== 1) return; typed += k.toLowerCase(); }
      const hit = labels.indexOf(typed);
      if (hit >= 0) { done(points[hit].value); return; }
      let any = false;
      marks.forEach((m, i) => { const on = labels[i].startsWith(typed); m.hidden = !on; any ||= on; });
      if (!any) done(null);
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', cancel, true);
  });
}
