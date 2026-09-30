# Context biasing for the Dictation Vocabulary (issue #274)

Research date: 2026-09-30. Moonshine Voice v0.1.5 (the vendored runtime), desktop engine (`src-tauri/src/dictation/engine/moonshine.rs`), the catalog's Dictation Models. The spec and the frozen go bar are in [#274](https://github.com/M4ss1ck/maibuk/issues/274#issuecomment-5920504800). The baseline is in [the baseline comment](https://github.com/M4ss1ck/maibuk/issues/274#issuecomment-5921153652).

## Verdict

**Discard both options.** Neither (a) the Dictation Vocabulary written forms nor (b) the Book's text meets bar 1 on the Accurate models (`moonshine-small-en` and `moonshine-small-es`), in either Dictation Language, and both lower the hit rate on the existing phrase clips by more than bar 2 allows.

- **(a) Vocabulary written forms: discard.** English gets worse: 5.3 points fewer names typed right. Spanish gains 15.8 points against the 20 the bar asks. A higher `keyterm_boost`, the one extra try the spec allows, gains no more names and costs a further 0.9 points on the existing phrases (1.9 below no biasing).
- **(b) the Book's text: discard.** The open Chapter ties (a) on names in English and does worse in Spanish, lowers the existing phrase hit rate by 2.5 to 3.7 points, and slows the English Accurate model's lines by 17%. The whole Book was not transcribed: `setContext` on it takes about 265 ms in Spanish, five times bar 5's limit, so bar 5's other test (the whole Book must beat the open Chapter on names) does not arise; its term list also only grows past the Chapter's.

The Interpreter's Dictation Vocabulary stays the only way to teach Dictation a name.

## What was measured

