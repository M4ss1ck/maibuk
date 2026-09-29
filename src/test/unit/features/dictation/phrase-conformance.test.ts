// Gate-lane checks on the Dictation phrase conformance lane (issue #285): the
// recording script must keep covering every default phrase's units, and the
// scorer must turn transcripts into the right verdicts. No model runs here.
import { describe, expect, it } from "vitest";
import { entriesFor, catalogCapabilities } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import {
  defaultPhrases,
  phraseCount,
  proseTriggers,
  scoreModel,
  splitVoicePhrase,
  voiceClipHit,
  voiceUnits,
  type Clip,
} from "@/test/support/dictation-phrase-score";
import { clipSlug, phraseItems } from "@/test/support/dictation-phrase-set";

const LANGUAGES: DictationLanguage[] = ["en", "es"];
const NO_PUNCTUATION = { casing: false, punctuation: false, streaming: true };
const PUNCTUATES = { casing: true, punctuation: true, streaming: true };

/** Every clip heard exactly as it was read. */
function perfectClips(language: DictationLanguage): Clip[] {
  return phraseItems(language).map((item) => ({ itemId: item.id, finals: [item.say] }));
}

describe("the recording script", () => {
  it.each(LANGUAGES)("%s: clip ids are unique and file-safe", (language) => {
    const ids = phraseItems(language).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[vpx]-[a-z0-9-]+$/);
  });

  it.each(LANGUAGES)("%s: every voice line is a default phrase", (language) => {
    for (const item of phraseItems(language).filter((entry) => entry.kind === "voice")) {
      expect(splitVoicePhrase(item.say, language), item.say).not.toBeNull();
    }
  });

  it.each(LANGUAGES)("%s: every verb and every target is said at least once", (language) => {
    const said = phraseItems(language)
      .filter((item) => item.kind === "voice")
      .map((item) => splitVoicePhrase(item.say, language));
    const verbsSaid = new Set(said.map((split) => split?.verb));
    const targetsSaid = new Set(said.map((split) => `${split?.id}|${split?.target}`));
    for (const unit of voiceUnits(language)) {
      for (const verb of unit.verbs) expect(verbsSaid, `${unit.id}: ${verb}`).toContain(verb);
    }
    for (const row of defaultPhrases(language)) {
      if (row.kind !== "voice") continue;
      expect(targetsSaid, row.phrase).toContain(`${row.split.id}|${row.split.target}`);
    }
  });

  it.each(LANGUAGES)("%s: every Spoken Punctuation phrase acts in some carrier", (language) => {
    const carriers = phraseItems(language).filter((item) => item.kind === "punctuation");
    for (const entry of entriesFor(language)) {
      for (const phrase of entry.phrases) {
        const acts = carriers.some(
          (item) => phraseCount([item.say], language, entry, phrase, NO_PUNCTUATION) > 0
        );
        expect(acts, `${entry.id}: ${phrase}`).toBe(true);
      }
    }
  });

  it.each(LANGUAGES)("%s: every voice line runs its Command on its own text", (language) => {
    for (const item of phraseItems(language).filter((entry) => entry.kind === "voice")) {
      expect(voiceClipHit([item.say], item, catalogCapabilities(language)), item.say).toBe(true);
    }
  });

  it("records which prose sentences fire on their text alone", () => {
    // These are findings the lane reports, not choices: a change to the
    // defaults that fixes or adds one should update this list on purpose.
    const firing = LANGUAGES.flatMap((language) =>
      phraseItems(language)
        .filter((item) => item.kind === "prose")
        .filter((item) => proseTriggers([item.say], language, catalogCapabilities(language)))
        .map((item) => item.say)
    );
    expect(firing).toEqual([
      "Use code.",
      "Center text.",
      "Stop list.",
      "Compré dos puntos y una lista",
      "centrar el texto",
      "empezar la lista",
    ]);
  });
});

