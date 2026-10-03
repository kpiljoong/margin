# Margin — User Guide

A lightweight, local-first workspace for plain Markdown folders. When you hand note work to an agent, the agent works **on a copy**, and you **review the result hunk by hunk and apply only what you pick**.

- Product direction, differentiators, why this MVP, roadmap: [docs/PRODUCT.md](PRODUCT.md)
- Runs as a desktop app (Electron) or in browser mode. The app code has no runtime dependencies (the only bundles shipped with the app are mermaid for diagrams and Excalidraw for drawings, both loaded only when needed), runs only on `127.0.0.1`, and uses no external network (the only exception is update checks the user turns on or requests).

## Running

### Desktop app (macOS / Windows / Linux, Electron)

```bash
npm install          # once (downloads Electron)
npm start            # run the app in development mode
```

- The menu also has the main commands (New Note ⌘N, Close Tab ⌘W, Settings ⌘,, Focus Mode, Choose Theme, etc.). ⌘W closes the tab, not the window; to close the window press ⌘⇧W.
- On first launch, choose **Open Folder…** (your Markdown folder), **Open File…** (a single note), or **Try Sample Notes** (sample notes + offline demo agent). The last opened folder reopens automatically on the next launch.
- Menus: **File › Open File… (⌘O) / Open Folder… (⌘⇧O) / Open Recent / Open Sample Notes / Reveal Folder in Finder**, **Agent › Choose Agent…**
- You can drag a note (`.md`, `.markdown`, `.mdx`, `.txt`) or folder onto the window or Dock icon, or use Finder's **Open With › Margin**. If the note is inside the open workspace folder or a recent folder, it opens there; otherwise the note's folder opens as the workspace and the note opens in a tab. Other files, such as images, dropped onto the note editor are attached.
- Agents are managed in the **Agent › Manage Agents…** window.
  - You can register several agents (Demo (offline), Claude Code, Codex, custom commands) and set a default. CLIs that aren't installed are shown as `(not installed)` in the presets.
  - Preset commands (pinned to cheaper models, no session history kept):
    - Claude Code: `claude -p --model sonnet --output-format stream-json --verbose --permission-mode acceptEdits --no-session-persistence` (shared notes are sent to Anthropic)
    - Codex: `codex exec --json -m gpt-6-sol -c model_reasoning_effort=low -s workspace-write --skip-git-repo-check --ephemeral --color never -` (shared notes are sent to OpenAI; writes are restricted to the copy folder)
    - Thanks to JSON output, the review screen shows **the agent's answer (Agent says)**, **step-by-step activity** (read/edit/run), and **tokens and cost**. Preset commands from older versions are replaced with the new commands automatically at app startup.
    - In the delegate dialog you can pick a **model per task** (Claude: Haiku/Sonnet/Opus, Codex: GPT-6 Luna/Sol). The server accepts only models on the list.
    - The delegate dialog and Agent panel check the CLI **login status** (`claude auth status`, `codex login status`) in advance and tell you if a login is needed.
    - To change the model, just change `--model`/`-m` in the command. To add another CLI agent as a preset, add one line to `AGENT_PRESETS` in `desktop/main.js` (requirements: runs non-interactively, takes the prompt on stdin, and edits files in the current folder).
  - The demo agent is not AI. It only understands keywords (tidy/summarize/tasks); for any other request it changes nothing and says so.
  - Registered agents are chosen per task in the delegate dialog.
  - The login shell's `PATH` is read only when an external CLI agent is configured (to find CLIs in `~/.nvm`, Homebrew, etc.).
- **Quick capture**: Even when the app is in the background, **⌃⌥N** (Windows: Ctrl+Alt+N) writes a line to the Inbox or today's journal. It can be turned off in the File menu.
- To reduce macOS permission prompts, the keychain is not used (`use-mock-keychain`). The app stores no cookies or passwords.
  - macOS treats every new unsigned build as a new app, so it may ask for folder access again.
- All web permissions are denied; the only exception is the app's own UI **writing** to the clipboard (`clipboard-sanitized-write`, for copying links and images). Reading the clipboard is not allowed.
- App settings are stored in `~/Library/Application Support/Margin/config.json` (macOS).

Building an installable app:

```bash
npm test             # pure-logic tests such as flow notation and cursor→figure resolution (node --test, no dependencies)
npm run smoke        # launch the app in Electron and check core flows (open note, canvas, Links, present, review & selective apply). Uses a separate config folder and temp notes only
npm run lint         # check for mistakes that break at runtime, like undefined names (ESLint, dev dependencies only). CI (Linux) runs lint, test, smoke before building
npm run pack         # dist/mac-arm64/Margin.app (runs directly, no install)
npm run dist         # .dmg / .zip in dist/ (Windows: nsis, Linux: AppImage)
```

- Builds are unsigned. An app you build yourself opens directly on this Mac, but distributing to other Macs requires Apple developer signing and notarization (only configuration needs to be added; intentionally not done). `publish: null` means build output is uploaded nowhere.
- Building on an exFAT external disk copies symlinks, making the app nearly twice as large (600MB). Output to an APFS disk: `npm run dist -- -c.directories.output=/tmp/agent-notes-dist` (normal size: .app about 290MB, .dmg about 128MB).

### Browser mode (Node only, no install needed)

```bash
npm run demo            # copy sample notes to a temp folder and run with the offline demo agent
node server.js ~/notes  # your notes folder (no agent)
node server.js ~/notes --agent "claude -p --model sonnet --output-format stream-json --verbose --permission-mode acceptEdits"
node server.js ~/notes --agent demo --agent "my-agent --edit"   # several: the first is the default
```

Open the `http://127.0.0.1:4321/?t=…` address (with token) printed in the terminal. Options: `--port <n>`, `--no-open`, `--agent <cmd|demo>`, environment variable `AGENT_NOTES_AGENT`.

Both modes use the same server and UI. The desktop app launches `server.js` as a child process with Electron's built-in Node, and shows its UI in a locked-down window (`contextIsolation`, `sandbox`, Node disabled, external URLs open in the OS browser).

## Core flow: delegate → review → apply

