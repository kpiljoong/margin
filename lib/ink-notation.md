The ```ink notation (Margin draws these lines on the picture right above the block):

![Login](assets/login.png)

```ink
box red: 280,120 200x80
text red: 280,210 The button is hidden
arrow red: 410,220 -> 300,160
pen blue: 100,100 120,104 140,112
```

- One line is one mark. `box: x,y WxH` (top left corner and size), `arrow: x,y -> x,y` (from, to), `text: x,y words` (where the words start), `pen: x,y x,y …` (a line through the points).
- Coordinates are the picture's own pixels from its top left (the sizes are listed below); keep marks inside the picture.
- The colour after the kind is optional (red when left out): red, orange, yellow, green, teal, blue, purple, gray. Lines starting with `#` or `//` are comments.
- The block goes right under the picture's line (one blank line between is fine). If the picture has a block already, add your lines to it; leave the lines already there alone unless the task is about them.
- A callout is a `box` (or an `arrow`) on the place and a `text` line just below or beside it, a few words long, in the language of the note.
- Never edit the picture files themselves; the user reviews each block's change as marks on the picture.
