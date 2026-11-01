# Maibuk

Maibuk is a local-first writing app for book authors: their Books, the Notes and Canvases around them, their history, and optional encrypted sync between the author's devices. This glossary fixes the words for those concepts. Code, UI copy, tests, and docs use the terms here; words under _Avoid_ are review flags.

`_UI_` lines record the shipped en/es label for a term where it is worth pinning. A label marked _(known mismatch)_ is shipped copy that contradicts the glossary; it is tracked here until a copy change fixes it. Every other label lives in `src/locales/en.json` and `src/locales/es.json`.

Terms under **Decided, not built** are accepted in `docs/adr/` but the app does not work that way yet. Terms under **Anticipated** are reserved words for features nobody has decided to build.

## Library

**Library**:
Everything an author keeps in Maibuk on one device: Books, Notes, Canvases, history, settings, and metrics.
_Avoid_: database, workspace, and "account" for the Library

**Gallery**:
The browsable list of an author's Books, Notes, or Canvases.
_Avoid_: dashboard, home (for the Book Gallery)

**Item Menu**:
The actions for one Note, Chapter, Text Node, Note Reference, or Symbol in the picker, opened from its ⋯ button (lists only), a long-press on touch, or a right click.
_Avoid_: context menu, kebab menu, overflow menu

**Tutorial**:
A guided run through Maibuk's screens, shown with sample content, that the author can skip at any step and start again from Settings; dismissing it once stops it appearing on its own on this device. (ADR 0008, 0009)
_Avoid_: tour, walkthrough, onboarding, guide

**Tutorial Library**:
The throwaway sample Library the Tutorial runs in; nothing in it syncs, is backed up, is counted in metrics, or outlives the Tutorial. (ADR 0008)
_Avoid_: sample book, demo data, sandbox (in UI copy)

## Manuscript

**Book**:
What the author is writing for publication, made of ordered Chapters plus its Cover, details, and history.
_UI_: en "Books", "Book actions" / es "Libros", "Acciones del libro"; en "Per book", "Time per book" / es "Por libro" in Metrics
_Avoid_: project, work, manuscript (as a thing separate from Book)

**Author Name**:
The name shown as a Book's author.

**Genre**:
The kind of story a Book tells, in the author's own words.

**Book Status**:
Where a Book stands: Draft, In Progress, Completed, or Archived.

**Archived**:
The Book Status of a Book the author has put away; it is hidden from the default Gallery and keeps all its content.

**Unarchive**:
Changing an Archived Book to any other Book Status.
_UI_: en "Unarchived" / es "Se desarchivó" in the confirmation toast
_Avoid_: restore

**Chapter**:
One ordered section of a Book's text.
_Avoid_: page

**Chapter Type**:
The role a Chapter plays in its Book: Chapter, Prologue, Epilogue, Part, Front Matter, or Back Matter. A Part marks where a division of the Book begins; it does not contain other Chapters.
_UI_: es "Páginas preliminares", "Páginas finales" for Front Matter and Back Matter

**Chapter Status**:
How finished a Chapter is: Draft, Revised, or Final.

**Target Word Count**:
The length the author aims for with a Book.
_Avoid_: word goal (reserved for Daily Goal)

**Scene Break**:
A marked pause inside a Chapter, shown as a symbol line or an image.
_Avoid_: separator, divider

**Footnote**:
A remark anchored to a spot in Chapter text and printed apart from the running text.
_UI_: en "Footnotes" / es "Notas al pie"
_Avoid_: note, notes (those are Notes)

**Outline**:
The in-editor list of a Chapter's headings and Scene Breaks, used to jump around while writing.
_UI_: en "Show outline" / es "Mostrar esquema"
_Avoid_: TOC, table of contents

**Table of Contents**:
The list of Chapters placed inside an exported Book.
_Avoid_: outline

**Cover**:
The front cover design of a Book.

**Cover Template**:
A ready-made Cover design (background plus title and author layout) the author can apply to a Cover.
_UI_: en "Templates" / es "Plantillas"

**Cover Size Preset**:
A standard Cover size, such as a print trim size or an ebook store's dimensions, that a Cover uses.
_Avoid_: template (for a size)

**Cover Designer**:
The place where an author builds a Book's Cover.
_Avoid_: canvas, cover editor

## Notes

**Note**:
Free-form writing that lives outside a Book's Chapters.
_Avoid_: document, quick note

**Book Note**:
A Note attached to one Book, also shown beside that Book while writing.
_UI_: en "Book Notes" / es "Notas del Libro"

**Unfiled Note**:
A Note attached to no Book.
_UI_: en "Unfiled" / es "Sin libro"
_Avoid_: "Sin archivar" (reads as not Archived)

**Tag**:
A word an author puts on Notes to group and filter them.
_Avoid_: label