1. Open a note and press **⌘K** (or `✦ Ask agent`).
2. Write a task or pick a recipe (Tidy / Summarize / Extract tasks / Link notes / Proofread / Draw as flow), and set the scope (this note / this folder / everything). **The list of files that will actually be shared, and the files excluded as private,** is shown before running.
   - **Draw as flow**: Proposes a ` ```flow ` block drawing a process, flow, or system right after the text that describes it. If the task contains "flow", a summary of the flow syntax (`lib/flow-notation.md`) is passed to the agent too. The result is reviewed like any other task, and you apply only what you pick. If you select text before running, only that part is drawn.
3. The agent works on a copy in `.agent-notes/runs/<id>/work/`. Your original notes don't change meanwhile.
4. In the review tab, check items per file and per hunk, and inspect them as a **Diff** with word-level highlighting or as a rendered **Result** of how it will look after applying.
5. Apply with **Apply selected**. If you don't like it, give further instructions with **Follow up…** (the agent continues on top of its own proposal), or **Discard**.
6. Even after applying, **Undo apply** reverts exactly. If you've edited the file again since applying, the undo is refused to protect your edits.

If you edited the same file while the agent was working, a 3-way merge lets you apply only non-overlapping changes; overlapping hunks are locked.

**Reviewing by keyboard (as in magit).** The review tab takes the focus when it opens. `j`/`k` (or `n`/`p`, ↓/↑) step through the changes, `J`/`K` through the files, `g`/`G` first/last. `x` or Space picks or unpicks the change (`X` the whole file), `A`/`U` all/none. `a` applies, `d` discards, `f` follows up, `u` undoes an apply. `=` switches the file between Diff and Result, `o` or Enter opens the note at that change, `l` shows the log. A click works too and the keys go on from there. ⌥X a v opens the run that has waited longest for a look.

### Changes from outside (an agent in a terminal, another editor)

Agents don't have to run inside Margin: Claude Code or Codex can work in the notes folder directly. When another program changes a note while Margin is open, the status bar shows **↯ N changed outside**. Click it (or ⌥X a o) to review those changes like a run — from the text before the first change, change by change, with the same keys. Everything is kept unless you unpick it: **Undo 1, keep 3** (`a`) undoes the unpicked ones (the note must not have unsaved edits here) and marks the rest as seen. A note the other program changes back drops off by itself. The texts it replaced are in each note's local history as well. Notes it creates or deletes are not listed (the tree shows them).

## Privacy rules

The following notes are never copied to the agent, whatever the scope.

```markdown
---
private: true        # or  agent: never
---
```

```gitignore
# .agentnotesignore (workspace root, gitignore-style globs. ! negation patterns not supported)
private/
*.secret.md
```

Agent commands run with your user permissions. Staging is isolation for convenience, not a security sandbox, so only configure agents you trust. If an agent uses a cloud model, shared notes are sent to that service.

## Editor and notes

Built without external libraries to stay lightweight. The editor is a native `textarea` overlaid with a layer that draws the same text. This gives syntax coloring while the Korean IME, accessibility, and native undo keep working as-is. Coloring uses only color, background, and underline, so character widths never change and the cursor position stays exact even in proportional fonts (Sans/Serif).

| Shortcut | Action |
|---|---|
| ⌘P | Quick open: recent notes first, fuzzy search, create if missing. `>` commands · `#` jump to a heading in the current note · `@` a heading in any note · `:` line number |
| ⌘⇧P | Command palette |
| ⌥X | Leader key: a menu of commands by letter (see below) |
| ⌘⇧B | Switch note: the buffer list, most recent first (open notes, and notes closed this session) |
| ⌃6 | Back to the note before (Vim's alternate buffer; also ⌥X `` ` ``) |
| ⌥. | Repeat the last command (from the leader menu, the palette or a shortcut) |
| F3 / F4 | Keyboard macro: F3 starts recording, F4 stops; then F4 plays it (see below) |
| F8 / ⇧F8 | Next / previous search result, from the note: the match is selected, the results list follows |
| ⌘⇧F | Workspace full-text search (`#tag` search works too) |
| ⌘F / ⌘⌥F | Find / replace in note (case and regex options, ⌘G next). In Preview, ⌘F finds in the rendered note and stays in Preview; replacing switches to Split |
| ⌘K | Delegate to agent (focuses on the selected text, if any) |
| ⌘E | Switch Edit / Split / Canvas / Preview (Canvas for notes only) |
| ⌘, | Settings and themes |
| ⌘⇧↵ | Focus mode (text only, Esc to exit) |
| ⌘\\ | Toggle sidebar (drag the edge to resize) |
| ⌘B / ⌘I / ⌘⇧X | Bold / italic / strikethrough (wraps or unwraps the selection) |
| ⌘↵ | Toggle the task checkbox on the current line |
| ⌥↑ / ⌥↓, ⌘⇧D | Move line, duplicate line |
| Tab / ⇧Tab | Indent / outdent (works on multiple lines) |
| ⌘[ / ⌘] | Go to previous / next file (in the order opened, like a browser). The mouse back/forward buttons and the ← → buttons above the editor do the same |
| F2 | Rename / move the current note |
| ⌘D / ⌘⇧L | Add next occurrence of the word to selection / select all → type, delete, paste in several places at once (Esc to clear) |
| Tab / ⇧Tab (in a table) | Move to next / previous cell and auto-align table columns (⌘⌥T: align only) |
| ⌘⌥\\ | Split to the side / switch to the other pane |
| ⌘⇧G | Git panel |
| ⌃⌥N | Quick capture (desktop app, global) |

The shortcuts above (except typing behaviours like Tab, Enter, and bracket pairing) can be changed in **Settings → Keyboard shortcuts** (palette: `Keyboard shortcuts…`).
- Click **Change** on an item and press the key combination you want; it takes effect immediately. Esc cancels, **None** means no shortcut.
- It must include one of ⌘/Ctrl, ⌃, or ⌥ (F keys may be used alone). System keys such as copy, paste, and undo can't be used.
- If the key is already used by another function, a warning appears; **Use here** moves it here and leaves that function without a shortcut.
- ↺ resets that item only; **Reset all** resets everything to defaults.
- Keys are recognized by their physical position on the keyboard, so they work even in Korean input mode.
- In the desktop app they are stored in the app settings file (`shortcuts` in `config.json`, changes only), and the menu labels and the global quick capture key (⌃⌥N) change too. You're told if another app already holds a global key. In browser mode they are stored in that browser.
- Next/previous in the find bar (⌘G/⌘⇧G) only work while finding, so when the find bar is closed ⌘⇧G opens the Git panel.
- Inside an Excalidraw drawing, only the few keys the drawing frame passes through (default combinations like ⌘S, ⌘P) and shortcuts in the menu work.

**Leader key (⌥X, like Emacs M-x).** One key that works the same everywhere — editor, preview, tree, search results. It opens a small menu at the bottom listing the keys that can follow (as in which-key / LazyVim), so nothing needs to be memorized up front. The menu takes the focus, so the next key never types into the note, and keys go by their place on the keyboard (Korean input works). Esc or ⌃G closes, ⌫ goes up a level, Space (or ⌥X again) opens every command in the palette. Change the key in Settings → Keyboard shortcuts.

| Keys | |
|---|---|
| `f` files | `f` find a file · `n` new note · `t` from a template · `j` today's journal · `r` rename · `b` bookmark · `y` copy [[link]] · `l` show in the tree · `h` history · `e` export HTML |
| `s` search | `s` the workspace · `f` find in note · `r` replace · `h` heading here · `a` heading in any note · `l` go to line · `n`/`p` next/previous search result |
| `b` buffers | `b` switch note (most recent first) · `` ` `` the note before · `m` messages · `n`/`p` next/previous · `d` close · `o` close others · `[` `]` back/forward |
| `w` windows | `h` the sidebar · `l` the editor · `p` the preview · `w` the other pane · `v` split · `s` show/hide the sidebar · `z` focus mode |
| `m` mode | `e` Edit · `s` Split · `c` Canvas · `p` Preview |
| `l` links | `l` follow the link at the cursor · `f` pick a link in the preview · `b` back |
| `g` git | `g` the Git panel · `d` changes since the last commit · `h` this file's history |
| `a` agent | `a` delegate a task · `1`–`6` a recipe (Tidy, Summarize…) · `v` review the next run · `o` changes from outside · `r` agent runs |
| `t` toggles | `f` tree follows the tab · `s` sidebar · `t` theme · `z` focus mode |
| `q` macro | `q` start/stop recording · `r` play · `n` play N times · `e` play until it can't go on · `s` play at every search result · `v` show it |
| `.` | Repeat the last command (it shows which) |
| `,` / `k` | Settings / keyboard shortcuts |

**Buffers (as in Emacs and Vim).** A note you close is kept for the session with its cursor, scroll and undo history; opened again (from anywhere) it comes back as it was, as long as the file hasn't changed meanwhile (the 20 most recent are kept). ⌘⇧B / ⌥X b b lists the notes most recently used first — the one before this is at the top, closed ones are marked ○. ⌃6 or ⌥X `` ` `` switches back and forth between two notes. ⌥X b m shows the messages shown at the bottom so far (Enter copies one).

**Undo is the editor's own.** It survives switching tabs, Edit/Split/Preview and closing the note; a run of typing is one step (a pause, a new line or a new word after a space starts the next). A change from outside — another program or an agent editing the open note's file — is one step too: ⌘Z takes it back.

**Back and forward (⌘[ / ⌘]) return to the place**, not just the note, as Vim's jump list: the cursor and the scroll where you left. A jump inside a note (a heading from the outline or `#`, `:` a line, a search result) is a step too, so ⌘[ after jumping to a heading goes back to where you were typing.

**Keyboard macros (as in Emacs).** F3 starts recording (the status bar shows ● Recording), F4 stops; F4 again plays it where the cursor is now. What is kept is what the keys did: text typed (Korean too, as composed), deletions, cursor moves (characters, words with ⌥, line ends with ⌘←/→ or ⌃A/⌃E, up/down, pages, ⌘A), a find (⌘F, Enter, Esc: "the next match of …", counted from the cursor), Replace and Replace all in the find bar, cut/copy/paste (the macro's own clipboard: what this run cut), the editor's own keys (Enter continuing a list, Tab, ⌘B, ⌥↑…) and commands (⌥X, the palette, shortcuts like F8). Deleting a word or to the line's end is done again from where the cursor is then. Mouse clicks aren't recorded (you're told once).
- **Play until it can't go on** (⌥X q e): again and again, until a move hits the start or end of the note, a find finds nothing more, or a run changes nothing.
- **Play at every search result** (⌥X q s): searches again (open notes as they are, saved or not), then at each result selects the match and plays the macro once; in each note from the bottom up, so line numbers stay right. Record it starting from a selected match (F8 to the first one, F3, edit, F4); the result you edited while recording isn't found again if the edit removed the match.
- Only the last macro is kept, for this session. On a Mac, F3/F4 may need fn (or use ⌥X q q / q r).

**Without the mouse.** In the sidebar's lists (tree, bookmarks, outline, backlinks, search results): ↑↓ or `j`/`k` move, `g`/`G` (Home/End) jump to the ends, Enter opens (⌘Enter to the side), →/← or `l`/`h` open and close folders (← on a file goes to its folder), F2 renames, ⌘⌫ deletes (with Undo), Esc goes back to the editor. In the search box ↓ or Enter goes to the results. In a focused preview (⌥X w p): `j`/`k` scroll, `d`/`u` half a page, Space a page, `g`/`G` top/bottom, `/` find, `f` link hints (a letter on every link in view; type it to follow, as in Vimium), Esc back to the editor.

- **Split editing**: Open two notes side by side. Each pane has its own tabs and Edit/Split/Preview mode.
  - How to open: ⌘-click in the tree, ⌘↵ in quick open, ◫ in the toolbar, the tab context menu, and **dragging a tab onto the left or right half of the editor area** (the drop target is highlighted)
  - Drag the middle divider to resize the two panes (double-click for 50/50). The ratio is remembered.
  - Drag tabs to reorder them or move them to the other pane's tab bar or editor area. Closing a pane merges its tabs into the other pane.
  - Layout and tab order are remembered per workspace.
- **Tab context menu**: Close, Close others, Close to the right, Close all (tabs in that pane). Unsaved tabs ask before closing (saved first if autosave is on). The palette also has Close other tabs / Close all tabs.
- **10 themes**: Midnight, Paper, Nord, Solarized Dark/Light, Dracula, Gruvbox Dark, GitHub Light, Sepia, High Contrast. The default, System, switches between Midnight/Paper following the OS setting. In the palette's `Theme: choose…` you can preview with the arrow keys and cancel with Esc; you can also click ◐ in the status bar.
- **Theme extensions**:
  - Pick your own accent color
  - Choose the dark/light themes used in System mode (e.g. Nord at night, Sepia by day)
  - **User theme files**: JSON import/export. Only color values are allowed; values that could make external requests, like `url()`, are rejected.
- **Writing settings**: Font (Mono/Sans/Serif), size, line height, line width, autosave, syntax coloring, spell check. Settings are stored on this device only: in the desktop app they live in the app's settings file (`page` in `config.json`), together with layout, open tabs, recent notes and bookmarks, so a second copy of the app (which gets another port) starts with the same settings. In browser mode they are stored in that browser.
- **Autosave** (on by default): Saves 0.7 seconds after you stop typing. If another program changed the file in the meantime, it doesn't overwrite and shows a conflict banner. CRLF line endings and BOM are preserved.
- **Typing helpers**: Enter continues lists, tasks, and quotes; Enter on an empty item ends the list. Brackets and backticks are closed automatically. Typing `[[` autocompletes note names, `[[Note#` (or `[[#` for this note) its section headings, and `#` autocompletes existing tags. Pasting a URL with text selected makes `[text](URL)`.
- **Images and attachments**: Pasting or dropping saves the file in an `assets/` folder next to the note and inserts a relative link. Local images show in the preview, but **remote images are not loaded, to prevent tracking**. Clicking an image in the tree opens the image viewer.
- **Links and tags**: `[[wikilink]]` and relative links can be followed; clicking a link to a missing note creates it. `[[Note#Section]]` opens the note at that heading, and `[[#Section]]` goes to a heading in the same note (headings match without case or formatting; `[[Note#Section#Sub]]` goes to the last one, as in Obsidian). Relative links do the same with `other.md#section-slug`. The sidebar shows:
  - **Outline**: The section containing the cursor is highlighted.
  - **Backlinks** (Linked from)
  - **Unlinked mentions**: Places in other notes where this note's name is written without a link. The **Link** button turns it into `[[Name|original wording]]`.
  - **Tag list**: Counts both `tags:` in front matter and `#tag` in the body.
- **Note embeds**: `![[Note]]` shows another note in place, and `![[Note#Section]]` only that section (up to the next heading as high). Its diagrams and drawings are drawn too, it follows changes to that note, and it goes into HTML export and print. Click its label to open the note. A note embedded inside an embedded note stays a link (no loops).
- **Local history**: Margin keeps earlier versions of notes in `.agent-notes/history/` (ignored by git), so text can be brought back even in a folder without git. A version is kept when a save replaces text that is at least 5 minutes old, when another program changes the note (Claude Code, another editor, sync), before agent changes are applied or undone, before links are rewritten by a rename, and before restoring. Up to 50 per note; ones older than 30 days are removed, but the newest 5 always stay. They follow a renamed note. See them in ⋯ › **History…**.
- **Link hover preview**: Hovering a `[[link]]` in the preview shows the note — or only the section it names — in a small window (in the editor, hold ⌘/Ctrl while hovering). Click its title to open the note; typing, scrolling, or clicking elsewhere closes it.
- **Following links from the editor**: ⌘-click (Windows/Linux: Ctrl-click) a `[[link]]`, `[text](link)`, or URL in the editor to follow it (the pointer shows while ⌘ is held over one), as in the preview — a note opens (at its section), a missing note can be created, an image opens in the viewer, and web addresses open in the browser.
- **Bookmarks**: Right-click a file in the tree › **Bookmark** (palette: **Bookmark / remove bookmark for this file**). Bookmarked files are listed at the top of the tree; right-click one to move it up or down, show it in the tree, or remove the bookmark. They follow renames, go with a deleted file (and come back with Undo), and are remembered per workspace.
- **Templates**: Notes in the workspace's `templates/` folder are templates. Palette **New note from template…** (or right-click a folder › **New note from template here…**) makes a new note from one; **Insert template…** inserts one at the cursor. In the template, `{{title}}` becomes the note's name, `{{date}}` and `{{time}}` today and now, `{{date:dddd D/M}}`-style formats (YYYY YY MM M DD D HH H mm ss dddd ddd), `{{yesterday}}` and `{{tomorrow}}`, and `{{cursor}}` where the cursor goes. A new journal note (◷) uses `templates/Daily.md` (or `Journal.md`) if there is one. With templates, **+** in the tree offers a blank note or one of them. Templates' tags, headings and links don't count in the tag list, `@` headings or backlinks.
- **Labs**: Turn experimental features on and off in Labs at the bottom of Settings (⌘,). They may change or go away.
  - **Canvas: the wheel moves**: On the canvas, the wheel or two-finger scroll pans, and pinch or ⌘/Ctrl+wheel zooms. When off, the wheel zooms.
  - **Steady live drawing**: While typing inside a ` ```flow ` block, the drawing stays as is and is redrawn once the line is complete (not ending in an arrow or ` :`) and typing pauses briefly. Boxes don't jitter with every character.
- **Reveal current file**: **◎** in the tree header (palette **Show current file in the tree**) expands the open file's folder, scrolls to its row, and highlights it briefly. **Follow the active tab** (⇅ in the tree header, also in Settings and the palette; on by default, remembered): selecting a tab opens that file's folders in the tree, scrolls to it and highlights it briefly if the tree had to move. While the tree is hidden the folders are still opened, and the file is shown when the tree comes back. Turn it off to keep the tree where you left it.
- **Note management**: Right-click in the tree or use the ⋯ menu in the editor toolbar.
  - **Rename/move**: Works for folders too; `[[link]]`s and relative links pointing to the note are fixed automatically across the whole workspace.
  - **Delete**: Moves to the trash; can be restored with Undo in the notification.
  - Also: new folder, copy `[[link]]`.
  - **Reveal in Finder** (desktop app): Shows the file or folder selected in Finder. "Show in File Explorer" on Windows, "Open Containing Folder" on Linux. Also available for the current note from the command palette.
- **Live updates**: File watching (SSE) reflects changes made by other editors, git, or agents immediately. Clean tabs are reloaded; tabs with edits are marked as conflicts.
- **Export**: A standalone HTML file with styles and images (no tokens or internal paths), and print/save as PDF.
- **Heading folding**: In the preview, hovering a heading shows ▾; clicking it folds up to the next heading of the same level. The palette also has fold all/unfold all.
  - The editor uses a native textarea for speed and stable Korean input, and a textarea can't hide lines, so it doesn't support folding.
- **Preview**: Tables, task checkboxes (clicking toggles the source too), code block syntax highlighting (JS/TS, Python, Shell, Go, Rust, C/Java, SQL, CSS, etc.). ` ```mermaid ` blocks are drawn as diagrams (flowchart, sequence, class, state, gantt, pie, etc.). It uses the mermaid bundled with the app offline, draws in a sandbox iframe separated from the app UI and token, follows the current theme colors, and also applies to the review Result, HTML export, and print. Syntax errors are shown below the code block. The palette's **Insert Mermaid diagram…** inserts a flowchart, sequence, gantt, state, class, ER, mindmap, pie, or timeline skeleton. Editor and preview scrolling are synced line by line.
- **Callouts**: A quote starting with `[!type]` is a callout, as on GitHub and in Obsidian: `> [!warning] Title` on the first line, the body on the following `>` lines. Types are coloured by kind — note/info, tip/success, important/question/example, warning/caution, danger/error/bug, quote — and any other type is a note with its own name. `[!type]-` makes it folded (click the title to open), `[!type]+` foldable but open.
- **Pictures**: Clicking an image in the preview shows it over the app, fitted to the window (small images are not enlarged). **100%** (or a double-click, or the 1 key) shows every pixel, wheel/pinch zooms, drag pans. Esc or a click beside the picture closes it; **Open** opens the image file. An image that is a link follows the link instead.
- **View larger**: Clicking a diagram in the preview (or right-click → **View larger**) shows it enlarged to fit the whole window. Wheel or pinch zooms around the pointer, drag pans, and double-click toggles between fit and 100%. Keyboard: + − 0 (fit) 1 (100%), Esc to close. Wide diagrams cut off in a narrow window can be seen in full here too.
- **Copy/save diagrams as images**: Hovering a diagram shows a ⧉ button at the top right, which copies it to the clipboard as PNG (3x resolution). The context menu has **Copy as image (PNG)** / **Copy as SVG** / **Save as PNG…** / **Save as SVG…**. Copies are filled with the current theme's background, so they don't look transparent and empty in dark themes. Saving goes to `assets/` next to the file (blocks in a note become `note-diagram.png`, with `-1`, `-2` on name clashes). Drawings in notes (`![[x.excalidraw]]`) use the same menu, and are copied/saved in the drawing's own colors regardless of theme.
- **Mermaid files (`.mmd`, `.mermaid`)**: Opened from the tree (marked ◈), they show as a diagram rather than text (Preview by default). Editing the source in Edit / Split / Preview (⌘E) redraws immediately. The toolbar ⧉ copies PNG; the ⋯ menu has Copy embed, View larger, and PNG/SVG copy and save. Create new files from the palette's **New Mermaid diagram file (.mmd)…** or folder right-click **New Mermaid diagram here…** by choosing a skeleton (flowchart, sequence, etc.); they open in Split. Writing `![[flow.mmd]]` in a note embeds the diagram; clicking it opens the file, and it follows changes to the file (including HTML export and print).

## Figures beside text (flow notation and the figures column)

**` ```flow ` blocks** are a simple flowchart notation you write like text. The app converts them to mermaid, so preview, embedding, export, and copying work exactly as with mermaid. The full syntax and tips are in [FLOW.md](FLOW.md).

````
```flow
Login request -> Auth server -> Success?
  Yes -> Dashboard
  No -> Login screen : Show error
```
````

- `->` connects steps, and you can chain several on one line. `..>` dotted, `<->` bidirectional, `--` line without arrow, `-(HTTPS)->` labeled arrow.
- The same text is the same step (one box, wherever it's written).
- An indented line continues from the last step of the line above. Under a step ending in `?` (a decision), the first word becomes the answer on the arrow (Yes/No). To write what happens on that branch along with the answer, use `Yes -(Retry)-> Result` (label `Yes: Retry`).
- **Box descriptions and arrow labels**: ` : description` describes what the last step (box) on the line is, shown small under the box (`Payment : call payment gateway, up to 3s`). Under what condition you go somewhere, and what happens on that branch, go on the arrow (answers under a decision, `-(label)->`).
  - If several lines give different descriptions to the same box (`Yes -> Result : keep`, `No -> Result : renew`), they're treated as per-branch descriptions and each moves to that line's arrow label (`Yes: keep`). If there's only one description or they're all the same, it stays under the box.
  - If what happens on each branch is substantial, writing it as a box like `Yes -> Keep -> Result` is clearer (it becomes a step when presenting and connects to boxes with the same name).
- A line with only `Name:` is a group containing the indented lines below it.
- Shapes: `(Rounded)`, `((Circle))`, `[(DB)]`, a trailing `?` makes a diamond. `direction: right` (down, left, up) sets direction; `#` and `//` are comments.
- **Problem marker**: A `!` at the end of a step (`Waiting for approval !`, `[Deploy]!`) draws it with a red border. The `!` isn't part of the name, so it's the same box as `Waiting for approval`.
- **Name autocomplete**: When you start writing a step inside a flow block, names already in this note's flows are suggested (`Wait` → `Waiting for approval`, `Waitingforapproval` → `Waiting for approval`). **Tab** inserts; Enter closes the suggestion and just starts a new line. Since the same text is the same box, using it when repeating names keeps the drawing connected.
- **Similar name warning**: Names differing only in case, spacing, `-`, or `_` (`Auth server`/`Authserver`) are drawn as different boxes, so the canvas marks them with a yellow dotted border, and hovering shows the other spelling.
- Right-click → **Copy as Mermaid code** / **Convert to a ```mermaid block**: For posting to places that only know mermaid, like GitHub.
- **Copy for GitHub (flows as Mermaid)** (⋯ menu of a note, or the palette): Copies the whole note as Markdown with every ```flow block written as a ```mermaid block, so it can be pasted into an issue, a pull request or a README and still show the pictures. The note itself doesn't change; a block with nothing to draw is left as written.
- The palette's **Insert flow (simple diagram notation)** inserts an example.

**Figures column (`layout: figures`)**: Writing `layout: figures` in the front matter at the top of a note (palette **Toggle figures layout**) turns the preview into rows per heading, with the section's text on the left and the section's figures (` ```flow `, ` ```mermaid `, `![[x.mmd]]`, `![[x.excalidraw]]`) side by side on the right.

- Figures follow you within their section as you scroll (sticky), and the row for the section containing the editor cursor is highlighted. Sections without figures have an empty right side.
- When narrow (split view, etc.) it stacks into one column. Preview mode is better for a wide view.
- The file stays plain Markdown, so other apps show the figure blocks in place. HTML export and print come out as one column.

**Canvas view (Canvas)**: Clicking **Canvas** in the toolbar (or ⌘E through Edit → Split → Canvas → Preview, palette **View: editor and canvas**) puts the editor on the left and a canvas with the note's figures on the right. As you type, the figures on the right update immediately. Nothing new is saved in the note (layout is automatic; camera position is just view state).

- Each figure (` ```flow `/` ```mermaid ` block, `![[…]]` embed) gets a card. Cards in the same section (per heading) are laid out horizontally inside a titled dotted border, and sections continue downward in note order.
- **Two views**:
  - **Figure view** (default): The camera goes to the figure containing the cursor.
  - **Overview**: Toggle with **All** in the bar, double-clicking empty space, or `0` when the canvas has focus. In overview, moving the cursor only highlights; the camera stays put.
  - Zoom changed with wheel, pinch, or − + is **remembered separately per view** (kept across restarts). Overview zoom is remembered as "a multiple of the fit-to-screen size", so it fits even when the note size changes. `1` is 100%.
- **Pan**: Drag to pan.
- **Resize**: Drag the divider between the editor and the canvas (the preview in Split) to change widths. Double-click returns to 50/50. Split and Canvas widths are remembered separately.
- **Follows the cursor**: Inside a figure block, it goes to that figure and highlights the boxes that line produced (flow, mermaid). On a text line, it goes to the figure with a flow box whose name the line mentions, otherwise to the section's next figure. In a section without figures (such as intro text above subheadings), it looks at the nearest section with figures after it, or before it if none. English names are matched by whole words, and a Korean name still matches with a particle attached. While you stay on the same target, the camera doesn't move. When the target changes, it stays put if the target is already well visible, otherwise it moves only as much as needed. If the figure fits on screen, it moves so the whole figure is visible; if it's larger than the screen, it moves so the line's boxes are in the central part of the screen (the area excluding the 20% margins). Within the same figure, it moves only when the line's boxes are out of view. While you type, the camera doesn't chase the boxes that come and go at each key: it catches up once you pause (about a second), and when the figure is laid out again, the box you were looking at (the one nearest the cursor's boxes) stays where it was on screen, so the change happens around it.
- **Clicking**:
  - Clicking another figure zooms and moves to it (in overview too).
  - Clicking a box selects that box's text in the editor so you can edit it right away (keyboard goes to the editor too). Clicking empty space in a figure moves the cursor to the block's first line, and clicking a section title moves it to that heading line; the keyboard stays on the canvas so canvas keys (`0`, `l`, `p`, arrows, etc.) work immediately.
  - Clicking inside the figure you're viewing doesn't move the camera.
- **Double-click a box** (flow blocks only): Edit the text in place and press Enter. Every occurrence of the same text in the block changes at once, and a single ⌘Z reverts it. Esc cancels. Arrows, ` : `, and a trailing `:` can't be entered.
- **Linking boxes with the same name**: Boxes written with the same text (case-insensitive) across several flow figures are treated as the same and linked in note order. Linked boxes get a purple dot at the top right, and only the lines of the box on the cursor line or the hovered box are shown. **Links** in the bar (`l` when the canvas has focus) toggles all lines (remembered). Clicking a line goes to the box at the other end. Lines to other sections route around the right outside. Lines are always drawn above figures.
- **Box ↔ text**: Hovering a box highlights text in the editor that mentions that name (excluding code blocks and front matter).
- **Rename everywhere**: After renaming a box, if the same name appears in other flow blocks or text, the notification offers **Rename everywhere**. Clicking it changes all of them at once, and a single ⌘Z reverts it.
- **Follow the flow** (flow blocks only): Pressing **⌘⌥↓** (next box) or **⌘⌥↑** (previous box) in the editor starts at the box under the cursor and the canvas takes the keys (palette **Canvas: follow the flow…**).
  - `→`/`↓` follow the arrow to the next box; `←`/`↑` retrace the path walked (with no path, follow the incoming arrow).
  - At a branch, candidate boxes get numbers and are listed below with their arrow text (Yes/No). Pick with a number or cycle with `Tab`, and confirm with `Enter` (or `→`). `Esc` cancels.
  - `g` jumps to another figure that has a box with the same name (cycling in note order).
  - While walking, only the current box is highlighted, the editor cursor follows to that box's text, and the camera moves only as needed. `Esc` returns to the editor with the cursor on that box's text.
- **Canvas as image**: **⤓** in the bar (palette **Canvas: copy the whole canvas as an image** / **save … as PNG**) copies the section borders, titles, and all figures, laid out as on screen, as a single PNG/SVG, or saves it to `assets/` next to the note. Handy for pasting into chat or documents after a meeting.
- **Present**: **▶** in the bar (`p` when the canvas has focus, palette **Canvas: present the flows**) shows only the canvas full screen and steps through the note's flows one box at a time. It starts from the box you were following (otherwise the box under the editor cursor); press `Home` to start from the beginning.
  - Each picture is framed to fit when you reach it. If you zoom (wheel, pinch, `+`/`-`) or drag to look closer, that zoom stays while you go on in the same picture, and the view glides just enough to keep each step's box on screen above the caption (a box too big for the screen is centred). The next picture is framed afresh.
  - Clicking a box while presenting continues from that box (clicking a figure that isn't a box goes to that figure's first step). Double-click doesn't rename while presenting.
  - At a branch, it follows the first-written answer to the end, then returns to the branch (↩) and takes the next answer. Arrows to boxes already seen are shown one step at a time as merge (⤷) or loop (↺). Picking a numbered branch in the caption with a number key or click goes to that branch first (Space takes the highlighted branch). Detailed order in [FLOW.md](FLOW.md).
  - Order: by section and figure order; each flow starts from its start boxes (boxes with no incoming arrow) and follows the arrows. At a branch, it follows the first-written answer (Yes) to the end, then comes back for the next answer (No). Each box appears only once. Mermaid figures and embeds are a single step for the whole figure.
  - `Space`/`→`/`↓`/`Enter` next, `←`/`↑`/`Backspace` previous, `Home`/`End` first/last, `Esc` exit.
  - Boxes not yet visited are dimmed, the current box is highlighted. The figure is fitted large and centered in the screen area above the caption, and moves only when the figure changes. Figures too large to read follow the boxes.
  - Caption: the section title and step number, where you came from (`Success? — Yes →`), the box name, the ` : ` description, and list items of the form `- Box name: description` in that section (and the intro text above it), including indented lines below them. Sentences that merely contain the name are not included. Detailed rules in [FLOW.md](FLOW.md).
  - While presenting, link lines and dots and similar-name markers are hidden. The editor cursor follows too, so when you exit it's on the last box.
- There's no moving figures by hand or drawing lines. The text is the source; the canvas is a view.

## Drawings (Excalidraw)

Opening a `.excalidraw` file from the tree lets you draw and edit it in the [Excalidraw](https://github.com/excalidraw/excalidraw) editor. Create new drawings with the palette's **New drawing (Excalidraw)…** or folder right-click **New drawing here…**.

- **View and edit**: Edit / View in the toolbar. Drawings are shown exactly as the file contents; merely opening one doesn't rewrite the file.
- **Saving**: Autosave (same setting as notes, about 1 second after you stop drawing) and ⌘S. Also saves when you leave or close the tab.
- **External changes**: If another program changes the file, a saved drawing is reloaded; if there are unsaved edits, a conflict banner (Load disk version / Keep mine & overwrite) appears.
- **Fit on first open**: Zoom is set so the whole drawing is visible with margins (never above 100%). It refits when the window resizes, but keeps its state once you zoom, scroll, or start drawing.
- **Copy as image**: Copies the selected elements (or the whole drawing if none) as PNG (2x, up to 8192px) with ⧉ in the toolbar or **⇧⌥C**. The ⋯ menu has Copy as PNG / Copy as SVG / Save as PNG… / Save as SVG… (saved to `assets/` next to the drawing), and Excalidraw's own **Copy to clipboard as PNG/SVG** in the in-drawing context menu works too. Copies use the drawing's own colors (light background).
- **Embedding in notes**: Writing `![[name.excalidraw]]` shows the drawing as an image in the preview; clicking it opens the drawing. **Copy embed** in the ⋯ menu copies it. Editing the drawing updates the preview, and it's included in HTML export and print.
- **Obsidian drawings (`.excalidraw.md`)**: In phase 1 these are shown **read-only** (marked Read-only). The source can be viewed via ⋯ → Open as Markdown. Editing and writing back in Obsidian format is the next phase.
- **Other**: From the ⋯ menu, open as text (JSON), reveal in Finder, rename/move, delete (trash, Undo available). Unreadable files show an error and an **Open as text** button. Links in drawings: `https://…` opens in the browser, `[[note]]` opens in the app.
- **Fully offline**: The editor and fonts (Excalifont, Virgil, Cascadia, etc.) are bundled in the app, and nothing connects to npm, a CDN, or external servers at runtime. Library browsing, sharing/collaboration, AI features, and web embeds are turned off.
- **Korean, Chinese, and Japanese characters**: Excalidraw's CJK handwriting font (Xiaolai, about 12MB) is not included. These characters are shown in a system font.

**An exception to the principle (one isolated bundle)**: The editor keeps zero dependencies, but instead of building a drawing editor ourselves, `@excalidraw/excalidraw` is bundled in (user decision). In exchange, it's contained under these conditions.

- **Lazy loading**: Loaded only when a drawing is opened or a note contains a drawing.
- **Isolation**: Runs in a `sandbox="allow-scripts"` iframe (opaque origin). It can't access the app UI, token, notes API, or storage, and popups, downloads, and navigation are blocked. It exchanges only the drawing text with the app via postMessage; the app does all file reading and writing.
- **CSP**: The drawing frame can load only the app's own files (`connect-src`, `font-src`, etc. are 127.0.0.1 only, `frame-src 'none'`).
- **Pinned and verified**: The version is pinned exactly (`vendor/excalidraw/package.json` + lockfile). Every script runs only after being verified via the import map and SRI hashes, and `VENDOR.json` records the SHA-256 of every file. CI (`build/check-vendor.js`) checks this on every build.
- **Rebuilding from source**: `cd vendor/excalidraw && npm ci --ignore-scripts && node build.mjs`. The same input gives the same output. Only two modifications are made to the Excalidraw code (removing the font CDN fallback path, skipping the Xiaolai load). If a modification fails to apply to a new version, the build fails.
- **License**: MIT. Licenses of packages in the bundle are in `public/vendor/excalidraw/THIRD-PARTY-LICENSES.txt`.

## Git (local only)

If the workspace is a git repository, the ⎇ panel on the left and the tree show change status (M/U/D). If it isn't, you can initialize one in a single step from the panel. **No remote operations such as fetch/pull/push are performed.**

- **Commit**: Write a message and press ⌘↵ to commit all changes. Checking files commits only those files.
- **View changes**: Clicking a file opens its diff against the last commit, and "Discard changes…" reverts it (Undo available).
- **Note history**: ⋯ menu › **History…** (palette: *History of current note*) lists the note's commits together with the versions Margin kept itself (see *Local history*). Picking a version shows the difference from the current one, and **Restore this version** restores it (Undo available).
- **Auto-commit agent changes**: If "Commit to git" is on in the review screen, only the applied files are committed separately.
  - The author is `<agent name> (Margin) <agent@agent-notes.local>`, and the committer is your git account.
  - So agent-made changes (✦) and human-made changes are distinguishable in the history.
  - Other files you were working on separately are not mixed into this commit.
- Committing requires git user settings (`user.name`, `user.email`). If missing, you're shown how to set them.

## Agent integration contract

The configured command runs in a shell with `cwd = the staging copy` and receives the following.

| Input | Contents |
|---|---|
| stdin, `$AGENT_NOTES_PROMPT` | Role description + focus note + task (includes prior context in follow-up rounds) |
| `$AGENT_NOTES_TASK` | The task as written by the user |
| `$AGENT_NOTES_SCOPE`, `$AGENT_NOTES_FOCUS`, `$AGENT_NOTES_ROUND` | Scope, the note being viewed, round number |

The agent only needs to edit, create, or delete files in the current directory. stdout/stderr are saved as the run log, and it's terminated after 20 minutes.

## App updates

The desktop app can update **just the app code** without reinstalling the app.

- Check via **Margin › Check for Updates…** (the **Help** menu on Windows/Linux), and apply with **Install Update** → **Restart Now**. If there are unsaved notes, you're asked before restarting.
- With **Check for updates automatically** on, it asks once a day whether the latest Release at `github.com/kpiljoong/margin` has a new version. Off by default; note contents are never sent, and installation only happens when you click.
- **How it works**:
  - The launcher inside the app bundle (`desktop/boot.js`, `desktop/codepack.js`) doesn't change. Updated code (`desktop/main.js`, `server.js`, `lib/`, `public/`, etc.) is installed in the user data folder (macOS: `~/Library/Application Support/Margin/app-<version>/`).
  - Since the app bundle and signature aren't touched, macOS permission prompts don't reappear, and no write access to `/Applications` is needed.
- **Verification**:
  - The launcher checks the Ed25519 signature on the code folder's manifest **on every launch** (the public key is pinned in the launcher).
  - The manifest contains a SHA-256 per file. If any file differs, is added or missing, or there is a symlink, that version isn't used, and it runs the previous code or the code shipped in the app.
- **Safeguards**:
  - Versions older than the code shipped in the app aren't used (downgrades refused). Installing a new app cleans up code updates older than it.
  - If new code runs twice without managing to show the UI, it's marked bad, the app falls back to the previous code, and you're told. An error at load time reverts immediately.
  - Versions marked bad are not offered again by automatic checks (a manual check can download them again).
- **Versions that need a new app download**: Versions that change the app itself, such as a new Electron or launcher changes, have a manifest `minShell` greater than the app's `marginShell`. These aren't installed; instead you're directed to **Open Download Page**. When making such a change, bump `marginShell` in `package.json`.
- **Publishing a Release**: Pushing a tag makes CI build `margin-code.json`/`.sig`/`.pack.gz` and upload them to the Release. The signing key is the GitHub Actions secret `MARGIN_UPDATE_KEY` (PEM); without it, the release is published without a code update. To build locally, run `node build/code-package.js --out code-dist --key <key file>`.
- **Signing key**:
  - The private key paired with the public key in `desktop/boot.js` is in the GitHub Actions secret `MARGIN_UPDATE_KEY`.
  - If the two keys don't match, `code-package.js` refuses to sign, so CI fails.
  - If the key must be replaced (lost or leaked), create a new key pair with `node build/new-update-key.js <private key file>`, put the public key in `boot.js`, replace the secret, and bump `marginShell` (requires reinstalling the app).
- **Environment variables for testing**:
  - `MARGIN_UPDATE_URL`: Feed URL. Only https or `http://127.0.0.1` is allowed.
  - `MARGIN_UPDATE_DELAY_MS`: Delay before automatic checks start.
  - `MARGIN_CODE_UPDATES=1`: Enables code updates even in development runs.

## File layout

```
desktop/boot.js        launcher (app entry point, fixed in bundle): picks code to run, verifies signature, installs, reverts on boot failure
desktop/codepack.js    code package format and verification (fixed in bundle, shared with CI)
build/new-update-key.js generate code package signing key pair
desktop/main.js        Electron main: server child process, folder picker, recent list, menus, window security
desktop/updater.js     update check and download (+ update.html, update-dialog.js, update-preload.js window)
build/code-package.js  build signed code package (CI)
build/icon.svg|png     app icon (used by electron-builder)
desktop/preload.js     minimal bridge exposed to the web UI (open file/folder, open dropped files, agent settings, reveal folder). Accepts no path strings
desktop/agent.html     agent selection window (+ agent-dialog.js, agent-preload.js)
server.js              local HTTP server + JSON API (files, search and tags, attachments, rename/delete, file watch SSE, run lifecycle)
lib/diff.js            line-level diff, hunk generation/selective apply, 3-way merge
lib/privacy.js         .agentnotesignore globs, front matter privacy check
lib/agentlog.js        turns agent output (Claude stream-json / Codex --json / plain text) into activity, answer, and usage
public/index.html      UI shell (strict CSP, no inline scripts)
public/app.js          app shell: tabs, tree, search, palette, settings, delegate dialog, review screen
public/keys.js         shortcuts: key combo notation, recognition (by keyboard position), conflicts, display (pure logic). Defaults in public/shortcuts.json (also read by the menu)
public/editor.js       Markdown editor (syntax coloring layer, find/replace, autocomplete, editing commands)
public/markdown.js     dependency-free safe Markdown renderer (+outline)
public/codehl.js       ultra-light syntax highlighting for code blocks
public/diagrams.js     renders ```mermaid blocks as diagrams (lazy loaded, theme colors, shown as <img>; the ones on screen first; kept in IndexedDB so they show at once after a restart)
public/store.js        where the page keeps its settings (desktop: the app's config.json; browser: localStorage)
public/links.js        the link under the cursor in the editor (pure logic)
public/templates.js    note templates: filling in {{title}}, {{date}}… (pure logic)
public/previewfind.js  find in the preview (CSS Custom Highlight API, the markup is not touched)
public/mermaid-frame.*  hidden sandbox iframe where mermaid actually draws (opaque origin, dedicated CSP)
public/viewer.js       enlarged view for diagrams and drawings (zoom, pan)
public/flow.js         ```flow simple notation → mermaid flowchart translation (per-box line and text positions, arrows, problem markers), presentation order, name list and similar names
public/figure-goal.js  resolves the figure/box the cursor points at, finds mentions in text, box description list items (pure logic, no DOM)
public/canvas.js       canvas view: section cards, pan and zoom, cursor following, linking same-name boxes, follow the flow, present, box renaming
public/vendor/mermaid/ mermaid 12.0.0 (MIT) bundle, unmodified
public/drawing.js      Excalidraw drawings: isolated iframe management, postMessage, ![[drawing]] images in notes
public/clip.js         image clipboard copy (PNG/SVG, diagram images as PNG with theme background)
public/vendor/excalidraw/ Excalidraw 0.18.1 + React 19.3.0 bundle (build output, per-file hashes and CSP in VENDOR.json)
vendor/excalidraw/     source of the bundle above: pinned package.json and lockfile, drawing frame (src/frame.jsx), build script (build.mjs)
build/check-vendor.js  checks that public/vendor/excalidraw matches the recorded build (CI)
public/themes.js       theme definitions (CSS variable sets)
public/app.css         layout and component styles
scripts/demo-agent.js  offline deterministic demo agent (tidy/summarize/collect tasks by keyword)
scripts/demo.js        npm run demo launcher
test/*.test.mjs        npm test (node --test). Not included in the app package
example-workspace/     sample notes (includes a private note and a .agentnotesignore example)
docs/PRODUCT.md        product document
```

The only data created inside the workspace is `.agent-notes/`, which has its own `.gitignore` (`*`) so note copies never end up in git.

```
.agent-notes/runs/<id>/meta.json     task, scope, shared/excluded files, status, apply history
.agent-notes/runs/<id>/prompt-N.txt  prompt given to the agent
.agent-notes/runs/<id>/agent.log     agent output
.agent-notes/runs/<id>/base|work     snapshot at start / agent proposal
.agent-notes/runs/<id>/backup        files just before applying (for Undo)
.agent-notes/trash/                  files removed by delete or revert (including deleted notes)
.agent-notes/history/<note>/         earlier versions of each note (local history)
```

## Known limitations

- The editor is `textarea`-based.
  - Multi-cursor only goes as far as "editing the same text in several places at once" (⌘D/⌘⇧L). Adding cursors by clicking arbitrary positions and column selection are not supported.
  - Folding works only in the preview.
  - Styles that change character width, like heading sizes, are not used in the editor (visible in the preview).
- Notes over 300,000 characters have syntax coloring turned off in the editor (to keep it fast). Even in a 1.5-million-character note, input latency is about 12ms.
- Search scans cached contents without an index. With 5,000 notes: tree 3ms, search 6–55ms, tag aggregation 33ms.
- Automatic link fixing handles `[[name]]`, `[[path/name]]`, and relative `[..](..)` links. If several notes share the same name, `[[name]]` links are left alone (ambiguous).
- Drawings (Excalidraw):
  - Obsidian `.excalidraw.md` is read-only.
  - Without a CJK handwriting font, Korean text is shown in a system font (it may look different on other devices).
  - No library (shape collections) or real-time collaboration.
  - `.excalidraw.svg` and `.excalidraw.png` are viewed only as regular images.
  - Drawing tabs keep their editing state in memory, so opening many at once uses more memory.
- Assumes one workspace and one user at a time.
- The demo agent doesn't understand natural language. It responds only to keywords (tidy, summar, task, and shorter in follow-up rounds, plus their Korean equivalents).
