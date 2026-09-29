---
status: accepted (not implemented)
---

# Voice Commands bind Commands; Spoken Punctuation and the Dictation Vocabulary are Dictation settings

Dictation gets two kinds of spoken phrase, kept apart on purpose. A **Voice Command** is a second way to run a registry Command, next to its Shortcuts: "poner negrita" runs the same Command as Mod+B. **Spoken Punctuation** ("coma", "new paragraph", "scratch that", "literal") and the **Dictation Vocabulary** (heard form → written form) are not Commands; they are Dictation settings, listed in Settings → Dictation, where each Spoken Punctuation entry can be switched off and given extra phrases. Every phrase of all three is keyed by Dictation Language, not by UI locale, because a Spanish-UI author writing an English Book speaks English to the model.

Voice Command phrases are generated, not listed one by one: each language has a vocabulary of verb classes with a polarity (en "make, set, turn on" / "remove, turn off"; es "poner, activar, usar" / "quitar, desactivar"), filler words the match ignores ("la", "en", "the"), and each voice-eligible Command declares its target nouns per language ("negrita", "negritas"). A line is a Voice Command only when the whole line is `verb [filler...] target` or an author's custom phrase, and a custom phrase must be at least two words. A Voice Command acts like its Command: on the selection, else on the text dictated next; an on-verb never turns formatting off.

Custom Voice Commands are a second binding kind in ADR 0012's device-local layer (store version 2 with a migration) and travel in the Shortcut File. Spoken Punctuation switches and aliases and the Dictation Vocabulary live in the device-local Dictation store and do not travel in the Shortcut File. Default phrases live in a Dictation data file per language, not in `en.json`/`es.json`: they are recognizer input, not UI copy. A phrase that normalizes to the same words as a phrase in the other kind, in the same Dictation Language, is refused.

## Considered Options

- Make punctuation and layout registry Commands (`dictation.comma`...) so one Shortcut Editor, one file, and one conflict check cover everything: rejected. A Shortcut for "comma" is meaningless, and it would add a dozen rows to the Shortcut Editor that only make sense spoken.
- List every Voice Command phrase by hand per Command: rejected. Real phrasing varies ("poner negrita", "poner en negrita", "activar negritas"); a shared verb vocabulary covers bold, italic, underline, and the rest with one list per language.
- Allow single-word Voice Commands, guarded by the pause: rejected. Apple advises "two or more words"; a single word ends many spoken sentences.
- Key phrases by UI locale: rejected, see above.
- Pass Vocabulary words to the model as context biasing (Moonshine `set_context`): not in v1. It needs a provider-specific change to the `RecognizerHost` protocol (ADR 0013); the Interpreter's own replacement is model-agnostic. Kept only if a measurement shows it adds accuracy without slowing lines.

## Consequences

- Changing a Command's target nouns or the verb vocabulary changes what authors can say; the vocabulary files have a gate test that fails when two Commands expand to the same phrase.
- App-level Commands ("save", "go to Notes") need an event-free entry point on their bindings before they can take Voice Commands; v1 covers Commands that already run without a KeyboardEvent (`EDITOR_COMMANDS`).
- Default phrases carry heard forms: how the Dictation Models write a default word when they mishear it the same way every time ("quitad" for "quitar", "cierre interrogación" for "cierra interrogación"), taken from the phrase conformance recordings (#285). A Voice Command line is tried as heard first and with the heard forms rewritten second, so the whole-line rule still protects prose. They are data next to the defaults, not phrases: the Shortcut Editor and the Spoken Punctuation list do not show them, and the author's own aliases and Vocabulary remain the way to fix a voice the defaults miss.
- Every Voice Command that runs is announced in a live region; Spoken Punctuation is not, because the character is the feedback.