**Note Filter**:
The Tags a Note must have, the Tags it must not have, and the Last Edited range that narrow which Notes are shown. One Note Filter applies to both the Notes Gallery and the Notes list, and each device keeps its own. Search is separate: each place keeps its own search text.
_UI_: en "Filters" / es "Filtros"
_Avoid_: advanced filters, tag filter (for the whole thing)

**Pinned**:
Kept at the top of its Gallery by the author's choice, for Notes and Canvases.
_Avoid_: favorite, starred

**Custom Order**:
The order the author arranges Notes in by hand. Pinned Notes and the rest each keep their own.
_UI_: en "Custom" / es "Personalizado"
_Avoid_: manual order

**Sort**:
How Notes are shown: by Custom Order, by title (A to Z, Z to A), or by Last Edited (newest or oldest first). A Sort keeps Notes in place as they are added, renamed, and edited. In the Notes list view it applies to Pinned Notes and the rest separately, and leaving it keeps the order it showed as the new Custom Order; in the tree view it applies inside each group. The list and tree views each keep their own Sort.
_Avoid_: order by, arrange

**Last Edited**:
When a Note's, Book's, or Canvas's content or title last changed, ignoring Tags, pins, order, and status. A Chapter text or title change moves its Book's Last Edited.
_Avoid_: updated, modified

**Heading**:
A titled division inside the text of a Chapter or Note, listed in the Outline and reachable by a Link.

**Link**:
A pointer from a Note, Chapter, or Text Node to a Book, Chapter, Note, heading, or web address that opens what it points to.
_Avoid_: mention, reference (reserved for Note Reference)

**Backlink**:
A Link from one Note to another, seen from the Note it points to; Links from Chapters and Text Nodes have no Backlink.
_UI_: en "Linked from" / es "Enlazado desde"

**Link Preview**:
What a Link points to, shown beside it without following it.
_Avoid_: tooltip, hover card, peek

**Ephemeral**:
A single scratch space for writing that is never saved and can be turned into a Note.
_Avoid_: scratchpad, scratch editor, draft

## Canvas

**Canvas**:
An infinite surface where an author lays out Text Nodes, Note References, Connections, and Drawings.
_UI_: es "Lienzos" for the Gallery, "Lienzo sin título" for an untitled Canvas
_Avoid_: mind map, board, and "canvas" for the Cover Designer

**Text Node**:
A block of rich text placed on a Canvas.
_Avoid_: lightweight node, idea, card

**Note Reference**:
An item on a Canvas that stands for a Note and opens it.
_Avoid_: note node, embed

**Missing Note Reference**:
A Note Reference whose Note no longer exists in the Library; it stays on the Canvas.
_UI_: en "Missing note" / es "Nota no disponible" when no title was kept

**Connection**:
A line joining two items on a Canvas, with an optional direction and caption.
_UI_: en "Connection label" / es "Etiqueta de conexión"
_Avoid_: edge, arrow

**Drawing**:
A freehand mark made on a Canvas.
_UI_: en "Pen" / es "Lápiz" (the tool that makes it)
_Avoid_: stroke, sketch

**Watermark**:
The faint MAIBUK figlet tiled behind a Canvas in Canvas coordinates, so the surface reads at scale as the author pans and zooms.
_Avoid_: background pattern, grid

## History

**Version**:
The saved state of one Book at a moment in time.
_UI_: en "Version history" / es "Historial de versiones"
_Avoid_: snapshot, revision

**Named Version**:
A Version the author chose to save, by saving one or by renaming any Version.
_UI_: en "Named" / es "Nombrada"
_Avoid_: manual version, milestone

**Checkpoint**:
A Version Maibuk took on its own (after idle time, on close, before a Pull of that Book, before a Restore, before a Plugin changes that Book), even when it carries an automatic name.
_UI_: en "Auto checkpoint", "On close", "Before sync", "Before restore"
_Avoid_: autosave version

**Version Trigger**:
The reason a Version was taken: the author, idle time, closing, before a Pull, before a Restore, or a Plugin before it changes the Book.

**Version Retention**:
Which Checkpoints a Book keeps: every recent one, then one per day, then one per week; Named Versions and Checkpoints taken before a Restore or by a Plugin are always kept. Every device keeps the same ones, and a Checkpoint it drops never comes back.
_Avoid_: version pruning cap, "Retention" alone (reserved for Backup Retention)

**Backup**:
A saved copy of the Library at a moment in time. Restoring it brings back Books, Notes, Canvases, and Version history; settings and metrics stay as they are.
_UI_: en "Backups" / es "Copias de seguridad"
_Avoid_: database export, dump, snapshot

**Backup Directory**:
Where Backups are kept on desktop: the app's own data folder by default, or a folder the author picks or types and confirms.
_UI_: en "Backup directory" / es "Carpeta de copias"

