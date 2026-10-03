# Margin — Product direction (v0.1)

## The idea: the text is yours, the margin is the agent's

An agent works on your notes the way an editor works on a manuscript: it writes **in the margin** — marks, suggestions, a reason beside them — and the text itself changes only when you accept a mark. The name says it.

### Principle 1 — Every change is reviewed

Whatever would change your notes comes through the same review, change by change, before it is yours: a run you delegated, an agent working in the folder from a terminal or another editor (*Changed outside*), and later git pull and sync too. Nothing has its own way in.

*Today:* agent runs, changes from outside, your own suggestions (tracked changes, for a meeting) and renaming, moving and trashing files by editing a folder as text (dired) go through it (hunk by hunk, 3-way merge, undo), drawn on the note with the red pen — yours in blue: struck through, written in above a caret, the reasons in the margin. git pull and sync are next.

### Principle 2 — Everything is a note

What shapes Margin is plain Markdown in the folder, readable and editable anywhere, kept with git: recipes (your commands, `RECIPES.md`), the instructions for agents (`AGENTS.md`), tasks (`- [ ]` in any note), and the record of what agents did. Extending Margin means writing text and handing it to an agent — the agent takes the place Emacs gives to elisp. No plugins, no code that runs.

*Today:* recipes, `AGENTS.md`, your own leader keys (`LEADER.md`) and tasks are notes. Settings live in the app's config file and runs in `.agent-notes/runs/` (text and JSON); making them notes is the direction.

### Principle 3 — Agent proposes, you decide

The agent never writes to your notes. It proposes, on a copy; you pick what to take, and can take it back.

*Today:* the Red pen and Comments only recipes ask the agent for margin notes instead of edits; they are kept with the run, never in the note, and a suggested text reaches the note only when you accept its mark.


## One-line definition

**A lightweight local notes app that treats a plain Markdown folder as a VS Code-style workspace, lets you hand work to AI agents, and lets you pick and accept the results "like reviewing a PR".**

## Who it is for

- People who already write notes/docs in Markdown and share the same files with git, grep, and other editors (developers, researchers, technical writers, PMs).
- People who want to use agents (CLI agents like Claude Code) on their notes too, but are **uneasy letting an agent rewrite their notes directly**.

## Problem

1. AI features in existing notes apps are either "chat window + copy-paste" or agents overwriting files directly. There is no flow where a person **sees what changed and accepts only part of it**.
2. Handing an agent a whole folder **hands over personal notes too**. What gets shared is invisible.
3. When a person and an agent touch **the same file at the same time**, one side's work silently disappears.
4. Obsidian/Notion-style apps are heavy or tied to proprietary formats/sync, and VS Code is too big for notes.

## Differentiators (in order of importance)

1. **Staged delegation + per-hunk review.** The agent always works in a *copy (staging)*. Results are shown with checkboxes per file and per change chunk (hunk), and only what the person selects is applied to the real files. Since these are Markdown notes, the **rendered post-apply result (Result)** can be viewed right next to the diff.
2. **Privacy with visible sharing scope.** Before a run, the scope ("this note / this folder / everything") and the *actual list of files to be sent* are shown. Notes marked with `private: true` front matter or `.agentnotesignore` are never copied. All rules are plain text, managed with git.
3. **Concurrent human and agent work.** If a person edits the same file while the agent works, a 3-way merge applies non-overlapping changes as-is and locks only overlapping hunks. The person's edits are never overwritten.
4. **Reversible + audit trail.** An applied run can be restored byte-for-byte with "Undo apply" (refused if the person edited again after applying). Deletions go to the trash. Every run's prompt, log, originals, and proposal remain in `.agent-notes/runs/`.
5. **Iteration (follow-up).** Before applying, a follow-up instruction like "shorter TL;DR" makes the agent continue on top of *its own proposal*, and the review always shows a single "original → final proposal" view.
6. **Agent-neutral.** Not tied to any particular service. The agent is a single shell command the user explicitly specifies (`--agent "..."`). The app itself uses no network at all.
7. **Lightweight.** App code has zero runtime dependencies (exception: isolated bundles loaded only when needed, mermaid and Excalidraw), 127.0.0.1 only. Files are just `.md`. The desktop app (Electron) and browser mode share the same code.

