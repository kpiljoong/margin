// Color themes. Each theme is a flat set of CSS custom properties applied to
// :root, so switching is instant and needs no stylesheet reloads.
// Keys: UI surfaces (bg…border), semantic colors, diff tints, and `syn-*`
// colors used by the editor's Markdown highlighting and code blocks.

const base = {
  dark: {
    'add-bg': 'rgba(158, 206, 106, .13)', 'del-bg': 'rgba(247, 118, 142, .13)',
    'shadow': 'rgba(0, 0, 0, .45)', 'scheme': 'dark',
  },
  light: {
    'add-bg': 'rgba(63, 138, 44, .12)', 'del-bg': 'rgba(200, 50, 79, .10)',
    'shadow': 'rgba(0, 0, 0, .14)', 'scheme': 'light',
  },
};

export const THEMES = [
  {
    id: 'midnight', name: 'Midnight', kind: 'dark',
    vars: {
      bg: '#1b1d23', 'bg-2': '#21242b', 'bg-3': '#282c34', 'bg-hover': '#2f333d',
      fg: '#d7dae0', 'fg-dim': '#8b919e', 'fg-faint': '#5c6370', border: '#30343d',
      accent: '#7aa2f7', 'accent-2': '#bb9af7', ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e',
      'syn-heading': '#7aa2f7', 'syn-mark': '#5c6370', 'syn-strong': '#e8eaee', 'syn-em': '#c0caf5',
      'syn-code': '#9ece6a', 'syn-link': '#7dcfff', 'syn-url': '#5c6370', 'syn-quote': '#a9b1d6',
      'syn-list': '#e0af68', 'syn-tag': '#bb9af7', 'syn-keyword': '#bb9af7', 'syn-string': '#9ece6a',
      'syn-number': '#ff9e64', 'syn-comment': '#5c6370', 'syn-fm': '#737aa2',
    },
  },
  {
    id: 'paper', name: 'Paper', kind: 'light',
    vars: {
      bg: '#fbfbfa', 'bg-2': '#f3f3f1', 'bg-3': '#eaeae7', 'bg-hover': '#e4e4e0',
      fg: '#24262b', 'fg-dim': '#676b74', 'fg-faint': '#9a9ea6', border: '#dcdcd8',
      accent: '#3565d4', 'accent-2': '#7a4fd0', ok: '#3f8a2c', warn: '#a86b00', bad: '#c8324f',
      'syn-heading': '#2952b8', 'syn-mark': '#a3a7ae', 'syn-strong': '#111317', 'syn-em': '#45474d',
      'syn-code': '#2f7a32', 'syn-link': '#1f6fb2', 'syn-url': '#a3a7ae', 'syn-quote': '#5e636b',
      'syn-list': '#a86b00', 'syn-tag': '#7a4fd0', 'syn-keyword': '#7a4fd0', 'syn-string': '#2f7a32',
      'syn-number': '#b35900', 'syn-comment': '#9a9ea6', 'syn-fm': '#8a8fa0',
    },
  },
  {
    id: 'nord', name: 'Nord', kind: 'dark',
    vars: {
      bg: '#2e3440', 'bg-2': '#2a303b', 'bg-3': '#3b4252', 'bg-hover': '#434c5e',
      fg: '#e5e9f0', 'fg-dim': '#a3abb9', 'fg-faint': '#6b7589', border: '#3b4252',
      accent: '#88c0d0', 'accent-2': '#b48ead', ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a',
      'syn-heading': '#88c0d0', 'syn-mark': '#616e88', 'syn-strong': '#eceff4', 'syn-em': '#d8dee9',
      'syn-code': '#a3be8c', 'syn-link': '#81a1c1', 'syn-url': '#616e88', 'syn-quote': '#b0b8c6',
      'syn-list': '#ebcb8b', 'syn-tag': '#b48ead', 'syn-keyword': '#81a1c1', 'syn-string': '#a3be8c',
      'syn-number': '#d08770', 'syn-comment': '#616e88', 'syn-fm': '#7b88a1',
    },
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', kind: 'dark',
    vars: {
      bg: '#002b36', 'bg-2': '#00252f', 'bg-3': '#073642', 'bg-hover': '#0a4150',
      fg: '#c5ccc9', 'fg-dim': '#839496', 'fg-faint': '#586e75', border: '#0b3d4a',
      accent: '#268bd2', 'accent-2': '#6c71c4', ok: '#859900', warn: '#b58900', bad: '#dc322f',
      'syn-heading': '#268bd2', 'syn-mark': '#586e75', 'syn-strong': '#eee8d5', 'syn-em': '#93a1a1',
      'syn-code': '#2aa198', 'syn-link': '#268bd2', 'syn-url': '#586e75', 'syn-quote': '#93a1a1',
      'syn-list': '#b58900', 'syn-tag': '#d33682', 'syn-keyword': '#859900', 'syn-string': '#2aa198',
      'syn-number': '#cb4b16', 'syn-comment': '#586e75', 'syn-fm': '#6c71c4',
    },
  },
  {
    id: 'solarized-light', name: 'Solarized Light', kind: 'light',
    vars: {
      bg: '#fdf6e3', 'bg-2': '#f5eed9', 'bg-3': '#eee8d5', 'bg-hover': '#e6dfca',
      fg: '#3c4c53', 'fg-dim': '#657b83', 'fg-faint': '#93a1a1', border: '#e2dbc5',
      accent: '#268bd2', 'accent-2': '#6c71c4', ok: '#859900', warn: '#b58900', bad: '#dc322f',
      'syn-heading': '#268bd2', 'syn-mark': '#93a1a1', 'syn-strong': '#073642', 'syn-em': '#586e75',
      'syn-code': '#2aa198', 'syn-link': '#268bd2', 'syn-url': '#93a1a1', 'syn-quote': '#657b83',
      'syn-list': '#b58900', 'syn-tag': '#d33682', 'syn-keyword': '#859900', 'syn-string': '#2aa198',
      'syn-number': '#cb4b16', 'syn-comment': '#93a1a1', 'syn-fm': '#6c71c4',
    },
  },
  {
    id: 'dracula', name: 'Dracula', kind: 'dark',
    vars: {
      bg: '#282a36', 'bg-2': '#21222c', 'bg-3': '#343746', 'bg-hover': '#3c3f52',
      fg: '#f8f8f2', 'fg-dim': '#a4a8c0', 'fg-faint': '#6272a4', border: '#363949',
      accent: '#bd93f9', 'accent-2': '#ff79c6', ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555',
      'syn-heading': '#bd93f9', 'syn-mark': '#6272a4', 'syn-strong': '#ffb86c', 'syn-em': '#f1fa8c',
      'syn-code': '#50fa7b', 'syn-link': '#8be9fd', 'syn-url': '#6272a4', 'syn-quote': '#c3c6d8',
      'syn-list': '#ff79c6', 'syn-tag': '#ff79c6', 'syn-keyword': '#ff79c6', 'syn-string': '#f1fa8c',
      'syn-number': '#bd93f9', 'syn-comment': '#6272a4', 'syn-fm': '#6272a4',
    },
  },
  {
    id: 'gruvbox', name: 'Gruvbox Dark', kind: 'dark',
    vars: {
      bg: '#282828', 'bg-2': '#232323', 'bg-3': '#32302f', 'bg-hover': '#3c3836',
      fg: '#ebdbb2', 'fg-dim': '#a89984', 'fg-faint': '#7c6f64', border: '#3c3836',
      accent: '#83a598', 'accent-2': '#d3869b', ok: '#b8bb26', warn: '#fabd2f', bad: '#fb4934',
      'syn-heading': '#fabd2f', 'syn-mark': '#7c6f64', 'syn-strong': '#fbf1c7', 'syn-em': '#d5c4a1',
      'syn-code': '#b8bb26', 'syn-link': '#83a598', 'syn-url': '#7c6f64', 'syn-quote': '#bdae93',
      'syn-list': '#fe8019', 'syn-tag': '#d3869b', 'syn-keyword': '#fb4934', 'syn-string': '#b8bb26',
      'syn-number': '#d3869b', 'syn-comment': '#928374', 'syn-fm': '#8ec07c',
    },
  },
  {
    id: 'github-light', name: 'GitHub Light', kind: 'light',
    vars: {
      bg: '#ffffff', 'bg-2': '#f6f8fa', 'bg-3': '#eaeef2', 'bg-hover': '#e4e8ec',
      fg: '#1f2328', 'fg-dim': '#59636e', 'fg-faint': '#8c959f', border: '#d1d9e0',
      accent: '#0969da', 'accent-2': '#8250df', ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e',
      'syn-heading': '#0550ae', 'syn-mark': '#8c959f', 'syn-strong': '#1f2328', 'syn-em': '#424a53',
      'syn-code': '#0a3069', 'syn-link': '#0969da', 'syn-url': '#8c959f', 'syn-quote': '#59636e',
      'syn-list': '#953800', 'syn-tag': '#8250df', 'syn-keyword': '#cf222e', 'syn-string': '#0a3069',
      'syn-number': '#0550ae', 'syn-comment': '#6e7781', 'syn-fm': '#6639ba',
    },
  },
  {
    id: 'sepia', name: 'Sepia', kind: 'light',
    vars: {
      bg: '#f4ecd8', 'bg-2': '#ede3cb', 'bg-3': '#e5d9bd', 'bg-hover': '#ddd0b2',
      fg: '#433422', 'fg-dim': '#7a6650', 'fg-faint': '#a8957c', border: '#dccfb2',
      accent: '#a0522d', 'accent-2': '#7b5ea7', ok: '#5f7d2a', warn: '#a8741a', bad: '#b03a2e',
      'syn-heading': '#8b3f1d', 'syn-mark': '#b3a184', 'syn-strong': '#2e2316', 'syn-em': '#5c4a36',
      'syn-code': '#5f7d2a', 'syn-link': '#a0522d', 'syn-url': '#b3a184', 'syn-quote': '#7a6650',
      'syn-list': '#a8741a', 'syn-tag': '#7b5ea7', 'syn-keyword': '#8b3f1d', 'syn-string': '#5f7d2a',
      'syn-number': '#a8741a', 'syn-comment': '#a8957c', 'syn-fm': '#7b5ea7',
    },
  },
  {
    id: 'high-contrast', name: 'High Contrast', kind: 'dark',
    vars: {
      bg: '#000000', 'bg-2': '#0a0a0a', 'bg-3': '#1a1a1a', 'bg-hover': '#262626',
      fg: '#ffffff', 'fg-dim': '#d0d0d0', 'fg-faint': '#9a9a9a', border: '#6f6f6f',
      accent: '#ffd700', 'accent-2': '#00e5ff', ok: '#3fff3f', warn: '#ffb000', bad: '#ff5c5c',
      'syn-heading': '#ffd700', 'syn-mark': '#9a9a9a', 'syn-strong': '#ffffff', 'syn-em': '#e0e0ff',
      'syn-code': '#3fff3f', 'syn-link': '#00e5ff', 'syn-url': '#9a9a9a', 'syn-quote': '#d0d0d0',
      'syn-list': '#ffb000', 'syn-tag': '#ff8cff', 'syn-keyword': '#ff8cff', 'syn-string': '#3fff3f',
      'syn-number': '#ffb000', 'syn-comment': '#9a9a9a', 'syn-fm': '#00e5ff',
    },
  },
];