**Database File**:
A copy of the Library's writing and settings (not its metrics) saved to a file the author chooses, kept outside Backups and Backup Retention; loading one adds its contents to this Library, overwriting items that already exist, instead of clearing it first.
_UI_: en "Export Database", "Import Database"
_Avoid_: "backup" and "restore" for this file

**Backup Trigger**:
The reason a Backup was taken: daily, on close, before sync, before a Restore, Reset, or loading a Database File, or at the author's request.
_UI_: en "Pre-restore" / es "Pre-restauración" also before a Reset or loading a Database File _(known mismatch)_

**Backup Retention**:
How many Backups the Library keeps before the oldest are pruned; safety Backups taken before sync, a Restore, a Reset, or loading a Database File are kept longer.
_UI_: en "Maximum backups to keep"

**Restore**:
Bringing back the state saved in a Version or a Backup, replacing what is there now.
_Avoid_: revert, rollback, and "restore" for Unarchive or Keep

**Reset**:
Clearing everything in the Library on this device, including history, sync state, and metrics; app settings are kept.
_UI_: en "Reset Library" / es "Reiniciar biblioteca"
_Avoid_: wipe, factory reset

**Reset settings**:
Returning Maibuk's custom settings, Custom Shortcuts, custom Voice Commands, enabled preferences, Plugin approvals, and saved Plugin credentials to their defaults on this device; installed Plugin files and Library data stay.
_UI_: en "Reset settings", "Reset settings and delete credentials" / es "Reiniciar ajustes", "Reiniciar ajustes y borrar credenciales"
_Avoid_: wipe, factory reset

**Compare**:
Viewing the differences between a Version and the current Book.
_Avoid_: diff

## Sync

**Sync**:
Keeping a Library's Books, Notes, Canvases, history, and metrics the same across the author's devices, encrypted so the server can never read them.
_Avoid_: backup, upload, cloud save

**Passphrase**:
The secret, known only to the author, that encrypts and decrypts synced data.
_UI_: en "Encryption Passphrase" / es "Frase de cifrado"
_Avoid_: password (that signs the author in)

**Sync Account**:
The author's sign-in on the sync server, separate from the Passphrase.
_UI_: en "Account" / es "Cuenta"

**Synced Item**:
A Book, Note, or Canvas as Sync sees it: one thing that is pushed, pulled, or in Conflict as a whole.
_Avoid_: object, record, entity (in UI copy)

**Sync Scope**:
Which kinds of data a sync run covers: all, Books, Notes, Canvases, or metrics.

**Sync Direction**:
Which way a sync run moves changes: two-way, pull only, or push only.
_UI_: en "Two-way", "Pull only", "Push only" / es "Bidireccional", "Solo recibir", "Solo enviar"

**Auto Sync**:
Sync that runs on its own at launch and shortly after the author stops editing, setting aside anything that needs the author's answer.
_UI_: en "Sync automatically" / es "Sincronizar automáticamente"
_Avoid_: background sync, live sync

**Push**:
Sending this device's state of a Synced Item to the author's other devices.
_UI_: es "enviar"
_Avoid_: upload, es "subir"

**Pull**:
Replacing this device's state of a Synced Item with the state from another device.
_UI_: es "recibir"
_Avoid_: download, es "descargar"

**Sync Base**:
What a Synced Item looked like on both sides the last time this device synced it; what both sides are compared against to decide which one changed.
_Avoid_: last sync, common ancestor

**Conflict**:
A Synced Item changed on this device and elsewhere since its Sync Base (edited on both, or edited here and Deleted Elsewhere), so the author must choose which state wins. Choosing this device's state Pushes it; choosing the other device's Pulls it. The author keeps one state, never both: a Book's losing state survives as the Checkpoint taken before a Pull.
_UI_: en "Sync Conflict" / es "Conflicto de sincronización"
_Avoid_: collision, merge

**Deferred**:
A Synced Item a sync run set aside, such as a Conflict during Auto Sync or an item edited mid-run, until a manual sync settles it.

**Delete**:
The author getting rid of a Book, Chapter, Note, or Canvas; for a Synced Item, the next sync carries it to the other devices once the author confirms it in a Deletion Review.
_Avoid_: remove, trash, erase

**Tombstone**:
The mark a Delete leaves on this device, kept even after sync has carried the deletion so the item is never re-created here.
_Avoid_: deletion marker, soft delete

**Deleted Elsewhere**:
A Synced Item Deleted on another device that still exists on this one.
_UI_: en "Deleted on another device" / es "Eliminados en otro dispositivo"
_Avoid_: remote deletion (in UI copy)

**Deletion Review**:
The step where the author confirms pending deletions before a sync carries them out, both deletions made here and Deleted Elsewhere items; unconfirmed ones wait.
_UI_: en "Deletions made on this device", "Deleted on another device" / es "Eliminaciones hechas en este dispositivo", "Eliminados en otro dispositivo"

