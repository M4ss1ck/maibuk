---
status: accepted
---

# Every Command takes voice, with default phrases from its label

The goal is to run the app by voice alone, as it already runs by keyboard alone (#267). Every registry Command is voice-eligible. A Command without a `voice` spec gets its label as its default phrase, in each Dictation Language from that language's locale file: "Go to Notes" / "Ir a Notas", normalized and matched as the whole line with no fillers. An explicit `voice` spec (verb × target, polarity, demonstrative) still wins for marks, lists, and any Command whose label makes a poor phrase. This supersedes ADR 0014's "default phrases are recognizer input, not UI copy" for Commands without a `voice` spec; Spoken Punctuation and the Dictation Vocabulary are unchanged.

Keyboard parity also needs the keys that move focus, so Tab, Shift+Tab, the arrows, Home/End, Enter, Space, and Escape become `focus.*` Commands with fixed, sealed keys, and take Voice Commands like any other ("press tab", "press enter"). Click by Name ("click Export" / "pulsar Exportar") presses the enabled control in the topmost non-inert layer whose whole accessible name was said; when several match, numbered badges appear and "click 2" picks one.

## Considered Options

- Hand-author a `voice` spec for all ~155 remaining Commands: rejected. Two lists per Command drift from the labels authors see, and each new Command would ship without voice until someone wrote one.
- Make the focus keys a fixed dictation vocabulary like Spoken Punctuation: rejected. ADR 0014 keeps things out of the registry when a Shortcut for them is meaningless; for these the key is the Shortcut.
- Refuse Voice Commands while a dialog is open, as key Shortcuts pause: rejected. A voice-only author could then never leave a dialog. Global Commands run with the dialog open; a navigating Command first closes every open dialog through its own close path (so a dialog that refuses, such as a running export, refuses the navigation); Commands whose Context is behind the dialog are refused.
- On an ambiguous Click by Name, click the match nearest focus or only announce the count: rejected. The first guesses; the second leaves a voice-only author stuck.

## Consequences

- A gate test fails when a derived phrase is a single word (ADR 0014's two-word rule) or conflicts with another phrase in overlapping Contexts, unless the Command carries an explicit `voice` spec or is listed with a reason.
- Renaming a Command's label changes its default phrase. Custom Voice Commands are keyed by Command id and survive.
- Commands run without a KeyboardEvent through one entry point shared with the Command Palette (#226), which applies the same enabled and Tutorial gates as `useShortcuts`.
- The Dictation Session keeps listening when a Voice Command changes screen and hands off to the editor that takes the caret there; with none, it stops and says so.
- While a Tutorial runs, only `tutorial.skip`, the `focus.*` Commands, and Click by Name act by voice, confined to the Tutorial card by the same `inert` boundary as keys.
- Dictating into plain text fields is a separate change.