describe("clipSlug()", () => {
  it("folds accents and punctuation into dashes", () => {
    expect(clipSlug("Compré dos puntos, y ¿una lista?")).toBe("compre-dos-puntos-y-una-lista");
  });
});

describe("defaultPhrases()", () => {
  it("counts a digit target and its spoken form once", () => {
    const rows = defaultPhrases("en").filter(
      (row) => row.kind === "voice" && row.split.id === "editor.heading1"
    );
    expect(rows.map((row) => row.phrase)).toContain("make heading one");
    expect(rows.map((row) => row.phrase)).not.toContain("make heading 1");
  });
});

describe("scoreModel()", () => {
  it.each(LANGUAGES)("%s: a perfect hearing scores every phrase at 1", (language) => {
    const score = scoreModel({
      language,
      capabilities: NO_PUNCTUATION,
      clips: perfectClips(language),
    });
    expect(score.missingItems).toEqual([]);
    const below = score.phrases.filter((phrase) => phrase.rate < 1).map((p) => p.row.phrase);
    expect(below).toEqual([]);
    expect(score.hitRate).toBe(1);
  });

  it("reports missing clips", () => {
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips: [] });
    expect(score.missingItems).toHaveLength(phraseItems("en").length);
    expect(score.hitRate).toBe(0);
  });

  it("a misheard target fails its recorded phrase and every phrase inferred from it", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "v-make-quote" ? { ...clip, finals: ["Make coat."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const rate = (phrase: string) => score.phrases.find((row) => row.row.phrase === phrase)?.rate;
    expect(rate("make quote")).toBe(0);
    // "quote" was said only in "make quote"; "apply quote" is inferred from it.
    expect(rate("apply quote")).toBe(0);
    // "make" was heard, and "block quote" was heard in its own clip.
    expect(rate("make block quote")).toBe(1);
    expect(score.phrases.find((row) => row.row.phrase === "apply quote")?.source).toBe("inferred");
  });

  it("averages takes of the same clip", () => {
    const clips = [...perfectClips("en"), { itemId: "v-make-bold", finals: ["Make bowl."] }];
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.phrases.find((row) => row.row.phrase === "make bold")?.rate).toBe(0.5);
  });

  it("a command split over two lines is a miss", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "v-align-right" ? { ...clip, finals: ["Align.", "Right."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.phrases.find((row) => row.row.phrase === "align right")?.rate).toBe(0);
  });

  it("scores each Spoken Punctuation phrase of a carrier on its own", () => {
    const item = phraseItems("en").find((entry) => entry.say.startsWith("are you sure"))?.id;
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === item
        ? {
            ...clip,
            finals: ["Are you sure question mark? Yes, exclamation mark. Wow, exclamation pint."],
          }
        : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const rate = (phrase: string) => score.phrases.find((row) => row.row.phrase === phrase)?.rate;
    expect(rate("question mark")).toBe(1);
    expect(rate("exclamation mark")).toBe(1);
    expect(rate("exclamation point")).toBe(0);
  });

  it("'punto' inside 'punto y coma' does not hide a missed 'punto'", () => {
    const item = phraseItems("es").find((entry) => entry.say.startsWith("llovía"))?.id ?? "";
    const clips = perfectClips("es").map((clip) =>
      clip.itemId === item
        ? { ...clip, finals: ["llovía coma y ella salió punto y seguido volvió tarde"] }
        : clip
    );
    const score = scoreModel({ language: "es", capabilities: NO_PUNCTUATION, clips });
    const rates = score.phrases
      .filter((row) => row.row.phrase === "punto")
      .flatMap((row) => row.evidence.map((take) => take.hit));
    expect(rates).toContain(false);
  });

  it("counts prose triggers per take and flags the ones that fire on text", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "x-make-it-bold" ? { ...clip, finals: ["Make bold."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const makeItBold = score.prose.find((row) => row.item.id === "x-make-it-bold");
    expect(makeItBold).toMatchObject({ takes: 1, triggered: 1, firesOnText: false });
    const useCode = score.prose.find((row) => row.item.say === "Use code.");
    expect(useCode?.firesOnText).toBe(true);
    // 3 sentences fire on their text, plus the misheard one.
    expect(score.proseTriggers).toBe(4);
    expect(score.misheardProseTriggers).toBe(1);
  });

  it("an extra firing of a phrase is a miss: it leaves a stray mark", () => {
    const item = phraseItems("en").find((entry) => entry.say.startsWith("the rain"))?.id;
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === item
        ? { ...clip, finals: ["The rain stopped, comma, and she left period.", "Period."] }
        : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const rate = (phrase: string) => score.phrases.find((row) => row.row.phrase === phrase)?.rate;
    expect(rate("comma")).toBe(1);
    expect(rate("period")).toBe(0);
  });

  it("a verb or target in a clip split over two lines is not heard", () => {
    // "quote" is said only in "make quote"; split, it proves nothing.
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "v-make-quote" ? { ...clip, finals: ["Make", "quote."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.phrases.find((row) => row.row.phrase === "apply quote")?.rate).toBe(0);
  });

  it("carries the interpreter state from one line of a clip to the next", () => {
    // "punto y aparte" leaves a sentence start behind it; the next line is
    // interpreted after it, as a session would, and still counts once.
    const item = phraseItems("es").find((entry) => entry.say.startsWith("fin"))?.id;
    const clips = perfectClips("es").map((clip) =>
      clip.itemId === item
        ? { ...clip, finals: ["fin", "punto y aparte", "al otro día nuevo párrafo", "llovió"] }
        : clip
    );
    const score = scoreModel({ language: "es", capabilities: NO_PUNCTUATION, clips });
    for (const phrase of ["punto y aparte", "nuevo párrafo"]) {
      expect(score.phrases.find((row) => row.row.phrase === phrase)?.rate, phrase).toBe(1);
    }
  });

  it("splits the hit rate into Voice Commands and Spoken Punctuation", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId.startsWith("p-") ? { ...clip, finals: ["mumble"] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.voiceRate).toBe(1);
    expect(score.punctuationRate).toBe(0);
    expect(score.hitRate).toBeGreaterThan(0);
    expect(score.hitRate).toBeLessThan(1);
  });

  it("an English period stays text under the shipped defaults", () => {
    expect(proseTriggers(["I waited for a period of time"], "en", PUNCTUATES)).toBe(false);
  });

  it("hears a vosotros imperative as the default verb it means", () => {
    const clips = perfectClips("es").map((clip) =>
      clip.itemId === "v-quitar-negrita" ? { ...clip, finals: ["quitad negrita"] } : clip
    );
    const score = scoreModel({ language: "es", capabilities: NO_PUNCTUATION, clips });
    const rate = (phrase: string) => score.phrases.find((row) => row.row.phrase === phrase)?.rate;
    expect(rate("quitar negrita")).toBe(1);
    // "quitar" was heard, and "cursiva" was heard in its own clip.
    expect(rate("quitar cursiva")).toBe(1);
  });

  it("counts a misheard close-question phrase once, as its own phrase", () => {
    const item = phraseItems("es").find((entry) => entry.say.startsWith("abre interrogación"))?.id;
    const clips = perfectClips("es").map((clip) =>
      clip.itemId === item
        ? {
            ...clip,
            finals: [
              "abre interrogación vienes cierre interrogación claro signo de interrogación",
            ],
          }
        : clip
    );
    const score = scoreModel({ language: "es", capabilities: NO_PUNCTUATION, clips });
    const rate = (phrase: string) => score.phrases.find((row) => row.row.phrase === phrase)?.rate;
    expect(rate("cierra interrogación")).toBe(1);
    expect(rate("signo de interrogación")).toBe(1);
  });
});
