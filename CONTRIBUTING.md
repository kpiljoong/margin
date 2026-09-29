# Contributing

Thanks for looking. Bug reports and ideas are welcome as [issues](../../issues/new/choose); pull requests too, ideally after a short issue so we can agree on the direction first.

## Setup

```bash
npm install
npm start        # the desktop app, from this folder
npm run demo     # browser mode with sample notes and an offline demo agent
```

Node.js 22 or newer for the checks below (the app itself runs on 18+). `npm start` uses its own code, not the installed app's; if Margin is already running it hands over to it, so quit the installed app first.

## Checks

```bash
npm run lint     # ESLint
npm test         # unit tests (node --test): the flow notation, shortcuts, code updates
npm run smoke    # the app in Electron with a throwaway workspace: notes, canvas, links, presenting, a review
```

CI runs the tests on macOS, Windows and Linux for every push and pull request, and all three before a release.

## How the code is laid out

- `desktop/` — the Electron shell. `boot.js` and `codepack.js` stay fixed in the installed app and verify signed code updates; changing them (or Electron) needs a new app download, so bump `marginShell` in `package.json`.
- `server.js`, `lib/` — the local server (127.0.0.1 only): files, search, git, agent runs and staged copies.
- `public/` — the app itself, plain ES modules with no build step and no runtime dependencies.
- `docs/` — [user guide](docs/GUIDE.md), [flow notation](docs/FLOW.md), [product notes](docs/PRODUCT.md).

## Ground rules

- Notes stay plain Markdown files; nothing the app needs is hidden in them.
- Nothing leaves the machine unless the user runs an agent or asks for an update check.
- No new runtime dependencies without a good reason.
- Keep changes focused, and add a test or a smoke check when you fix a bug.

By contributing you agree your work is released under the [MIT License](LICENSE).