## The vertical slice chosen for the MVP, and why

Of three flows (document editing / search and navigation / agent delegation and review), we focused on making **"hand off to an agent → review changes → apply selectively"** work end to end.

- Editing and search already have many good tools, so they are not a *differentiator*. "Trustworthy delegation", on the other hand, is an empty slot and a reason to write a new notes app in the age of agents.
- Still, the delegation flow is unusable without the basics of **opening, finding, and re-editing the notes you delegate**. So editing (split preview, list auto-continuation, checkbox toggling, conflict detection) and navigation (file tree, fuzzy Quick Open, full-text search, outline, backlinks, `[[wikilink]]`) were included only up to "Sublime-level lightweight basics".
- Accounts, sync, plugins, real-time collaboration, and mobile were deliberately excluded.

## Trust and privacy principles

| Principle | Implementation |
|---|---|
| Nothing shared by default | Agents are enabled only when specified with `--agent`. The app's only external network call is an update check the user enables or requests (no note content) |
| What is shared is visible | File list and exclusion list shown before a run, recorded in the run history |
| The person decides | staging → diff → selective apply. Originals are unchanged before apply |
| Never overwrite the person's edits | Hash-based stale detection, 3-way merge, 409 conflict banner on save |
| Reversible | Undo apply, deletions to trash, pre-apply backups |
| Even the local server is safe | 127.0.0.1 binding, random token per launch, Host header check (DNS rebinding protection), strict CSP, no remote image loading, path-escape and symlink blocking |

**Honest limits:** staging is convenience isolation, not a security sandbox. Agent commands run with the user's privileges, so they could access other files via absolute paths if they wanted to. Only trusted agents should be specified, and if the agent uses a cloud model, shared notes are sent to that service (stated in the UI and README).

## Desktop shell: why Electron

Tauri (2.0 stable) produces a much smaller app, but we judged Electron the right fit for this product.

- **The backend is Node.** File I/O, running agent CLIs, and diff/merge all live in `server.js`. Electron runs this as-is on its built-in Node. Tauri would require rewriting in Rust or bundling a Node executable as a sidecar, which erases most of the size advantage.
- **Cross-OS consistency.** Electron ships Chromium. Tauri uses the OS webview (WebKit/WebView2/WebKitGTK), so rendering and API differences must be managed separately.
- **Proven precedent.** The closest products, VS Code and Obsidian, have been proven on Electron for years.
- "Lightweight" comes from fast startup, a small UI, and minimal dependencies more than shell size. The server and UI are separate from the shell, so the shell alone can be swapped later if needed.

## Editor: what "light and fast, but for today" means

Principles followed while refining the editor in v0.2:

- **Keep zero dependencies.** Instead of CodeMirror, a layer that draws the same text (syntax colors, find highlights) is overlaid on a native `textarea`. IME, accessibility, spellcheck, and undo are left to the OS, so Korean input is stable and the code is small. The cost is that only color, background, and underline are available, so headings cannot be enlarged. Bold is therefore faked with `text-shadow`.
- **Measure, then fix.** Measured with 5,000 notes and a 1.5-million-character note. Switching link resolution to an O(1) index cut mode switching on large notes from 3.9 s to 0.6 s. Preview refresh frequency adapts to rendering cost, and very large documents use proportional estimation for scroll sync.
- **Push instead of polling.** File watching (fs.watch) is pushed to windows via SSE. Changes from other editors, git, and agents appear immediately, and polling for agent status was removed.
- **Notes stay plain files to the end.** Attachments are stored in `assets/` next to the note and linked by relative path. Renames rewrite links. Deletions go to the trash. Line endings (CRLF) and BOM are preserved.
- **Respect preferences, but make defaults good.** 10 themes with System auto-switching, Mono/Sans/Serif fonts and line width, autosave on by default, focus mode. Settings are stored only on the device.