**Keep**:
Choosing, for a Deleted Elsewhere item that was also edited here, to hold on to this device's state and send it back to the other devices.
_UI_: en "Keep & Push" / es "Mantener y enviar"
_Avoid_: restore, undelete

**Sync Log**:
The list of what one sync run did to each Synced Item, including failures.
_UI_: en "Sync log" / es "Registro de sincronización"

**Change**:
One saved edit to a Synced Item, marked with its Origin and its Change Kind. (ADR 0003)
_Avoid_: event, mutation

**Origin**:
Where a Change came from: this device, or another device through a Pull. (ADR 0003)

**Change Kind**:
Whether a Change touched what an item says (content, including its title) or only how it is organized (metadata such as pin, order, and status). Every Change schedules Auto Sync regardless of kind; the kind only decides whether Last Edited moves. (ADR 0003)

**Change Feed**:
The single stream of Changes and Library signals that Auto Sync, Galleries, and open editors listen to: besides a Change, it carries a completed bulk operation and Library availability. (ADR 0003, 0026)
_Avoid_: event bus, notifications

**Entity Sync**:
The one shared Push, Pull, and Conflict path every Synced Item follows, with one adapter per kind carrying its local reads and writes. (ADR 0006, 0007)

## Editing

**Save Status**:
What the editor tells the author about saving the open Chapter, Note, or Canvas: saving, saved, not saved after a failed save of a Chapter or Note, or, for a Canvas, unsaved changes.
_Avoid_: dirty flag

**Flush**:
Saving what an open Chapter or Note editor still holds, done before a sync reads the Library and before a Version Restore; if that save fails, the sync or Restore stops.
_Avoid_: force save, commit

**Edit Session**:
The span from opening one Chapter, Note, or Canvas for editing to leaving it, during which Maibuk holds what the author typed until it is saved; leaving always Flushes. (ADR 0001)
_Avoid_: editor state, autosave

**Reading Position**:
Where the author was on this device: caret and scroll in a Chapter or Note, pan and zoom on a Canvas, and the spot a Plugin's reading view returns to.
_Avoid_: bookmark, cursor position

**Last Opened Chapter**:
The Chapter a Book reopens to.
_Avoid_: current chapter, resume point

**Focus Mode**:
A writing view that hides everything except the text.
_UI_: en "Focus Mode" / es "Modo Enfocado", "Alternar modo enfocado"
_Avoid_: zen mode, distraction-free mode

**Spell Check**:
Marking misspelled words while the author writes.
_UI_: en "Spell Check" / es "Corrector ortográfico"

**Custom Dictionary**:
The author's own list of words that Spell Check accepts.
_UI_: en "Custom dictionary" / es "Diccionario personalizado"
_Avoid_: word list, user dictionary

**Word Lookup**:
Finding a word's definition while writing.
_UI_: en "Look up word", "Word lookup" / es "Buscar palabra"
_Avoid_: dictionary (reserved for Custom Dictionary)

**Symbol**:
A special character or emoji inserted from Maibuk's picker or autocomplete.
_UI_: en "Insert symbol" / es "Insertar símbolo"

**Text Case**:
A transform applied to selected text: upper, lower, and playful effects such as mirrored or upside-down letters.
_UI_: es "Mayúsculas y minúsculas"

**Find and Replace**:
The panel in the editor that finds each match of a query in the open Chapter or Note and replaces it, sharing its Match case, Whole word, and Regular expression switches with Library Search. Literal matching ignores accents as the fixed default, with no fourth switch: "cancion" finds "canción" and back, and "ELENA" finds "Eléna" unless Match case is on. A Regular expression runs against the text as written, so it pins the exact accents.
_UI_: en "Find & Replace" / es "Buscar y Reemplazar"

**Paste Cleanup**:
The rules that reshape pasted text before it lands in a Chapter or Note, such as "Match my book".
_UI_: en "Paste cleanup" / es "Limpieza al pegar"

**Opening Marks**:
Maibuk adding the Spanish ¿ or ¡ at the start of a question or exclamation when the author types its closing ? or ! in Spanish text. A run of closing marks gets its opening marks in mirrored order ("¡¿Qué haces?!"). Off unless the author turns it on, on this device.
_UI_: en "Spanish opening marks (¿ ¡)" / es "Signos de apertura (¿ ¡)"
_Avoid_: auto-close (that is Auto-close pairs), inverted marks

**Dictation**:
Turning the author's speech into text in the editor or text field that has the caret, offline, with a downloaded Dictation Model.
_UI_: en "Dictation" / es "Dictado"
_Avoid_: voice typing, speech-to-text (in UI copy)

**Dictation Session**:
The span from starting Dictation to stopping it. One per app at a time; it follows the caret across the editors and text fields on the page, and never types behind an open dialog. A Voice Command that changes screen or opens a dialog keeps it listening: it goes on in the editor or text field that takes the caret there, or stops and says so when none does. (ADR 0016)

