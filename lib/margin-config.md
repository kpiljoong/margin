How Margin keeps the user's own commands and keys: three notes at the top of the folder, read again by the app whenever they change. Write them exactly as below: a line Margin can't read is left out (with a warning to the user), never guessed at.

Which one:
- A key for a command that is there already, a key moved or taken away: LEADER.md.
- Work that needs judgment or language (summarize, rewrite, sort out, find what matters): a recipe in RECIPES.md. It asks an agent, on a staged copy, and the user reviews what comes back.
- Mechanical editing, the same every time (text added or removed at the line's start, moving about, find and replace): a macro in MACROS.md. It plays in the note in view, from where the caret is.
- Keys for a new recipe or macro: also a line in LEADER.md with "Recipe: <name>" or "Macro: <name>" — unless a recipe's own `key:` is enough (it puts the recipe on ⌥X r <key>).
- What none of these can do (code, a new kind of view, a change to the app itself): make no change, and say why in your reply.

Change as little as the task needs and keep everything else in the notes as it is. Names and descriptions in the user's language are fine; "Recipe: <name>" and "Macro: <name>" must then be written with that exact name.

## LEADER.md — keys after the leader key (⌥X on a Mac, Alt+X elsewhere)

Each list item with keys in backticks is one rule; any other line is the user's text:

````markdown
- `o` +my keys
- `o j` Open today’s journal note
- `o t` Macro: Make it a task — a remark after " — "
- `n SPC` Widen: show the whole note
- `k` off
````

- Keys are separated by spaces, each a letter (`A` is Shift+a), a digit, `SPC`, or one of ` / . , ; ' [ ] :.
- After the keys: a command's name exactly as Margin lists it (below), `+name` for a group, or `off` to take a key away.
- The key map below is what the keys do now, written the same way. A rule on a key in use replaces what is there: say so in your reply. Use keys that are free unless the task names them; `o` is kept free for the user.
- A key under one of Margin's groups needs only its own line (`n SPC` Widen…). Don't write a `+name` line for a group that is there already: that renames it.
- A group needs no line of its own when it is new either (`o t` makes `o`), but a `+name` line gives it a name in the menu.

## RECIPES.md — tasks for an agent, run by name

Each `## Name` is a recipe, the command "Recipe: Name". Right under the heading, optional lines:
- `key: m` — one letter or digit: ⌥X r m runs it (not `e`, which edits RECIPES.md).
- `scope: note` — what the agent may see: `note` (the note in view), `folder` (its folder) or `workspace`.
- `ask: no` — straight to the agent; `yes` shows the task dialog first.
Then, after a blank line, what the agent is asked: written as a task to an assistant, saying what to change and what to leave alone.

````markdown
## Meeting notes to decisions
key: m
scope: note

Turn these meeting notes into a decision log: a "Decisions" section with one line per decision, and an "Open questions" section. Keep the original notes below it.
````

## MACROS.md — editing steps, played in the note in view

Each `## Name` is a macro, the command "Macro: Name": a line saying what it does, then its steps in a ```macro block, one step per line:

````markdown
## Make it a task
Turns the line into a task and goes to the next one.

```macro
move line-start
type "- [ ] "
move down
```
````

The steps:
- `type "text"` types the text where the caret is, replacing the selection if there is one. The text is a JSON string: `\n` is a line break, `\"` a quote, `\\` a backslash.
- `backspace 2`, `delete 1`: deletes characters before / after the caret (or, with a selection, it and as many more). `erase` deletes the selection.
- `move <where>` moves the caret (and drops the selection); `select <where>` moves it keeping the other end, so the selection grows. Where: `left` `right` (a character), `word-left` `word-right`, `line-start` `line-end`, `up` `down` (a line, keeping the column), `start` `end` (of the note), `page-up` `page-down`. `select all` selects the whole note.
- `delete-to <where>`: deletes from the caret to `word-left`, `word-right`, `line-start` or `line-end` (`line-end` at the end of a line deletes the line break; with a selection, it deletes the selection).
- `find "text"` selects the next match after the caret. After it, any of: `case` (case matters; without it, it doesn't), `regex` (a JavaScript regular expression; `^` and `$` are a line's start and end), a number (`2`: the second match), `at-start` or `at-end` (the caret at that end of the match instead of the match selected).
- `replace-all "old" "new"` replaces every match in the note (`case`, `regex` as for find; with `regex`, `$1` in the new text is the first group). The caret is at the start of the note after it.
- `copy`, `cut` (the selection, kept for this macro), `paste` (what this macro copied or cut, replacing the selection), `undo`, `redo`.
- `key Ctrl-k`: presses a key the editor itself acts on (`Cmd-` `Ctrl-` `Alt-` `Shift-` then a letter, a digit, `Enter`, `Tab`, `Escape`, `ArrowUp` …). `key Enter` in a list item starts the next item, as the user's Enter does (elsewhere it does nothing: use `type "\n"`). Keys that only type a character do nothing here: use `type`. Prefer the other steps, which work the same on every computer (`Cmd-` is a Mac's).
- `run <name>`: runs a command by its name as Margin lists it (another macro too: `run Macro: Make it a task`).
- Lines starting with `#` or `//` are remarks.

A step that can't go on — a move at the start or end of the note, a find with nothing more to find — ends the macro. Playing a macro again and again (⌥X q e) stops there, so one that does a line and moves to the next works through a whole list. Selecting a line: `move line-start` then `select line-end`. A macro that works on the selection should say so in its description.
