# flow notation

A ` ```flow ` block is a flowchart notation you write like text. It exists so that, in a meeting, you type on the keyboard instead of drawing with the mouse and see the diagram as you type. It is tuned for drawing "what leads to what": system architecture, process improvements, workflows.

The text is the source; the diagram is only a view. You can also draw on it in the Canvas view (add boxes, drag arrows, colour, delete): each change is written into the text, so the text stays the source (see "Drawing on the canvas" below). Boxes are never placed by hand; the layout follows the arrows. The app converts the notation into a mermaid flowchart, so preview, embedding, export, and image copy behave exactly as with ` ```mermaid `. Places that don't know this notation (GitHub, GitLab) show a ` ```flow ` block as plain text: to share a note there, use **Copy for GitHub (flows as Mermaid)** in the note's ⋯ menu, which copies it with every flow block written as Mermaid.

````markdown
```flow
Login request -> Auth server -> Success?
  yes -> Dashboard
  no -> Login screen : show error
```
````

## Quick reference

| Write | Meaning |
|---|---|
| `A -> B -> C` | Chain steps with arrows. Several per line |
| `A ..> B` | Dotted arrow |
| `A <-> B` | Two-way arrow |
| `A -- B` | Line without arrowhead |
| `A -(HTTPS)-> B` | Labelled arrow |
| Indented line | Continues from the last step of the line above |
| `Success?` | Ending in `?` makes a decision (diamond) |
| `yes -> B` under `Success?` | The first part, `yes`, is the answer on the arrow |
| `B : note` | Note under the line's last box |
| `Pending approval !` | Problem mark (red outline) |
| `(rounded)` `((circle))` `[(DB)]` `[box]` | Shapes |
| `Service:` (alone on a line) | Group enclosing the indented lines below |
| `direction: right` | Drawing direction (`down` default, `left`, `up`) |
| `color blue: A, B` | Colours boxes (red, orange, yellow, green, teal, blue, purple, gray) |
| `# …`, `// …` | Comments |

## Steps (boxes)

- **The same text is the same box.** However many times and wherever you write it in the block, there is one box, and arrows converge on it. So a flow split across several lines still draws as one connected diagram.
  ```flow
  Order -> Payment -> Shipping
  Payment -> Send receipt
  ```
- Leading and trailing spaces in a name are ignored, and runs of spaces inside are treated as one. Case and spacing are significant, so `Pending approval` and `Pendingapproval` are different boxes (the canvas flags similar names with a yellow dashed outline; see "Across diagrams" below).
- **Shapes**
  - Ending in `?`: decision (diamond). See "Decisions and answers" below.
  - `(rounded)`: rounded box, `((circle))`: circle, `[(DB)]`: database, `[box]` or plain text: rectangle.
  - Shape markers are not part of the name. `[(Order DB)]` and `Order DB` are the same box, and the shape comes from where it is marked.
- **Problem mark `!`**: a `!` at the end of a step draws it with a red outline (`Pending approval !`, `[Deploy]!`). `!` is not part of the name, so marking it in one place marks the whole box. Use it in meetings to point at "this is the bottleneck".

## Arrows

- `->` (`-->` and `→` are the same), `..>` dotted, `<->` two-way, `--` line without arrowhead.
- `-(label)->`: writes text on the arrow. Labels cannot contain parentheses.
- One line can chain several steps: `Request -> Gateway -(gRPC)-> Order service ..> Notification`.

## Indentation

An indented line continues from **the last step of the line above**. Lines at the same indentation branch from the same step.

```flow
Deploy request -> Build
  Test -> Staging
  Security scan
```

`Build` branches to `Test` and `Security scan`, and `Test` goes to `Staging`. A tab counts as two spaces.

- If an indented line starts with the name of the last step of the line above, it simply continues from that step with no new arrow (`Build -> Deploy` under `Build`).
- If it starts with a name that is **not** the last step of the line above, an arrow to that step is created. For example, indenting `Screen -> Close` under `Screen -> Input` creates an arrow `Input → Screen`. To branch from the same place, don't indent; write `Screen -> Close` on a new line.

