# Reader

Reader is a Built-in Plugin that opens PDF, EPUB, MOBI, AZW3, FB2, and CBZ files from the author's device. It is a complete reading app on its own, for an author who may never open anything else in Maibuk, and it still works beside their writing (in a Pane, or as a Canvas Reference). These terms bind only inside `plugins/maibuk-reader/`; Maibuk's own terms come from the root `GLOSSARY.md`.

**Document**:
A file the author opened in Reader. It stays the author's file, wherever it lives on the device; Reader never copies it into the Library and never changes it.
_Avoid_: Book (a Book is the author's own writing), ebook, file (for one on the Shelf)

**Shelf**:
The Documents Reader remembers on this device, shown in the order and view the author picks. Opening the same file again finds its Document instead of adding a second one. Removing a Document from the Shelf forgets it and leaves the file alone.
_Avoid_: library (the Library is Maibuk's), recent files, history

**Missing Document**:
A Document on the Shelf that Reader can no longer read, because the file moved, was deleted, or (on the web) the browser asks again before letting Reader read it. The author can locate it again or remove it.
_Avoid_: broken, lost

**Reading Position**:
The root term, applied to a Document: the page (or the spot in a reflowable Document's text) Reader returns to when the author opens that Document again on this device.
_Avoid_: place, bookmark, progress (for where the author is)

**Page view**:
How Reader shows a Document made of fixed pages (PDF, CBZ, fixed-layout EPUB): one page at a time, zoomed to fit the width, fit the page, or a chosen size.

**Flowing view**:
How Reader shows a Document whose text reflows (EPUB, MOBI, AZW3, FB2): in pages sized to the window, in the font size and line width the author chose.
_Avoid_: reflow mode, scroll mode

**Import**:
Adding Documents to the Shelf: the files the author picked, or every supported file in a folder the author picked and its subfolders. Reader checks the folder once, at that moment, and does not keep it; importing the same folder again finds only what is new. In Reader this is the meaning of Import; the root term (bringing work into the Library) does not apply here, because Reader never copies a file.
_Avoid_: add to Shelf, scan, watch, sync (for a folder)

**Collection**:
A group of Documents on the Shelf that the author makes and names. A Document can sit in several Collections; removing it from one leaves it on the Shelf.
_Avoid_: folder, tag, category

**Bookmark**:
A spot in a Document the author marks on purpose, to find again from the Bookmarks list. Reader keeps the Reading Position by itself; a Bookmark only exists because the author made it.
_Avoid_: Reading Position (the automatic one), favorite

**Highlight**:
A stretch of a Document's text the author marked in a color, with an optional note. It belongs to the Document on this device; the file never changes.
_Avoid_: annotation, underline, mark

**Reading Theme**:
The page and text colors Reader draws a reflowable Document in (light, sepia, dark, black), chosen apart from Maibuk's Light or Dark. A PDF or CBZ is always drawn as it is.
_Avoid_: theme (alone), night mode

**Custom Style**:
The author's own CSS, applied on top of a reflowable Document's styles and Reader's own text settings, for every Document or for one.
_Avoid_: CSS override, user stylesheet, custom CSS

**Publisher Styles**:
The styles and fonts a reflowable Document ships with. The author can switch them off and read in Reader's text settings alone.
_Avoid_: original styles, book CSS

**Code view**:
A read-only look at the markup and styles of the reflowable Document section on screen, as the file has it or as Reader cleaned it for display.
_Avoid_: source view, HTML inspector, developer mode

**Reading Session**:
A stretch of reading time in one Document, counted while Reader is the part of Maibuk in use (its page, or its Pane holding focus) and stopped when the author moves to anything else. Reader's counterpart of a Writing Session.
_Avoid_: session (alone), sitting

**Reading Stats**:
What Reader learned from Reading Sessions on this device: time read per day and per Document, Documents finished, and reading speed. It is backed up with the Library and never synced.
_Avoid_: analytics, metrics (Metrics Category is the writing data)

**Tap Zone Layout**:
What each part of a Document's page does when tapped: a three-by-three grid whose top and bottom rows are thin bands and whose middle row takes the rest of the height. The center always opens the reading menu; the author picks which cells go back and which go forward (Sides, Up/down, Right hand, Left hand), or turns tapping off.
_Avoid_: touch zones, tap areas, gesture map
