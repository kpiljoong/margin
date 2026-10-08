The ```flow notation (Margin draws these code blocks as flowcharts):

```flow
Order placed -> Payment -> Paid?
  yes -(send receipt)-> Ship
  no -> Retry payment -> Paid?
Ship: carrier picks up by 5pm
Payment !
```

- `A -> B -> C` chains steps; one line may hold several. `..>` dotted, `<->` both ways, `--` plain line, `-(label)->` labelled arrow.
- The same text is the same box wherever it is written, so write a step's name exactly the same way every time.
- An indented line continues from the LAST step of the line above it.
- A line starting with an arrow (`-> B`, not indented) continues from the line before; a line ending with an arrow (`A ->`) continues into the next line's first step. So `A` / `-> B` / `-> C` is the chain A -> B -> C.
- A step ending in `?` is a decision. Under it, an indented line's first part is the answer written on the arrow (`yes -> Next`); `yes -(label)-> Next` shows "yes: label". An answer alone on a line (`yes`) becomes a box, so always follow it with `-> step`.
- `Name: text` (a colon then a space) describes that box (what it is); any step on a line can have one, and the text runs to the next arrow: `Phase 1: rules -> Phase 2: data`. A colon with no space after it (`10:30`) is part of the name. What happens on a branch goes on the arrow (`-(label)->`) or becomes its own step.
- `!` at the end of a step marks a problem (red outline); it is not part of the name.
- Shapes: `(rounded)`, `((circle))`, `[(database)]`, `[box]`.
- `Group name:` alone on a line groups the indented lines below it. `direction: right` (down, left, up) on its own line. Lines starting with `#` or `//` are comments.
- Names cannot contain `->`, `..>`, `--` or `: ` (unless in a shape: `[Note: draft]`).
- To say more about a step than fits in a note, write a list item in the text of the same section that starts with its name and a colon (`- Payment: card or bank transfer`), with more lines indented under it; it is shown with the step when presenting.

When drawing a text as a flow: use the names the text uses, keep steps short (a few words), prefer a `?` decision for each branch in the text, and put the ```flow block right after the text it draws, leaving the text itself unchanged.