## Added in v0.3

- **Agent profiles**: register multiple agents and choose one per task. Commands can be set only in the native settings window or the CLI (the web UI cannot change commands).
- **git integration (local only)**: change markers, diff, commit, note history and restore. Agent-applied changes are committed separately with the agent as author, so "who changed what" stays in the history. This extends the product's trust principles to history.
- **Split editing**, **quick capture (global shortcut)**, **multi-cursor (editing identical text simultaneously)**, **table auto-alignment**, **preview folding**.
- **Theme extensions**: accent color, System dark/light pairing, user theme JSON (color values only), line spacing.
- **Fewer permission prompts**: no keychain use, and the login shell runs only when there is an external agent.

## Added in v0.3.1

- **Real agent connections**: Claude Code (Sonnet) and Codex (GPT-6 Sol) presets. The review screen shows the agent's answer, step-by-step activity, and tokens/cost, so "what changed and why" and "how much it cost" are judged together. The model is chosen per task, but the web UI can choose only from an allowlist.
- **UI that explains failures**: CLI login status is checked in advance, and on failure the cause and fix command are shown. The demo agent says so when it doesn't understand a task instead of silently processing it.
- **Mermaid diagrams**: bundled in the app to render offline, inserted as images so the security policy was not relaxed. When an agent writes a diagram, it is shown as a picture right in the review's Result.

## Added in v0.4

- **Opening files**: Open File…, drag and drop onto window/Dock, Finder "Open With".
- **Safe in-app updates without code signing**: without an Apple signature, replacing the .app causes "damaged" errors or repeated permission prompts. So the app shell (Electron + launcher) stays untouched and only app code is downloaded into the user data folder.
  - Trust comes from our own Ed25519 signature instead of Apple. Every launch verifies down to per-file hashes.
  - Two failed boots roll back automatically.
  - Update checks happen only when the user enables them.
  - Chromium/Electron security patches still arrive via a new app download (`minShell`).
- **Back/forward (0.4.1)**: ⌘[ / ⌘] in the order files were opened, mouse back/forward buttons, toolbar ← →. Renamed files are followed and deleted files are skipped. The first change shipped as a code-only update.
- **Reveal in Finder (0.4.2)**: tree context menu (files and folders) and command palette. Same for Windows Explorer and Linux file managers. Only paths inside the workspace are allowed.

## Added in v0.5

- **Excalidraw drawings**: view, draw, and autosave `.excalidraw` files. External changes follow the same conflict handling as notes. Putting `![[drawing.excalidraw]]` in a note shows it as an image. Obsidian's `.excalidraw.md` is read-only for now.
- **How the exception to the principle was contained**: a home-built drawing editor could not match Excalidraw in quality and compatibility. So the "zero dependencies" principle got an exception of **one isolated bundle** (user decision), with these conditions:
  - Loaded only when needed.
  - Placed in a sandboxed iframe (opaque origin) so it cannot reach the app, token, or API. The app does file I/O.
  - A dedicated CSP allows network only to 127.0.0.1.
  - Pinned version, SRI and per-file SHA-256, verified by CI.
  - No npm/CDN at runtime; even fonts are bundled (except CJK fonts, which use system fonts).
  - The shell didn't change, so it shipped as a code-only update.

