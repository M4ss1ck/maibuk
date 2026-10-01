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
The actions for one Note, Chapter, Text Node, or Note Reference, opened from its ⋯ button (lists only), a long-press on touch, or a right click.
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

**Pinned**:
Kept at the top of its Gallery by the author's choice, for Notes and Canvases.
_Avoid_: favorite, starred

**Last Edited**:
When a Note's, Book's, or Canvas's content or title last changed, ignoring Tags, pins, order, and status. A Chapter text or title change moves its Book's Last Edited.
_Avoid_: updated, modified

**Heading**:
A titled division inside the text of a Chapter or Note, listed in the Outline and reachable by a Link.

**Link**:
A pointer from a Note, Chapter, or Text Node to a Book, Chapter, Note, or heading that opens what it points to.
_Avoid_: mention, reference (reserved for Note Reference)

**Backlink**:
A Link from one Note to another, seen from the Note it points to; Links from Chapters and Text Nodes have no Backlink.
_UI_: en "Linked from" / es "Enlazado desde"

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

## History

**Version**:
The saved state of one Book at a moment in time.
_UI_: en "Version history" / es "Historial de versiones"
_Avoid_: snapshot, revision

**Named Version**:
A Version the author chose to save.
_UI_: en "Named" / es "Nombrada"
_Avoid_: manual version, milestone

**Checkpoint**:
A Version Maibuk took on its own (after idle time, on close, before a Pull of that Book, before a Restore), even when it carries an automatic name.
_UI_: en "Auto checkpoint", "On close", "Before sync", "Before restore"
_Avoid_: autosave version

**Version Trigger**:
The reason a Version was taken: the author, idle time, closing, before a Pull, or before a Restore.

**Backup**:
A saved copy of the Library at a moment in time. Restoring it brings back Books, Notes, Canvases, and Version history; settings and metrics stay as they are.
_UI_: en "Backups" / es "Copias de seguridad"
_Avoid_: database export, dump, snapshot

**Backup Directory**:
Where Backups are kept on desktop: the app's own data folder by default, or a folder the author picks or types and confirms.
_UI_: en "Backup directory" / es "Carpeta de copias"

**Database File**:
A copy of the Library's writing and settings (not its metrics) saved to a file the author chooses, kept outside Backups and Retention; loading one adds its contents to this Library, overwriting items that already exist, instead of clearing it first.
_UI_: en "Export Database", "Import Database"
_Avoid_: "backup" and "restore" for this file

**Backup Trigger**:
The reason a Backup was taken: daily, on close, before sync, before a Restore, Reset, or loading a Database File, or at the author's request.
_UI_: en "Pre-restore" / es "Pre-restauración" also before a Reset or loading a Database File _(known mismatch)_

**Retention**:
How many Backups the Library keeps before the oldest are pruned; safety Backups taken before sync, a Restore, a Reset, or loading a Database File are kept longer.
_UI_: en "Maximum backups to keep"

**Restore**:
Bringing back the state saved in a Version or a Backup, replacing what is there now.
_Avoid_: revert, rollback, and "restore" for Unarchive or Keep

**Reset**:
Clearing everything in the Library on this device, including history, sync state, and metrics; app settings are kept.
_UI_: en "Reset Library" / es "Reiniciar biblioteca"
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
The single stream of Changes that Auto Sync, Galleries, and open editors listen to. (ADR 0003)
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
Where the author was on this device: caret and scroll in a Chapter or Note, and pan and zoom on a Canvas.
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

**Paste Cleanup**:
The rules that reshape pasted text before it lands in a Chapter or Note, such as "Match my book".
_UI_: en "Paste cleanup" / es "Limpieza al pegar"

**Dictation**:
Turning the author's speech into text in the editor or text field that has the caret, offline, with a downloaded Dictation Model.
_UI_: en "Dictation" / es "Dictado"
_Avoid_: voice typing, speech-to-text (in UI copy)

**Dictation Session**:
The span from starting Dictation to stopping it. One per app at a time; it follows the caret across the editors and text fields on the page, and never types behind an open dialog. A Voice Command that changes screen or opens a dialog keeps it listening: it goes on in the editor or text field that takes the caret there, or stops and says so when none does. (ADR 0016)

**Dictation Model**:
A downloaded speech model for one language and tier (Fast or Accurate), kept on this device.
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
Where the author finds a Command, a Book, Chapter, Note, or Canvas, or a Settings row by typing part of its name, and runs or opens it from anywhere in the app. The results chosen most recently on this device are listed first, and the author can remove any of them from that list. With nothing typed, it also suggests common destinations and Commands, so it is never empty.
_UI_: en "Command palette" / es "Paleta de comandos"
_Avoid_: command bar, quick open, launcher, search (reserved for searching Library content)

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

## Decided, not built

Accepted in `docs/adr/`; the app does not work this way yet. ADR 0004 also widens Reading Position to cover the Last Opened Chapter.

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