## Decisions and answers

Under a step ending in `?`, an indented line's **first part is the answer.** The answer is not a box; it is written on the arrow leaving the decision.

```flow
Payment succeeded?
  yes -> Confirm order
  no -> Retry -> Payment succeeded?
```

- To state what happens on that branch along with the answer, add an arrow label: `yes -(send notification)-> Confirm order` → the arrow shows `yes: send notification`.
- If you write only the next step without an answer (just `Confirm order` under `Payment succeeded?`), it becomes a box joined by an unlabelled arrow. To attach an answer, write it with an arrow, as in `yes -> Confirm order`.
- To keep a condition as a box under a decision, write the answer separately in front: `equal -> Same value -(keep)-> Active SPEC`.

## Notes ` : `

` : note` (spaces around the colon) describes **what the line's last box is**. It appears in small text under the box name.

```flow
Order received -> Payment : calls the PG, max 3s
Payment -> Deduct stock : cancel payment on failure
```

- A note belongs to the box, so it should be **independent of how you got to that box**.
- A line with a single step is fine: `Payment : calls the PG`.
- If a line has several ` : `, it splits at the last one. Don't use ` : ` inside a note. `A:B` without spaces is just part of the name.
- **If several lines attach different notes to the same box**, the notes are treated as what each branch does, not as describing the box. Each note moves to the label of the arrow drawn by its line.
  ```flow
  SPEC Resolver?
    Same value -> Active SPEC : keep
    NORMALIZE applicable -> Active SPEC : update to normalized value
  ```
  The arrows show `Same value: keep` and `NORMALIZE applicable: update to normalized value`. If there is only one note, or all are the same, it stays under the box. Writing `Same value -(keep)-> Active SPEC` gives the same diagram.

### Note, arrow label, or box?

- **What the box is** (role, constraint, owner): ` : note`.
- **Under what condition you go there**: an answer under a decision (`?`).
- **What happens on that branch** (briefly): arrow label `-(…)->`, or just ` : ` for convenience, which also goes onto the arrow.
- **If that action is a step worth discussing on its own**: write it as a box. `yes -> Normalize -> Active SPEC`. As a box it becomes its own step when presenting, links to same-named boxes in other diagrams, and can be clicked or renamed.

In meetings, we recommend writing labels or notes quickly first, then expanding a branch into boxes once discussion goes deeper into it.

## Groups, direction, comments

- **Groups**: a line with only `Name:` (ends with a colon, no arrow) encloses the indented lines below it in a border. Groups can be nested. A box belongs to the group where it **first appears**.
  ```flow
  Order service:
    API -> Order DB
  External:
    PG
  API -> PG
  ```
- **Direction**: `direction: right` on its own line (`down` default, `left`, `up`). The Korean equivalents of the keyword and values also work.
- **Comments**: lines starting with `#` or `//` are not drawn. Blank lines are ignored too.

## Colours

`color <colour>: <names>` on a line of its own fills those boxes with a colour: red, orange, yellow, green, teal, blue, purple or gray (Korean colour names work too, as does the keyword `색`).

```flow
Request -> Auth server -> Payment -> Done
color blue: Auth server, Payment
color green: Done
```

- Names are separated by commas; a name that itself holds a comma still works, as the longest name that is a box wins.
- A name that isn't a box is ignored. If a box is named on two colour lines, the later one wins.
- The problem mark `!` keeps its red outline on a coloured box.
- The text stays dark on every colour, in light and dark themes alike. **Copy for GitHub** keeps the colours (as Mermaid `classDef`s).

## Drawing on the canvas

In the Canvas view a flow can be drawn on; each change is written into the block (the details are in "Canvas view" in [GUIDE.md](GUIDE.md)):