- **Tab and split polish (0.5.1)**: scroll position kept when clicking the tree, draggable split divider (ratio remembered), drag a tab to the edge of the editor area to split, drag tabs to reorder (including across windows), Close to the right / Close all.
- **Copying drawings/diagrams and Mermaid files (0.5.2)**: zoom-to-fit when a drawing is first opened, copy the drawing's selection (or everything) as PNG/SVG (⧉, ⇧⌥C, ⋯, right-click), copy mermaid diagrams in notes as PNG (3x, theme background)/SVG (hover button, right-click), view and edit `.mmd`/`.mermaid` files as diagrams and embed with `![[x.mmd]]`. Allowing the app's clipboard write permission (`clipboard-sanitized-write`, app's own origin only) also fixed the existing Copy link. No shell change.
- **Enlarge, save, isolate (0.5.3)**: full-window view for diagrams/drawings (wheel zoom, drag to pan), save PNG/SVG to file (`assets/`), drawings in notes copied in original colors even in dark themes, new `.mmd` (choose a skeleton), HTML export and print. mermaid moved from the app page into a sandbox iframe, so it cannot reach the app's token, and CSP violations (inline style blocking that could skew measurements) are gone.
- **Diagrams written as text, and the canvas (0.5.4)**: so that in meetings, typing on the keyboard instead of drawing with the mouse shows the diagram live (user's idea). The ` ```flow ` notation (flowcharts written like text, trailing `!` as problem mark, name autocomplete, similar-name warning), `layout: figures` placing diagrams beside text per heading, and a canvas view beside the editor (pan/zoom, camera following the cursor, box click/rename, joining same-named boxes, following a flow by keys, full-screen presentation). The text is the source and the canvas is a view, so there is no new file format. `npm test` (node --test) added for pure logic. No shell change.
- **Resuming presentations (0.5.5)**: presentation starts from the box being followed or the cursor's box (Home = start), and continues from a box clicked during presentation. Fixed the 0.5.4 Links/`L` bug. No shell change.
- **Box notes and arrow labels (0.5.6)**: `:` describes the box; per-branch actions go on arrows. When different notes are attached to one box from several lines, each goes to its line's arrow label (previously only the last survived); `yes -(label)->` under a decision becomes `yes: label` (previously the label was dropped). No shell change.
- **flow docs and locating the current file (0.5.7)**: `docs/FLOW.md` (flow syntax, rules, tips). ◎ in the tree header shows the currently open file's location in the tree (user request). No shell change.
- **Review selection count (0.5.8)**: fixed a bug (since 0.3.1) where `Apply N selected` didn't update when checking change units one by one. No shell change.
- **Checks, Labs, canvas images (0.5.9)**: added `npm run lint` (ESLint, runtime-error rules only) and `npm run smoke` (launches Electron separately to check core flows) to CI. Labs in settings (stable drawing while typing flow diagrams, canvas wheel = pan) and tree following the opened file. Copy/save the whole canvas as one PNG/SVG. Agent recipe Draw as flow (appends notation guidance to the prompt when the task involves flow).
- **Rebinding shortcuts (0.5.9)**: Settings → Keyboard shortcuts now records keys by pressing them, warns on conflicts and offers to move them, restores defaults per item or all. Menu accelerators, editor shortcuts, and the global quick capture key follow one table (`public/shortcuts.json`). Saved to desktop `config.json` (changes only). Keys are recognized by `event.code`, so they work with the Korean IME too. main.js and preload.js are in the code package, so no shell change.
- **Presentation branches and captions (0.5.10)**: the branch is shown again before moving to the next branch (↩), and arrows to already-seen boxes become join (⤷) and loop (↺) steps. At a branch, the branch picked by number or click goes first. Captions show only explicit descriptions instead of sentences that contain the name: ` : ` and `- Box name: description` list items in the body (decision boxes with `?` match too). No shell change.

## Room to grow (by priority)

1. **Distribution**: signing and notarization, auto-update (with user consent). With signing, macOS permission grants persist across builds.
2. **Stronger isolation** — confine the agent to the staging folder with macOS `sandbox-exec`/containers, toggle for network access.
3. **Scheduled delegation** — scheduled runs like "tidy the inbox every Friday". Results always go to the review queue.
4. **Review quality** — line-level selection within hunks, auto-converting review comments into follow-up prompts, comparing runs.
5. **Better search** — inverted index, front matter queries, semantic search with local embeddings (nothing sent out).
6. **Deeper git** — branch switching, comparing commits, conflict resolution UI. Remote sync only when the user explicitly enables it.
7. **Editor** — adding multi-cursors at arbitrary positions, folding in the editing view. Consider switching to CodeMirror 6 to get past the limits of the layer approach.
