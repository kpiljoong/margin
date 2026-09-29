// Only mistakes that break at run time: a name used but never defined (the
// ReferenceErrors that shipped in 0.5.4 and 0.3.1), and a few like it. Style
// is left alone. Run with `npm run lint`; CI runs it before building.
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-const-assign': 'error',
  'no-redeclare': 'error',
  'no-import-assign': 'error',
  'no-unreachable': 'error',
};

export default [
  { ignores: ['node_modules/', 'dist/', 'out/', 'code-dist/', 'vendor/', 'public/vendor/'] },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules,
  },
  {
    files: ['public/mermaid-frame.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, mermaid: 'readonly' } },
  },
  {
    files: ['server.js', 'lib/**/*.js', 'desktop/**/*.js', 'scripts/**/*.js', 'build/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // The desktop dialogs' pages (desktop/*.html).
    files: ['desktop/agent-dialog.js', 'desktop/update-dialog.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['test/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules,
  },
];