**Dictation Bar**:
The floating control on an editor screen that starts and stops a Dictation Session, picks its Dictation Language, and opens the Dictation settings. Its size is Full, Compact, or Hidden, set in Settings on this device; Hidden shows only a microphone while a Dictation Session is running. The author can also collapse it to the microphone alone, which keeps the chosen size.
_UI_: en "Dictation bar" / es "Barra de dictado"
_Avoid_: dictation control, floating bar, mic button

**Dictation Model**:
A named speech model for one or more Dictation Languages, downloaded and kept on this device. Each is described as Fast or Accurate, and one without live preview types a line only after each pause instead of while the author speaks. Each Dictation Language uses one installed Dictation Model, chosen per language. When a Dictation Language has none installed, the first Dictation Model downloaded for it is automatically selected for that language; later downloads leave that choice alone. Removing the Dictation Model a language uses switches that language to another installed Dictation Model for it, if any.
_Avoid_: voice pack

**Dictation Language**:
The language a Dictation Session listens for: the language of the editor it types into, or the app language in a text field (Auto), unless the author picked one for the Session. A Phrase Recording always listens in the language of the phrase being edited.

**Dictation Command Interpreter**:
The step between a finished spoken line and the editor that turns it into text, Spoken Punctuation, or a Voice Command, by fixed rules that do not depend on the Dictation Model. (ADR 0015)

**Spoken Punctuation**:
Words said while dictating that become punctuation, a paragraph or line break, or a list item instead of text, such as "comma" or "punto y aparte"; also the dictation words "scratch that", "literal", "capitalize" / "mayúscula", and the all-caps lock "all caps on" / "all caps off" ("mayúsculas activadas" / "mayúsculas desactivadas"), which lasts across lines until turned off or the Dictation Session ends. "numeral", in both languages, writes the number said after it in digits ("numeral twenty one" → "21"); with no number after it, it stays as a word. Each can be switched off and given extra phrases per Dictation Language, on this device. (ADR 0014)
_UI_: en "Spoken punctuation" / es "Puntuación dictada"
_Avoid_: voice command (for these)

**Voice Command**:
A spoken phrase, said on its own, that runs a Command instead of inserting text. Every Command takes them: formatting Commands answer to a verb and a target ("poner negrita"), every other Command to its own name in the Dictation Language ("go to Notes" / "ir a Notas"), and moving focus is a Command too ("press tab", "press enter"). A second way to run a Command, next to its Shortcuts; the author edits a Command's phrases per Dictation Language in the Shortcut Editor, and custom ones stay on this device. A formatting Voice Command ending in "that" / "eso" ("bold that", "poner en negrita eso") formats the last dictated sentence instead, like "scratch that" finds it. With Dictation on, the shortcut help lists the Voice Commands that work on the current screen. (ADR 0014, 0016)
_UI_: en "Voice commands" / es "Comandos de voz"
_Avoid_: voice shortcut

**Click by Name**:
Saying "click" / "pulsar" and then a control's visible name presses that control; when several share the name, each gets a number to say instead. (ADR 0016)
_Avoid_: voice click, tap

