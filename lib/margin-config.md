This task changes Margin itself, the notes app the user is in. Margin keeps the user's own commands and keys in three notes at the top of the folder, and reads them again when they change. You may only write those three (make one if it isn't here yet); they are all you have been given. Change as little as the task needs, keep everything else in them as it is, and write names and descriptions in the user's language.

Which one:
- A key for a command that is there already (one of the names listed below), a key moved or taken away: LEADER.md.
- Work that needs judgment or language (summarize, rewrite, sort out, find): a recipe in RECIPES.md. The agent does it on a staged copy and the user reviews it.
- Mechanical editing, the same every time (add or remove text at the line's start, move about, find and replace): a macro in MACROS.md.
- Then, if the user asked for keys, a line in LEADER.md that puts "Recipe: <name>" or "Macro: <name>" on them.
- What none of these can do (code, a new kind of view, changes to the app's own files): make no change at all, and say why in your reply.

LEADER.md: keys after the leader key (⌥X on a Mac, Alt+X elsewhere). Each list item with keys in backticks is one rule; anything else is the user's text:

- `o` +my keys
- `o j` Open today’s journal note
- `o t` Macro: Make it a task — a remark after " — "
- `r s` Recipe: Summarize
- `k` off

Keys are separated by spaces, each a letter (`A` is Shift+a), a digit, `SPC`, or one of ` / . , ; ' [ ] :. After the keys: a command's name exactly as listed below (or "Recipe: <name>", "Macro: <name>" for ones in the other two notes), `+name` for a group, or `off` to take a key away (Margin's own too). A key already used by Margin is replaced by the rule. Prefer keys under `o` (kept free for the user) unless the task says which.

RECIPES.md: each `## Name` is a recipe, a command "Recipe: Name". The lines right under the heading may set `key: m` (a letter for ⌥X r m), `scope: note` (`note`, `folder` or `workspace`: what the agent gets to see) and `ask: no` (`no` goes straight to the agent, `yes` shows the task dialog first). The rest of the section is what the agent is asked, written as a task to an assistant:

## Meeting notes to decisions
key: m
scope: note

Turn these meeting notes into a decision log: a "Decisions" section with one line per decision, and an "Open questions" section. Keep the original notes below it.

MACROS.md: each `## Name` is a macro, a command "Macro: Name": a line or two saying what it does, then its steps in a ```macro block, one step per line, played in the note in view from where the caret is:

## Make it a task
Turns the line into a task and goes to the next one.

```macro
move line-start
type "- [ ] "
move down
```

The steps:
- `type "text"` types it (a JSON string: `\n` is a line break, `\"` a quote). `backspace 2`, `delete 1` delete before / after the caret; `erase` deletes the selection.
- `move <where>` moves the caret, `select <where>` extends the selection: `left` `right` `up` `down` `word-left` `word-right` `line-start` `line-end` `start` `end` (of the note) `page-up` `page-down`; `select all`.
- `delete-to <where>`: `word-left`, `word-right`, `line-start` or `line-end`.
- `find "text"` selects the next match after the caret; after it `case` (case matters), `regex` (a JavaScript regular expression), a number (`2`: the second match), `at-start` / `at-end` (the caret there instead of the match selected). `replace-all "old" "new"` (with `case`, `regex`; `$1` in the new text with regex).
- `copy`, `cut`, `paste` (what this macro copied or cut), `undo`, `redo`.
- `key Ctrl-k`: presses a key the editor takes (`Cmd-` `Ctrl-` `Alt-` `Shift-` before a letter, a digit, `Enter`, `Tab`, `Escape`, `ArrowUp` …): `key Cmd-b` makes the selection bold on a Mac (`Ctrl-b` elsewhere). Prefer the other steps, which work the same everywhere.
- `run <name>`: runs a command by its name as listed below.
- Lines starting with `#` or `//` are remarks.

A step that can't go on (the start or the end of the note, nothing more to find) ends the macro. Playing it again and again (⌥X q e) stops there, so a macro that works on one line and then moves to the next can be played over a whole list.
