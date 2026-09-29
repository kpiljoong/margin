# Margin

A lightweight, local-first Markdown notes app where you and an AI agent work together.

- **Plain files.** Your notes are ordinary `.md` files in any folder — no database, no account, no sync.
- **Delegate, then review.** Ask an agent (Claude Code, Codex, or any CLI) to do something with your notes. It works on a copy; you review the diff and apply only the changes you want.
- **Private by default.** Nothing leaves your machine unless you run an agent (or turn on update checks), and notes marked `private: true` are never shared.
- **Fast editor.** Split preview, Mermaid diagrams (in notes or as `.mmd` files, copyable as images), themes, wiki links, backlinks, search, local git.
- **Diagrams you type.** A plain ```flow notation drawn as you write, on a canvas beside the editor that follows your cursor, links boxes of the same name, walks a flow with the keys and presents it full screen ([notation](docs/FLOW.md)).
- **Drawings.** Open and edit `.excalidraw` files, and embed them in notes with `![[sketch.excalidraw]]`. The Excalidraw editor ships inside the app, runs fully offline and is sandboxed away from your notes.

## Download

Get the latest build from [Releases](../../releases): macOS (`.dmg`), Windows (`.zip`), Linux (`.AppImage`). After that, **Check for Updates…** keeps the app current.

## Run from source

```bash
npm install
npm start        # desktop app
npm run demo     # browser mode with sample notes and an offline demo agent
```

Requires Node.js 18+. To use a real agent, install and sign in to the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex) CLI, then add it under **Agent › Manage Agents…**.

More: [docs/GUIDE.md](docs/GUIDE.md) (Korean) · [docs/PRODUCT.md](docs/PRODUCT.md)

## License

[MIT](LICENSE)