**Dictation Vocabulary**:
Words and names the author teaches Dictation: what the Dictation Model hears and what to write instead, per Dictation Language, on this device. (ADR 0014)
_UI_: en "Dictation vocabulary" / es "Vocabulario de dictado"
_Avoid_: dictionary (that is Spell Check's), autocorrect

**Phrase Recording**:
Saying a phrase once into the field where a Voice Command, a Dictation Vocabulary heard form, or a Spoken Punctuation phrase is written, so the field holds what the Dictation Model heard, mishearings included. It takes one line as heard, runs no Voice Command, and leaves the Dictation Session as it was; it changes nothing in the Dictation Model.
_UI_: en "Record phrase" / es "Grabar frase"
_Avoid_: voice training, teach

**Editor Toolbar**:
The row of Toolbar Buttons above a Chapter or Note editor, split into Start and End, as the author arranged it on this device.
_Avoid_: formatting bar, ribbon

**Toolbar Button**:
One unit the author places, shows, or hides in the Editor Toolbar or Selection Toolbar: a core tool or a Plugin's button. A core Toolbar Button can hold several controls that always move together, such as undo and redo, or font family and size.
_Avoid_: group, toolbar group, tool

**Start**, **End**:
The two sections of the Editor Toolbar: Start runs from the leading edge, End sits against the trailing edge.
_Avoid_: left, right (they flip in right-to-left layouts)

**Toolbar Divider**:
A thin line the author places between Toolbar Buttons to set them apart. Unlike a Toolbar Button, the author can place as many as they like, but never two side by side.
_UI_: en "Divider" / es "Separador"
_Avoid_: separator, divider on its own (Scene Break owns those words)

**Selection Toolbar**:
The small toolbar that appears beside selected Chapter or Note text, holding the Toolbar Buttons the author chose for it.
_UI_: en "selection menu" / es "menú de selección" _(known mismatch)_
_Avoid_: bubble menu, floating toolbar, selection menu

## Shortcuts

Maibuk is keyboard-first: everything the author can do can run from the keyboard.

**Command**:
Something the author can do from a key, a button, or an Item Menu, such as Bold, Save, or Delete Note. A Command may have no Shortcut.
_Avoid_: action (for this concept), hotkey

**Shortcut**:
A key combination, or a sequence of two (`g` then `p`), that runs a Command. A Command can have several.
_Avoid_: hotkey, keybinding, keymap (in UI copy)

**Default Shortcut**:
A Shortcut a Command ships with.

**Custom Shortcut**:
A Shortcut the author set on this device. A Command's Custom Shortcuts replace its editable Default Shortcuts, and never travel to other devices. (ADR 0012)
_Avoid_: override, user binding

**Fixed Shortcut**:
A Shortcut that cannot be changed or removed because the platform or the focused control owns its key, such as Mod+Z or Tab. The author can still add other Shortcuts to its Command.

**Sealed Command**:
A Command that takes no Shortcuts beyond its Fixed ones, such as jumping to a Book with 1-9.

**Shared Command**:
One Command that works on several screens, each doing its own version of it, such as Save or Undo. Changing its Shortcut changes it everywhere.
_UI_: en "Common" / es "Comunes"

**Shortcut Context**:
A part of the UI whose Commands can be live together, such as the Book Editor, the Editor, or a Note in a list. Two Shortcuts may share keys when no screen shows both of their Contexts.
_Avoid_: scope (in UI copy)

**Shortcut Conflict**:
Two Shortcuts with the same keys, or one that is the first key of the other's sequence, in Contexts some screen shows together.
_Avoid_: clash, collision

**Bound Shortcut**:
A Shortcut that works on the screen the author is on right now.
_UI_: en "On this screen" / es "En esta pantalla"
_Avoid_: hotkey, keybinding (for this concept)

**Shortcut Editor**:
Where the author sees every Command and changes its Shortcuts, opened from Settings or the shortcut help.
_UI_: en "Customize shortcuts" / es "Personalizar atajos"
_Avoid_: keymap editor, hotkey settings

**Single-key Shortcuts**:
The switch that turns off, on this device, every Shortcut pressed without a modifier key, except Fixed Shortcuts.
_UI_: en "Single-key shortcuts" / es "Atajos de una tecla"

**Shortcut File**:
A file holding the author's Custom Shortcuts and custom Voice Commands, to carry them to another device.
_UI_: en "Save to file", "Load from file" / es "Guardar en archivo", "Cargar desde archivo"
_Avoid_: export, import (reserved for Library content)

**Command Palette**:
Where the author finds something by typing part of its name, and runs or opens it from anywhere in the app. It has two modes, chosen by the input itself: Commands mode with a leading `>`, and Library Search without one. The results chosen most recently on this device are listed first, one list filtered to each mode's kinds, and the author can remove any of them from that list. With nothing typed, each mode suggests what to start with, so it is never empty. F1 and Mod+Shift+P open Commands mode with `>` typed; the Search Library Command opens Library Search empty.
_UI_: en "Command palette" / es "Paleta de comandos"
_Avoid_: command bar, quick open, launcher, search (alone for either mode)

**Commands mode**:
The Command Palette with a leading `>` typed: it finds Commands, Plugin Commands, and Settings rows, and never the author's Books, Chapters, Notes, or Canvases. Deleting the `>` switches the open palette to Library Search. With the field empty it lists the Commands and Settings rows chosen most recently on this device, then suggested Commands.
_UI_: en "Commands mode" / es "Modo comandos"
_Avoid_: command mode, palette mode

**Library Search**:
The Command Palette without a prefix: it finds a Book, Chapter, Note, or Canvas by typing part of its name and opens it. Typing `>` in the field leaves it for Commands mode, and Backspace on a lone `>` switches to it instead of closing the palette. With the field empty it lists the Library items opened most recently on this device, then the Chapters, Books, Notes, and Canvases pages, which narrow the search to one kind. Literal matching ignores accents as the fixed default, with no fourth switch, and counts the same matches Find and Replace counts for the same query and switches; a Regular expression pins the exact accents.
_UI_: en "Search" / es "Buscar"
_Avoid_: global search, library filter, quick open

**Pane**:
One area of a screen that the author moves focus between with F6 and Shift+F6, such as the Notes list, the note editor, or the navigation sidebar. When the keyboard moves focus into another Pane, the outline travels there and stays on the Pane holding focus until the author types, acts on a control, or presses Escape; the next keyboard move brings it back. F6 also names the Pane briefly. The Book side panel is a Pane.
_UI_: en "pane" / es "panel"
_Avoid_: region, area, section

## Import and export

**Import**:
Bringing outside files (EPUB, Markdown, plain text) into the Library as Books, Chapters, or Notes.
_Avoid_: "import" for bringing back a Backup (that is Restore)

**Compatibility Report**:
What an EPUB Import will convert, lose, or be blocked by, shown before importing.
_UI_: en "Compatibility report" / es "Reporte de compatibilidad"

**Export**:
Producing files from a Book, Chapter, Note, or Cover for use outside Maibuk (EPUB, PDF, Markdown, image).
_Avoid_: "export" for saving a Backup

## Metrics

**Writing Session**:
A stretch of active writing time, ended by a long enough pause.
_Avoid_: session (alone), sitting

**Streak**:
The run of consecutive days on which the author wrote at least their daily word threshold.
_UI_: en "Current streak" / es "Racha actual"

**Metrics Category**:
A kind of writing data the author chooses to collect or view: writing volume, time tracking, or engagement.
_UI_: en "Writing volume", "Time tracking", "Engagement"

## The app

**Release**:
A published build of Maibuk, known by its number (0.10.1). Not a Version: a Version is the saved state of one Book.
_Avoid_: version, app version, build

**Release Notes**:
What changed in each Release, grouped as added, changed, and fixed. Written in English first, then translated into every app language, one to one: each language lists the same Releases with the same items. An author reads them in their app language.
_UI_: en "What's new" / es "Novedades"
_Avoid_: changelog, update log, patch notes

**Update**:
Installing a newer Release over the installed one from inside Maibuk: the author starts it, watches it download, and the new Release runs after a restart. Not the Download Page, which hands the author a file to install themselves. Built for the Linux AppImage, deb, and rpm installs, which install as soon as the download ends, and the Windows NSIS install, which installs on Restart to update; not for the Arch package or the web (ADR 0037).
_UI_: en "Update" / es "Actualizar"
_Avoid_: upgrade, self-update, auto-update

**Download Page**:
The GitHub page of a Release where the author picks an installer by hand; the way to a newer Release when an Update is not possible.
_UI_: en "Download page" / es "Página de descarga"
_Avoid_: download (alone), releases page

**Resource Usage**:
How much processor time, memory, and disk space Maibuk itself takes on this device, not the whole machine's load. Shown in the tray on desktop when the author turns it on.
_UI_: en "Show resource usage in tray" / es "Mostrar uso de recursos en la bandeja"
_Avoid_: stats, metrics (reserved for writing data), system usage

## Decided, not built

Accepted in `docs/adr/`; the app does not work this way yet. ADR 0004 also widens Reading Position to cover the Last Opened Chapter.

**Plugin**:
A packaged addition to Maibuk that adds its own Commands, pages, Settings rows, or buttons without changing Maibuk itself, and reaches the author's work only through the Plugin Permissions it was granted. Maibuk's own and the author's Plugins work the same way (ADR 0019).
_Avoid_: extension (TipTap's word in code), add-on, mod

**Built-in Plugin**:
A Plugin that ships with Maibuk. It is copied into the Plugin Directory and starts disabled, with its Plugin Permissions already granted, so turning it on needs no review; the author can revoke those grants like any other.

**Plugin Directory**:
The folder on this device that Maibuk loads Plugins from, chosen in Settings (ADR 0020).
_Avoid_: plugins folder, extensions folder

**Plugin Platforms**:
The devices a Plugin says it runs on. A Plugin that names none runs on desktop and the web; it runs on Android only when it names Android, because there it runs in a slower, memory-capped engine that its author must have tried.
_Avoid_: targets, supported OS

**Plugin Permission**:
One kind of access a Plugin declares, such as reading the Library or reaching a named web host, and that the author grants or revokes.
_Avoid_: grant, scope, capability (Tauri's word in code)

**File Grant**:
Maibuk's leave for one Plugin to read again, on this device, a file the author picked for it. The Plugin never learns where the file lives. A File Grant is not part of the Library, so Backups and Sync never carry it; it ends when the Plugin lets it go, when the Plugin is removed, when the author revokes the Plugin Permission that let the Plugin ask for files, or when the author runs Reset settings.
_Avoid_: file handle, file path, file permission, bookmark

**Plugin Endpoint**:
The local address `http://127.0.0.1:<port>/plugin/<pluginId>/` where Maibuk hands each request to the Plugin its path names; only a Plugin holding the `serve` Plugin Permission answers, and Maibuk binds the one port only while an enabled Plugin holds `serve`, on the desktop app only. Maibuk picks that port once and keeps it across launches, moving it only when another program holds it at launch; a Plugin holding `serve` reads the address with `endpoint.address` and hears a move as `endpoint.addressChanged`. A request from a foreign Origin is refused (403), and so is one naming a foreign Host. (ADR 0031)
_Avoid_: plugin server, MCP port, local API

**Host-rendered UI**:
A Plugin's interface drawn by Maibuk from the React/JSX the Plugin writes against the SDK's component counterparts, so Maibuk owns focus, keyboard behavior, and typing. The other path is a custom `Frame`. (ADR 0021)
_Avoid_: extension UI, add-on UI, mod UI

**Plugin Command**:
A Command a Plugin declares, with the same identity, Shortcuts, Voice Commands, availability, and Command Palette behavior as a Maibuk Command. The host derives its id as `plugin.<pluginId>.<localId>`, so no Plugin can claim Maibuk's or another Plugin's ids. (ADR 0022)

**Toggle Button**:
A Plugin's editor toolbar button that shows whether what it switches is on or off. The Plugin sets that state; Maibuk shows it as off until the Plugin says otherwise and again once the Plugin stops.
_Avoid_: switch button, stateful button, checkbox button

**Inactive Binding**:
A Plugin's Custom Shortcut or custom Voice Command whose Plugin is absent, or whose keys or phrase an existing active binding already owns. It is kept and shown in the Shortcut Editor, does not reserve what it asks for, and never stops the Command's other ways of running. (ADR 0024)

**Stopped Plugin**:
An enabled Plugin that stopped on a limit (a crash, the startup limit, no answer, out of memory, too much interface) or was refused when it tried to start, until it next starts cleanly or the author disables or removes it. Its sidebar entry is marked and its page says why, with a way to try again. A Plugin stopped because nothing used it, or because it was asked to, is not a Stopped Plugin.
_UI_: en "Stopped"
_Avoid_: broken plugin, plugin issue, error state, crashed plugin (a crash is one reason among several)

**Retained Plugin Preference**:
A Custom Shortcut or custom Voice Command under `plugin.<pluginId>.` kept on this device while its Plugin is away, inactive until it returns. Removing a Plugin offers to erase it, Reset all always does, and a Shortcut File carries it like any other preference. (ADR 0024)

## Relationships

- A **Library** holds many **Books**, **Notes**, and **Canvases**.
- A **Book** has ordered **Chapters**, one **Cover**, and many **Versions**.
- A **Note** belongs to zero or one **Book**: a **Book Note** or an **Unfiled Note**.
- A **Canvas** holds **Text Nodes**, **Note References**, **Connections**, and **Drawings**; a **Note Reference** points at one **Note**.
- A **Version** saves one **Book**; a **Backup** saves the whole **Library**.
- A **Database File** is not a **Backup**, and loading one is not a **Restore**.
- **Books**, **Notes**, and **Canvases** are **Synced Items**; each has one **Sync Base** per device.
- Deleting a **Book**, **Note**, or **Canvas** leaves a **Tombstone** here; after a **Deletion Review** it becomes **Deleted Elsewhere** on the other devices, where a second **Deletion Review** confirms it; if the item was also edited there, a **Conflict** lets the author **Keep** it instead.
- Open editors **Flush** before a **Sync** reads the **Library**.
- A **Command** has zero or more **Shortcuts**: its **Fixed Shortcuts**, plus its **Custom Shortcuts** or else its **Default Shortcuts**.
- The **Tutorial** runs in a **Tutorial Library**, never in the author's **Library**; ending it brings back the author's own.
- A **Dictation Session** uses one **Dictation Model** and inserts into whichever editor or text field has the caret.
- A **Command** may also have **Voice Commands**; **Spoken Punctuation** and the **Dictation Vocabulary** are not Commands, and all three are kept per **Dictation Language**.
- A **Plugin** is loaded from the **Plugin Directory** and reaches the **Library** only through its **Plugin Permissions**; the data it keeps is in the **Library** and its **Backups**, but it is not a **Synced Item**.

## Anticipated

Reserved words for features nobody has decided to build.

**Synopsis**:
A short summary of a Chapter's content.

**Canvas Shape**:
A geometric figure (rectangle, ellipse, or pointer) placed on a Canvas, as opposed to the shapes the Cover Designer already has.

**AI Assist**:
Help from a language model while writing.

**Canvas History**:
Versions of a Canvas.

**Series**:
An ordered group of Books told in sequence.

**Character**:
A person in the author's story, described outside the Book's Chapters.

**Location**:
A place in the author's story, described outside the Book's Chapters.

**Story Bible**:
The collection of a Book's or Series' Characters and Locations.
_Avoid_: codex, wiki, world

**Draft Round**:
A numbered pass of rewriting over a whole Book.
_Avoid_: draft (that is a Book Status and a Chapter Status), revision

**Daily Goal**:
The number of words an author aims to write each day, shown as progress; unlike the Streak threshold, which only decides whether a day counts.
_Avoid_: target (that is Target Word Count)

**Comment**:
A remark attached to a spot in the text and kept out of the Book itself.
_Avoid_: annotation, footnote

**Pen Name**:
The name a Book is published under when it differs from the author's own name.
_Avoid_: pseudonym