// ------------------------------------------------------------------ custom themes
// User themes are plain JSON: { "name", "kind": "dark"|"light", "vars": {...} }.
// Only color values are accepted (no url(), no expressions), so a shared
// theme file can never make the app fetch anything.
const VAR_KEYS = Object.keys(THEMES[0].vars);
const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\(\s*[-\d.%\s,/deg]+\)|transparent)$/i;
let custom = [];

export function setCustomThemes(list) {
  custom = (Array.isArray(list) ? list : []).map((t) => validateTheme(t, false)).filter(Boolean);
}

export function validateTheme(t, strict = true) {
  if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.vars || typeof t.vars !== 'object') {
    if (strict) throw new Error('A theme needs "name", "kind" and "vars"');
    return null;
  }
  const kind = t.kind === 'light' ? 'light' : 'dark';
  const fallback = themeById(kind === 'light' ? 'paper' : 'midnight').vars;
  const vars = {};
  for (const k of VAR_KEYS) {
    const v = t.vars[k];
    if (v === undefined) { vars[k] = fallback[k]; continue; }
    if (typeof v !== 'string' || !COLOR_RE.test(v.trim())) {
      if (strict) throw new Error(`"${k}" must be a color (got ${JSON.stringify(v).slice(0, 40)})`);
      vars[k] = fallback[k];
    } else vars[k] = v.trim();
  }
  const name = t.name.trim().slice(0, 40) || 'Custom';
  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}`;
  return { id, name, kind, vars, custom: true };
}

export function exportTheme(theme) {
  return JSON.stringify({ name: `${theme.name} (copy)`, kind: theme.kind, vars: theme.vars }, null, 2);
}

export const allThemes = () => [...THEMES, ...custom];
export const themeById = (id) => THEMES.find((t) => t.id === id) || custom.find((t) => t.id === id);

const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

// 'system' follows the OS, using the chosen light/dark pair.
export function resolveTheme(id, pair = {}) {
  if (id === 'system' || !themeById(id)) {
    const want = systemDark() ? (pair.dark || 'midnight') : (pair.light || 'paper');
    return themeById(want) || themeById(systemDark() ? 'midnight' : 'paper');
  }
  return themeById(id);
}

export function applyTheme(id, { pair, accent } = {}) {
  const theme = resolveTheme(id, pair);
  const root = document.documentElement;
  const vars = { ...base[theme.kind], ...theme.vars };
  if (accent && COLOR_RE.test(accent)) vars.accent = accent;
  for (const [k, v] of Object.entries(vars)) {
    if (k === 'scheme') root.style.colorScheme = v;
    else root.style.setProperty(`--${k}`, v);
  }
  root.dataset.theme = theme.id;
  root.dataset.kind = theme.kind;
  return theme;
}

export function onSystemThemeChange(cb) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}
