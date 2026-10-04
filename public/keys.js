// Keyboard shortcuts you can change (Settings → Keyboard shortcuts). The
// defaults are in shortcuts.json, which the desktop app's menu reads too; your
// changes are kept as { id: keys } — "" for none. Plain logic, tested without
// a page (test/keys.test.mjs).
//
// Keys are written like Electron accelerators, so the menu and the system-wide
// shortcut take them as they are: modifiers in the order CmdOrCtrl, Ctrl, Alt,
// Shift, then one key ("CmdOrCtrl+Shift+P", "Alt+Up", "F2"). On a Mac CmdOrCtrl
// is ⌘ and Ctrl is ⌃; elsewhere both are Ctrl, so Ctrl is written CmdOrCtrl.
// A key is matched by its place on the keyboard (event.code), so shortcuts work
// the same with any layout or input source (Korean, say).

const MODS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'];
const ALIASES = { cmd: 'CmdOrCtrl', command: 'CmdOrCtrl', commandorcontrol: 'CmdOrCtrl', cmdorctrl: 'CmdOrCtrl', mod: 'CmdOrCtrl', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' };
const NAMED = ['Up', 'Down', 'Left', 'Right', 'Enter', 'Space', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'];
const KEY_RE = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|[[\]\\,./;'`=-])$/;

// event.code → key name.
const CODES = {
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  Backquote: '`', Minus: '-', Equal: '=', Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace',
  Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
const keyOfCode = (code) => (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : CODES[code] || null);

const keyOfChar = (k) => {
  if (typeof k !== 'string') return null;
  if (k.length === 1) return KEY_RE.test(k.toUpperCase()) ? k.toUpperCase() : null;
  return CODES[k] || (/^F\d{1,2}$/.test(k) ? k : null);
};
const isKey = (k) => KEY_RE.test(k) || NAMED.includes(k);

// The key of a one-letter command (A, R, P …) as on a US keyboard: with
// another input source on, event.key is its letter (Korean: "\u3141" for A).
export const letterKey = (e) => (/^Key[A-Z]$/.test(e.code || '') && !/^[\x20-\x7e]$/.test(e.key) ? (e.shiftKey ? e.code[3] : e.code[3].toLowerCase()) : e.key);
const isFnKey = (k) => /^F\d{1,2}$/.test(k);

// The same keys written one way: "shift+cmd+p" → "CmdOrCtrl+Shift+P". Off a
// Mac, Ctrl is CmdOrCtrl. Returns "" for none, null when it isn't a shortcut.
export function normalize(keys, mac) {
  if (keys == null || keys === '') return '';
  const parts = String(keys).split('+');
  const raw = parts.pop();
  const mods = new Set();
  for (const p of parts) {
    const m = ALIASES[p.trim().toLowerCase()];
    if (!m) return null;
    mods.add(m === 'Ctrl' && !mac ? 'CmdOrCtrl' : m);
  }
  let key = raw.trim();
  key = key.length === 1 ? key.toUpperCase() : (NAMED.find((n) => n.toLowerCase() === key.toLowerCase()) || (/^f\d{1,2}$/i.test(key) ? key.toUpperCase() : key));
  if (key === 'Return') key = 'Enter';
  if (!isKey(key)) return null;
  return [...MODS.filter((m) => mods.has(m)), key].join('+');
}

// The keys a keydown event is, or null (a lone modifier; the ⌘ key off a Mac).
export function eventKeys(e, mac) {
  // Events made by scripts may have no code; then go by the character.
  const key = e.code ? keyOfCode(e.code) : keyOfChar(e.key);
  if (!key) return null;
  if (!mac && e.metaKey) return null;
  const mods = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl');
  if (mac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

// Can these keys be a shortcut? They need ⌘/Ctrl, ⌃ or ⌥ — Shift alone would
// get in the way of typing — except the F keys. Returns why not, or null.
export function unusable(keys, mac) {
  const k = normalize(keys, mac);
  if (!k) return 'Not a key combination.';
  const parts = k.split('+');
  const key = parts.pop();
  if (!parts.some((m) => m !== 'Shift') && !isFnKey(key)) return 'Add ⌘/Ctrl, ⌃ or ⌥ (or use an F key).';
  const sys = RESERVED.find((r) => normalize(r.keys, mac) === k && (!r.os || r.os === (mac ? 'mac' : 'other')));
  if (sys) return `Taken by the system (${sys.label}).`;
  return null;
}

// Keys the app leaves to the system and the Edit and View menus.
export const RESERVED = [
  { keys: 'CmdOrCtrl+Z', label: 'Undo' }, { keys: 'CmdOrCtrl+Shift+Z', label: 'Redo' }, { keys: 'CmdOrCtrl+Y', label: 'Redo', os: 'other' },
  { keys: 'CmdOrCtrl+X', label: 'Cut' }, { keys: 'CmdOrCtrl+C', label: 'Copy' }, { keys: 'CmdOrCtrl+V', label: 'Paste' },
  { keys: 'CmdOrCtrl+A', label: 'Select all' }, { keys: 'CmdOrCtrl+Alt+Shift+V', label: 'Paste and match style', os: 'mac' }, { keys: 'CmdOrCtrl+Q', label: 'Quit', os: 'mac' },
  { keys: 'CmdOrCtrl+H', label: 'Hide', os: 'mac' }, { keys: 'CmdOrCtrl+Alt+H', label: 'Hide others', os: 'mac' },
  { keys: 'CmdOrCtrl+M', label: 'Minimize' }, { keys: 'CmdOrCtrl+R', label: 'Reload' }, { keys: 'CmdOrCtrl+Shift+R', label: 'Force reload' },
  { keys: 'CmdOrCtrl+Alt+I', label: 'Developer tools', os: 'mac' }, { keys: 'CmdOrCtrl+Shift+I', label: 'Developer tools', os: 'other' },
  { keys: 'CmdOrCtrl+0', label: 'Actual size' }, { keys: 'CmdOrCtrl+=', label: 'Zoom in' }, { keys: 'CmdOrCtrl+Shift+=', label: 'Zoom in' },
  { keys: 'CmdOrCtrl+-', label: 'Zoom out' }, { keys: 'CmdOrCtrl+Ctrl+F', label: 'Full screen', os: 'mac' }, { keys: 'F11', label: 'Full screen', os: 'other' },
  { keys: 'CmdOrCtrl+`', label: 'Next window', os: 'mac' }, { keys: 'CmdOrCtrl+Space', label: 'Spotlight / input source', os: 'mac' },
  { keys: 'Ctrl+Space', label: 'Input source', os: 'mac' },
];

// Each shortcut's keys now: the default unless changed. { id: keys }.
export function effectiveKeys(defaults, custom, mac) {
  const out = {};
  for (const d of defaults) {
    const c = custom && Object.prototype.hasOwnProperty.call(custom, d.id) ? normalize(custom[d.id], mac) : null;
    out[d.id] = c ?? normalize(d.keys, mac) ?? '';
  }
  return out;
}

// Shortcuts in the find bar only act while finding, so they may share keys
// with the rest of the app; anything else would hide the other one.
const clash = (a, b) => (a === 'find' || b === 'find' ? ['find', 'editor'].includes(a) && ['find', 'editor'].includes(b) : true);

// The other shortcuts (ids) that already use these keys.
export function conflicts(defaults, keys, id, k, mac) {
  const want = normalize(k, mac);
  if (!want) return [];
  const scope = defaults.find((d) => d.id === id)?.scope;
  return defaults.filter((d) => d.id !== id && keys[d.id] === want && clash(scope, d.scope)).map((d) => d.id);
}

// What to store after changes: only what differs from the defaults.
export function customOnly(defaults, keys, mac) {
  const out = {};
  for (const d of defaults) if (Object.prototype.hasOwnProperty.call(keys, d.id) && keys[d.id] !== (normalize(d.keys, mac) ?? '')) out[d.id] = keys[d.id];
  return out;
}

// For people: "⌘⇧P" on a Mac, "Ctrl+Shift+P" elsewhere.
const MAC_SYMBOLS = { CmdOrCtrl: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const KEY_SYMBOLS = { Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↵', Backspace: '⌫', Delete: '⌦', Tab: '⇥', Space: 'Space' };
export function keyLabel(keys, mac) {
  const k = normalize(keys, mac);
  if (!k) return '';
  const parts = k.split('+');
  const key = parts.pop();
  if (mac) {
    const order = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift']; // as the app has always written them (⌘⇧P)
    return order.filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]).join('') + (KEY_SYMBOLS[key] || key);
  }
  return [...parts.map((m) => (m === 'CmdOrCtrl' ? 'Ctrl' : m)), KEY_SYMBOLS[key] && key !== 'Enter' && key !== 'Space' ? KEY_SYMBOLS[key] : key].join('+');
}
