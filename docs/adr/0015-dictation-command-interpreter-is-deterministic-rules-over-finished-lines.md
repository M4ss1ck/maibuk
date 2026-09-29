---
status: accepted
---

# The Dictation Command Interpreter is deterministic rules over finished lines

The Dictation Command Interpreter is a hand-written, pure TypeScript module that runs once per finished line (Moonshine's `LineCompleted`, never a partial) and turns it into edits or one Voice Command. It reads only the line's text, a bounded slice of text before the caret, and the Dictation Model's capability flags, so it works the same for any engine behind `RecognizerHost` (ADR 0013). Order per line: Dictation Vocabulary replacements (their output is literal text), then whole-line Voice Command match, then the escape word, then Spoken Punctuation matched anywhere in the line, longest match first, then spacing, casing, and Spanish `¿`/`¡` per Dictation Language. Matching folds case and accents and ignores the model's own punctuation, because models add it around spoken command words and capability flags describe the usual output, not a guarantee (`docs/research/dictation-command-interpreter.md` section 2.4).

The budget is under 1 ms p99 per line with 1,000 aliases and Vocabulary entries, and under 10 ms to rebuild the phrase table, measured by a periodic benchmark. The gate lane asserts the algorithm (one pass over a token trie) instead of timings.

## Considered Options

- Grammar-constrained decoding (SRGS/JSGF, Vosk phrase lists): rejected. Moonshine is an encoder-decoder with no grammar input.
- Moonshine's `IntentRecognizer` or any intent model: rejected. It is fuzzy by design, needs a second model download, and has no WASM binding.
- Fuzzy string matching (Fuse.js and similar): rejected. It lets prose trigger actions; Spoken Punctuation aliases and the Dictation Vocabulary absorb consistent mishearings deterministically.
- A language model to punctuate or interpret: rejected for the same reason, and it would put a model between every line and the page.
- A parser library (nearley, Ohm, Chevrotain) or a statechart library: rejected. The job is a token trie and three fields of state.

## Consequences

- Same input, same output: every behavior is a fixture test with real model transcripts.
- A word the author means as prose ("period of time", "dos puntos y una lista") is protected by the whole-line rule for Voice Commands and by the escape word inside a line, not by guessing.
- Deciding by pauses inside a line needs word timestamps, a change to the `RecognizerHost` events and its own ADR.
