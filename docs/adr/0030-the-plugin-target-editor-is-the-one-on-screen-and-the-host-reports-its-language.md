---
status: accepted
---

# The Plugin target editor is the one on screen, and the host reports its language

The Plugin editor methods (`editor.getContent`, `getSelection`, `reveal`, `setHighlights`, `insert`, `replace`) address one target editor. It is the editor that last took focus, else, when none has, the only editor on screen. `editor.focusChanged` follows that target, not DOM focus. The Ephemeral is a target too, as the editor entity `{ kind: "ephemeral", id: "ephemeral" }`, since it has no Library row. `editor.getContent` reports the language the text is written in, and the host works it out: a Note's own language, else its Book's; a Chapter's Book's language; for the Ephemeral, its Spell Check language. A change of language is reported as `editor.contentChanged`. These additions are Plugin API 0.1.2 (ADR 0029).

Decided while fixing Echoes, which did nothing on an existing Note opened and toggled without first placing the caret, and while extending it to the Ephemeral.

## Considered Options

- The target is only an editor that has had focus (the 0.1.1 rule): rejected. Opening a Note and going straight to a toolbar button or a Shortcut is the ordinary path, and every editor Command then failed with no message.
- Fix it in Echoes by moving focus into the editor before acting: rejected. Every Plugin would need the same workaround, and a Shortcut run from the Chapter list would steal focus.
- Each Plugin works out the language itself from Library reads (Echoes 0.2.0 did): rejected. The Ephemeral has no Library row to read, and the host already knows the language of the editor it shows.
- Use the editor's Spell Check language everywhere: rejected. Spell Check only knows English and Spanish, and Notes default to English, so a Book in another language would lose Echoes' Limited support, and a Note's fallback to its Book's language would be lost.

## Consequences

- With two editors on screen and neither ever focused, there is no target: the host does not guess between them.
- A Plugin toolbar button whose Command's only Context is `editor` is disabled while there is no target (the Embed editor never registers one), instead of running as a silent no-op.
- Editor entity kinds are a superset of the Library entity kinds. A Plugin that passes an editor entity to a Library read or to `navigation.openEntity` must handle `ephemeral` first.