- **Names tier** (#341): 10 prose lines per Dictation Language carrying 19 unusual names and jargon, one take each, scored only on the name words, as exact written forms, over the text the Interpreter types.
- **Names said alone**: each of the 19 names said once, the Phrase Recording an author would make. `phraseRecordingVocabulary()` turns each condition's own transcript of these clips into the Dictation Vocabulary for that condition, the same way `session.recordPhrase` keeps the first finished line with words. Every condition is therefore scored the way an author would use it: record the names with biasing on, then dictate.
- **Existing phrase clips** (#285): every other clip, scored by the ship-bar scorer.
- **Latency**: the engine's reported latency for every finished line in the phrase lane (fed faster than real time, the same engine and line mapping as a live session), plus the real-time lane on the long WAVs for (a).
- **Conditions**, set from the environment by the lane (`Bias` in `runner.rs`):
  - `base`: no biasing.
  - `a-keyterms`: the 19 written forms as the `keyterms` load option. `setContext` only picks words the tokenizer spells in several pieces, so a list is the only way to be sure every written form is asked for.
  - `a-keyterms-boost3`: the same with `keyterm_boost=3.0` (default 2.0), Spanish Accurate only.
  - `b-chapter`: `setContext` with a 5,475-word (en) or 5,437-word (es) Chapter of a public-domain novel, each name carried three times in sentences that are not the recorded lines, after the written forms repeated to outrank the passage's own terms (`scripts/dictation-phrases/passages.ts`).

## Results against the go bar (Accurate models)

Every column compares a condition with `base`, the same clips with no biasing. For names (bar 1), both sides use their own run's Phrase Recording Vocabulary: `base` scores 21.1% English, 36.8% Spanish. The Vocabulary Andy made in Settings scored 21.1% and 26.3% on the same clips (#274 baseline comment), so the recorded baseline is the harder one to beat in Spanish. The Vocabulary touches only the names tier, so bars 2 to 4 are the same with or without it.

A *misheard* prose trigger is a prose sentence the model misheard into a Command or a mark. The lane also counts 3 prose sentences that run a Command on their own text by design (ADR 0015, "Use code." and the like); those are the same in every run and are not in the bar.

| Condition | Language | Names (bar 1: ≥ +20 pts) | Existing phrases (bar 2: ≥ −1 pt) | Misheard prose triggers (bar 3: 0) | Line latency p50 (bar 4: ≤ +5%) |
| --- | --- | --- | --- | --- | --- |
| a-keyterms | en | 21.1% → 15.8% (**−5.3**) FAIL | 30.1% → 26.9% (**−3.2**) FAIL | 0 | 204 → 207 ms (+1.5%) |
| a-keyterms | es | 36.8% → 52.6% (**+15.8**) FAIL | 94.4% → 93.4% (**−1.03**) FAIL | 0 | 75.5 → 75.5 ms (0%) |
| a-keyterms-boost3 | es | 36.8% → 52.6% (**+15.8**) FAIL | 94.4% → 92.5% (**−1.9**) FAIL | 0 | 75.5 → 76 ms (+0.7%) |
| b-chapter | en | 21.1% → 15.8% (**−5.3**) FAIL | 30.1% → 26.4% (**−3.7**) FAIL | 0 | 204 → 238 ms (**+16.7%**) FAIL |
| b-chapter | es | 36.8% → 47.4% (**+10.5**) FAIL | 94.4% → 91.9% (**−2.5**) FAIL | 0 | 75.5 → 76 ms (+0.7%) |

Real-time lane, (a) on the long WAVs: line latency p50 177 → 167 ms in English (13 lines) and 76 → 79 ms in Spanish (33 lines, +3.9%). With this few lines the English drop is noise.

Bar 5, `setContext` on the desktop engine, median of five calls (`set_context_timing` in `runner.rs`):

| Passage | English | Spanish |
| --- | --- | --- |
| 19 written forms | 0.05 ms | 0.7 ms |
| Chapter, ~5,450 words | 2.8 ms | 34 ms |
| Book, ~100,450 words | 36 ms | **262 to 266 ms** (FAIL) |

The Spanish models' tokenizer logs "No byte fallback block in this vocabulary … falling back to longest-match encoding" at load, which is the likely cause of the tenfold cost.

## Findings worth keeping

- **Biasing moves the Vocabulary more than the model.** On its own, the Accurate model typed few more names exactly with keyterms: English 2 → 3 of 19 (Kubernetes), Spanish 1 → 2 (pierogi). Neither run produced a Spanish capital. What changed the scores is how often a Vocabulary entry matched the name in a sentence:
  - In Spanish, biasing made the model hear a name alone and in a sentence the same way more often, so three more entries matched (Xóchitl, Tlaquepaque, pierogi): 7 → 10 names.
  - In English it went the other way: the Phrase Recordings made with biasing on heard sfumato and Aelfric differently from the sentences, so those entries stopped matching: 4 → 3 names, with Kubernetes gained and sfumato and Aelfric lost.
- **The existing phrases pay for the list.** With the 19 terms active, the existing phrase clips dropped 3.2 points in English and 1.03 in Spanish: the cost on words not asked for that Moonshine's own docs warn about.
- **A Phrase Recording can make a harmful entry.** Tiny English heard "Redis" said alone as "ready". Saved as a Vocabulary entry, every "ready" the author dictates becomes "Redis". The Vocabulary has no guard against a heard form that is a common word; worth its own issue if authors hit it.
- **A name at the start of a finished line loses its capital** unless a Vocabulary entry writes it: the Interpreter lowercases the first word of a line that continues a sentence, and models often end a line before an unknown word (#341).

## Limits

- One speaker, one take per clip, 19 names per language: one name is 5.3 points. Spanish (a) missed bar 1 by 4.2 points, less than one name, but it also failed bar 2, at both boosts, and English moved the wrong way, so a second take is unlikely to change the verdict.
- The web engine was not measured, so the web half of bar 4 and bar 5 is unassessed. It runs the same Moonshine release and models, so recognition, and with it bars 1 and 2, should match; latency and `setContext` timing in WebAssembly are unknown. The discard rests on bars 1 and 2.
- The whole-Book option was not transcribed (see the verdict).

## Reproduce

```bash
pnpm record:dictation-phrases en        # then es: the names tier and the names said alone
pnpm exec tsx scripts/dictation-phrases/context.ts   # passages, from Project Gutenberg pg98 and pg2000
cd src-tauri
C=$PWD/../vendor/moonshine/context
BIAS_LABEL=base cargo test --release dictation::runner::tests::phrase_transcripts -- --ignored --nocapture
BIAS_LABEL=a-keyterms BIAS_KEYTERMS=$C/{lang}/keyterms.txt cargo test --release dictation::runner::tests::phrase_transcripts -- --ignored --nocapture
BIAS_LABEL=b-chapter BIAS_CONTEXT=$C/{lang}/chapter-forms.txt cargo test --release dictation::runner::tests::phrase_transcripts -- --ignored --nocapture
BIAS_TIMING="$C/{lang}/chapter.txt,$C/{lang}/book.txt" cargo test --release dictation::runner::tests::set_context_timing -- --ignored --nocapture
cd ..
pnpm exec tsx scripts/dictation-phrases/score.ts --label a-keyterms --vocabulary-from-clips   # per label
pnpm exec tsx scripts/dictation-phrases/biasing-results.ts                                    # every table above
```

`CONFORMANCE_MODELS=<id>,<id>` limits a run to some models; `BIAS_BOOST` sets `keyterm_boost`.

## What would justify reopening

- A Moonshine release whose streaming models gain on these names without losing on the existing phrase clips: rerun the commands above, since the bar and the recordings are unchanged.
- A Spanish tokenizer with byte fallback, if `setContext` on the whole Book is the goal.
- Authors reporting names the Dictation Vocabulary cannot catch because the model spells them a different way each time, which is the case biasing addresses and the Vocabulary cannot.