| On the canvas | Written in the block |
|---|---|
| **+** of `B` (or `Tab`), named `C` | `B -> C`: on the line that ends with `B` if it's the last one (`A -> B -> C`), else a new line |
| Drag **+** of `C` onto `A` | `C -> A` (nothing if that arrow is there already) |
| From a question `Ok?` | `Ok? -(yes)-> …`, then `-(no)->` |
| Double-click empty space, `N` | `New step` on a line of its own |
| `C` then a number | `color …:` line at the end |
| Delete `B` | `B` taken out of every line; `A -> B -> C` becomes `A -> C`, a line left with nothing goes |
| Right-click → Runs right | `direction: right` |
| Move to a note of its own | the block goes to a new note; `![[Name]]` stays here |

A flow too long for its note reads better in a note of its own: the canvas of the first note still shows it, through the `![[…]]`.

## Across diagrams

When a note has several flow blocks, the canvas shows them connected.

- **Same name = same thing**: boxes written with the same text (case-insensitive) across diagrams are treated as the same thing and joined by lines on the canvas. Useful for comparing the same step in "Current" and "Proposed" diagrams.
- **Similar-name warning**: names that differ only in case, spaces, `-` `_` `.` `·` (`Pending approval`/`Pendingapproval`) are flagged on the canvas with a yellow dashed outline. Most likely one step written two ways.
- **Name autocomplete**: when you start typing a step after an arrow inside a block, names already used in this note's flows are suggested. **Tab** inserts; Enter just starts a new line.
- **Renaming**: double-click a box on the canvas and rename it to change every occurrence of that name in the block. If it also appears in other blocks or the text, **Rename everywhere** changes them all at once.

## Text and diagrams

- When the text around a flow block mentions a box name (for Korean names, even with a grammatical particle attached), the canvas follows the cursor to the diagram containing that box.
- Captions in presentation mode show where you came from and via which answer/label, the box name, the ` : ` note, and the **list items in the body that explicitly describe that box**. Sentences that merely happen to contain the name are not shown.
  - A list item in the same section (or the intro text above) starting with `- Box name: description` becomes that box's caption, together with the lines indented under it. A box can have several items.
  - Names are compared ignoring case, spacing, and a trailing `?` or `!` (`- Review: …` describes the `Review?` box). The name may also be bold, as in `- **PR**: …`.
  - Use ` : ` in the diagram for short notes; use a body list item for longer explanations or to say "why this step is a problem".

  ```markdown
  - PR: change request opened by a developer
    - 12 per day on average
  - Fix: deployed directly without another review — the current problem
  ```
- Presentation order: by section and diagram order; each diagram starts from boxes with no incoming arrows and follows the arrows. At a branch, the first-written answer is followed to the end before returning to the next answer. Each box's content is shown only once.
  - When returning to the next answer, the branch box is shown once more ("↩ Back to this branch", "Next: no").
  - An arrow to an already-seen box is also shown as a step: "⤷ Joins here" when it merges with another branch, "↺ Back to a step on the way here" when it returns to a box on the path you came by (a loop).
  - At a branch, the caption lists the branches by number. Space goes to the highlighted branch (outlined); a number key or click goes to the chosen branch first. Unchosen branches follow afterwards, and branches already visited are dimmed.

For canvas, follow, and presentation controls, see "Canvas view" in [GUIDE.md](GUIDE.md).

## Common mistakes

- **Writing only the answer under a decision**: a line with just `yes` under `Success?` is not an answer but a box named `yes`. Write answers with an arrow, as in `yes -> Next step`.
- **Forgetting the `?`**: in `Same value -> …` under `SPEC Resolver`, `Same value` is a box, not an answer. If it is a decision, add `?` at the end.
- **Indenting to branch from the same place**: an indented line continues from the **last** step of the line above. To branch from a middle step of a line, start a new line with that step's name.
- **Writing a name slightly differently**: `Auth server` and `Authserver` are different boxes, so the diagram breaks. If you see a yellow dashed outline, unify them; using autocomplete (Tab) prevents most of this.
- **Putting ` : ` or arrow characters in a name**: `->`, `..>`, `--`, ` : ` are notation symbols and cannot appear in names.
