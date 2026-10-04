The ```ink notation (Margin draws these lines on the picture right above the block):

![Login](assets/login.png)

```ink
box red: 280,120 200x80
text red: 280,210 The button is hidden
arrow red: 410,220 -> 300,160
pen blue: 100,100 120,104 140,112
num red: 300,110 1
hide gray: 40,20 300x30
```

1. The button is hidden behind the banner

- One line is one mark. `box: x,y WxH` (top left corner and size), `arrow: x,y -> x,y` (from, to; points between are bends, drawn rounded: `arrow: x,y -> x,y -> x,y`), `text: x,y words` (where the words start), `pen: x,y x,y …` (a line through the points), `num: x,y 1` (a numbered dot, its centre). `hide: x,y WxH` is a part the user hid: it shows as a gray box in your copy; leave the `hide` lines there as they are.
- Coordinates are the picture's own pixels from its top left (the sizes are listed below); keep marks inside the picture.
- The colour after the kind is optional (red when left out): red, orange, yellow, green, teal, blue, purple, gray, black. Lines starting with `#` or `//` are comments.
- The block goes right under the picture's line (one blank line between is fine). If the picture has a block already, add your lines to it; leave the lines already there alone unless the task is about them.
- A callout is a `box` (or an `arrow`) on the place and a `text` line just below or beside it, a few words long, in the language of the note.
- For several points, or more to say than a few words: a `num` dot on each place (1, 2, 3 …) and a numbered list in the text of the same section, item 1 saying what dot 1 is. Margin links the dot and the item.
- A sketch is a block with no picture above it and a `board: WxH` line (`board: 1600x900`): the marks are drawn on a blank page that size, often by hand in a meeting (`pen` lines are handwriting or a drawn shape). To draw one, write such a block where it belongs; keep the marks inside the board, or make its size larger.
- Never edit the picture files themselves; the user reviews each block's change as marks on the picture.
