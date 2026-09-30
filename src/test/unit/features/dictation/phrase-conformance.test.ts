// Gate-lane checks on the Dictation phrase conformance lane (issue #285): the
// recording script must keep covering every default phrase's units, and the
// scorer must turn transcripts into the right verdicts. No model runs here.
import { describe, expect, it } from "vitest";
import { INITIAL_INTERPRETER_STATE, interpret } from "@/features/dictation/interpreter";
import { entriesFor, catalogCapabilities } from "@/features/dictation/spoken-punctuation";
import type { DictationLanguage } from "@/features/dictation/types";
import { voiceThatPhrases } from "@/features/dictation/voice-commands";
import {
  appClipHit,
  appExpectedLabel,
  defaultPhrases,
  defaultTable,
  namesHeard,
  phraseCount,
  proseTriggers,
  scoreModel,
  spokenWords,
  splitVoicePhrase,
  typedText,
  voiceClipHit,
  voiceUnits,
  type Clip,
} from "@/test/support/dictation-phrase-score";
import { clipSlug, parseNamesLine, phraseItems } from "@/test/support/dictation-phrase-set";

const LANGUAGES: DictationLanguage[] = ["en", "es"];
const NO_PUNCTUATION = { casing: false, punctuation: false, streaming: true };
const PUNCTUATES = { casing: true, punctuation: true, streaming: true };

/** The demonstrative mark clips (issue #268), recorded as whole clips. */
const NEW_VOICE: Record<DictationLanguage, readonly string[]> = {
  en: ["make bold that", "remove italics that", "bold that", "underline that"],
  es: ["poner negrita eso", "quitar cursiva esto", "negrita eso", "subrayado esto"],
};

/** Near misses of the new shape that must stay text. */
const NEW_PROSE: Record<DictationLanguage, readonly string[]> = {
  en: ["I said that.", "Make that bold.", "That is bold."],
  es: ["Eso es negrita.", "Pon eso en negrita.", "Dije eso."],
};

/** The spoken keys of a language's default demonstrative mark phrases. */
function thatSpokenKeys(language: DictationLanguage): Set<string> {
  return new Set(
    voiceThatPhrases(language).map(({ phrase }) => spokenWords(phrase, language).join(" "))
  );
}

/** Every clip heard exactly as it was read. */
function perfectClips(language: DictationLanguage): Clip[] {
  return phraseItems(language).map((item) => ({ itemId: item.id, finals: [item.say] }));
}

describe("the recording script", () => {
  it.each(LANGUAGES)("%s: clip ids are unique and file-safe", (language) => {
    const ids = phraseItems(language).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[vpaxn]-[a-z0-9-]+$/);
  });

  it.each(LANGUAGES)("%s: every voice line is a default phrase", (language) => {
    // A demonstrative line ("bold that", "poner negrita eso") is a whole-clip
    // that phrase, matched by its spoken key, not a verb-target pair.
    const that = thatSpokenKeys(language);
    for (const item of phraseItems(language).filter((entry) => entry.kind === "voice")) {
      if (that.has(spokenWords(item.say, language).join(" "))) continue;
      expect(splitVoicePhrase(item.say, language), item.say).not.toBeNull();
    }
  });

  it.each(LANGUAGES)("%s: every voice_that line has exactly one voice_that row", (language) => {
    const rows = defaultPhrases(language).filter((row) => row.kind === "voice_that");
    const that = thatSpokenKeys(language);
    for (const item of phraseItems(language).filter((entry) => entry.kind === "voice")) {
      const key = spokenWords(item.say, language).join(" ");
      if (!that.has(key)) continue;
      const matches = rows.filter((row) => spokenWords(row.phrase, language).join(" ") === key);
      expect(matches, item.say).toHaveLength(1);
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

  it.each(LANGUAGES)("%s: new demonstrative lines run a mark with that:true", (language) => {
    const capabilities = catalogCapabilities(language);
    const table = defaultTable(language, capabilities);
    for (const say of NEW_VOICE[language]) {
      const item = phraseItems(language).find((entry) => entry.say === say);
      expect(item, say).toBeDefined();
      if (!item) continue;
      expect(voiceClipHit([item.say], item, capabilities), say).toBe(true);
      const result = interpret({
        line: say,
        before: "",
        capabilities,
        table,
        state: INITIAL_INTERPRETER_STATE,
      });
      expect(result.result, say).toMatchObject({ kind: "voice_command", that: true });
    }
  });

  it.each(LANGUAGES)("%s: new prose lines stay text on their own words", (language) => {
    for (const say of NEW_PROSE[language]) {
      const item = phraseItems(language).find((entry) => entry.say === say);
      expect(item, say).toBeDefined();
      expect(proseTriggers([say], language, catalogCapabilities(language)), say).toBe(false);
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

  it.each(LANGUAGES)("%s: every app line runs a command or a click on its own text", (language) => {
    // App-tier whole-line phrases (issue #324): each clip is recorded whole
    // and scored whole, never inferred. Every line below was checked
    // against the production interpreter: each is a whole-line
    // voice_command or a Click by Name the registry really derives
    // (defaultWholeLinePhrases), including the Spanish labels ("Ir a
    // Notas", "Sincronizar ahora", "Pulsar Escape").
    const capabilities = catalogCapabilities(language);
    const table = defaultTable(language, capabilities);
    for (const item of phraseItems(language).filter((entry) => entry.kind === "app")) {
      const result = interpret({
        line: item.say,
        before: "",
        capabilities,
        table,
        state: INITIAL_INTERPRETER_STATE,
      }).result;
      expect(
        ["voice_command", "click", "click_number"].includes(result.kind),
        `${item.say} runs ${result.kind}`
      ).toBe(true);
      expect(appExpectedLabel(item, capabilities), item.say).not.toBe("edits");
      expect(appClipHit([item.say], item, capabilities), item.say).toBe(true);
    }
  });

  it.each(LANGUAGES)("%s: app clips follow voice clips and keep unit coverage", (language) => {
    const items = phraseItems(language);
    const kinds = items.map((item) => item.kind);
    const firstApp = kinds.indexOf("app");
    const lastVoice = kinds.lastIndexOf("voice");
    const firstPunctuation = kinds.indexOf("punctuation");
    expect(firstApp).toBeGreaterThan(lastVoice);
    expect(firstPunctuation).toBeGreaterThan(firstApp);
    for (const item of items.filter((entry) => entry.kind === "app")) {
      expect(item.id.startsWith("a-")).toBe(true);
    }
    // The script still says every verb and every target at least once: the
    // app lines are whole clips and contribute no units.
    const said = items
      .filter((item) => item.kind === "voice")
      .map((item) => splitVoicePhrase(item.say, language));
    const verbsSaid = new Set(said.map((split) => split?.verb));
    for (const unit of voiceUnits(language)) {
      for (const verb of unit.verbs) expect(verbsSaid, `${unit.id}: ${verb}`).toContain(verb);
    }
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
    const appBelow = score.app.filter((row) => row.rate < 1).map((row) => row.item.say);
    expect(appBelow).toEqual([]);
  });

  it("reports missing clips", () => {
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips: [] });
    // App and names clips are reported as "not recorded" in their own
    // sections and never fail the lane, so they are not missing items.
    expect(score.missingItems).toHaveLength(
      phraseItems("en").filter((item) => item.kind !== "app" && item.kind !== "names").length
    );
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

  it("voiceClipHit needs the demonstrative flag to match", () => {
    const item = phraseItems("en").find((entry) => entry.say === "make bold that");
    expect(item).toBeDefined();
    if (!item) return;
    const capabilities = catalogCapabilities("en");
    expect(voiceClipHit(["make bold"], item, capabilities)).toBe(false);
    expect(voiceClipHit(["Make bold that."], item, capabilities)).toBe(true);
  });

  it("scores a voice_that row from its clip and ignores one with no clip", () => {
    const item = phraseItems("en").find((entry) => entry.say === "make bold that");
    expect(item).toBeDefined();
    if (!item) return;
    const score = scoreModel({
      language: "en",
      capabilities: NO_PUNCTUATION,
      clips: [{ itemId: item.id, finals: [item.say] }],
    });
    expect(
      score.phrases.find(
        (row) => row.row.kind === "voice_that" && row.row.phrase === "make bold that"
      )
    ).toMatchObject({ source: "recorded", rate: 1 });
    // A that phrase nobody recorded is neither counted nor missing.
    expect(
      score.phrases.some(
        (row) => row.row.kind === "voice_that" && row.row.phrase === "set boldface that"
      )
    ).toBe(false);
    expect(score.voiceRate).toBeGreaterThan(0);
    expect(score.missingItems).not.toContain(item.id);
    expect(score.missingItems).toContain(
      phraseItems("en").find((entry) => entry.say === "bold that")?.id
    );
  });

  it("scores an app clip whole: a miss fails only its own clip", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "a-click-two" ? { ...clip, finals: ["Click three."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const rate = (say: string) => score.app.find((row) => row.item.say === say)?.rate;
    expect(rate("click two")).toBe(0);
    expect(rate("click three")).toBe(1);
    // The app lane never moves the ship bar.
    expect(score.hitRate).toBe(1);
  });

  it("an app clip split over two lines is a miss", () => {
    const clips = perfectClips("en").map((clip) =>
      clip.itemId === "a-go-to-notes" ? { ...clip, finals: ["Go to.", "Notes."] } : clip
    );
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.app.find((row) => row.item.say === "go to notes")?.rate).toBe(0);
    expect(score.hitRate).toBe(1);
  });

  it("an app command heard as another command is a miss", () => {
    const item = phraseItems("en").find((entry) => entry.say === "go to notes");
    expect(item).toBeDefined();
    if (!item) return;
    const capabilities = catalogCapabilities("en");
    expect(appClipHit(["Go to settings."], item, capabilities)).toBe(false);
    expect(appClipHit(["Go to Notes."], item, capabilities)).toBe(true);
  });

  it("a missing app clip is not recorded and never missing", () => {
    const clips = perfectClips("en").filter((clip) => clip.itemId !== "a-sync-now");
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const row = score.app.find((entry) => entry.item.say === "sync now");
    expect(row).toMatchObject({ takes: 0, hits: 0, rate: 0 });
    expect(score.missingItems).not.toContain("a-sync-now");
    expect(score.missingItems).toEqual([]);
    expect(score.hitRate).toBe(1);
  });

  it("averages takes of the same app clip", () => {
    const clips = [
      ...perfectClips("en"),
      { itemId: "a-dark-theme", finals: ["Duck theme."] },
    ];
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.app.find((row) => row.item.say === "dark theme")?.rate).toBe(0.5);
  });
});

describe("the names tier (issue #274)", () => {
  const namesOf = (language: DictationLanguage) =>
    phraseItems(language).filter((item) => item.kind === "names");

  it.each(LANGUAGES)("%s: about ten lines, recorded last, each with its names", (language) => {
    const items = phraseItems(language);
    const names = namesOf(language);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(items.slice(-names.length)).toEqual(names);
    for (const item of names) {
      expect(item.id, item.say).toMatch(/^n-/);
      expect(item.say, item.say).not.toMatch(/[{}]/);
      expect(item.names?.length, item.say).toBeGreaterThan(0);
      expect(new Set(item.names).size, item.say).toBe(item.names?.length);
    }
  });

  it.each(LANGUAGES)("%s: a names line runs nothing on its own text", (language) => {
    for (const capabilities of [catalogCapabilities(language), PUNCTUATES, NO_PUNCTUATION]) {
      for (const item of namesOf(language)) {
        expect(proseTriggers([item.say], language, capabilities), item.say).toBe(false);
      }
    }
  });

  it.each(LANGUAGES)("%s: every name is typed as written when heard as read", (language) => {
    const capabilities = catalogCapabilities(language);
    const table = defaultTable(language, capabilities);
    for (const item of namesOf(language)) {
      const typed = typedText([item.say], table, capabilities);
      expect(namesHeard(typed, item.names ?? []), item.say).toEqual(item.names);
    }
  });

  it("parseNamesLine() takes the braces off and keeps the names in order", () => {
    expect(parseNamesLine("we met {Siobhan} in {San Sebastián} today")).toEqual({
      say: "we met Siobhan in San Sebastián today",
      names: ["Siobhan", "San Sebastián"],
    });
    expect(() => parseNamesLine("no names here")).toThrow(/no \{name\}/);
    expect(() => parseNamesLine("an {open brace")).toThrow(/brace/);
  });

  describe("namesHeard()", () => {
    it("needs the exact written form: case and accents count", () => {
      expect(namesHeard("we met siobhan", ["Siobhan"])).toEqual([]);
      expect(namesHeard("dijo Inaki", ["Iñaki"])).toEqual([]);
      expect(namesHeard("dijo Iñaki", ["Iñaki"])).toEqual(["Iñaki"]);
      expect(namesHeard("dijo Iñaki".normalize("NFD"), ["Iñaki"])).toEqual(["Iñaki"]);
    });

    it("matches whole words only, next to punctuation or not", () => {
      expect(namesHeard("the Redisson cache", ["Redis"])).toEqual([]);
      expect(namesHeard("a MyRedis cache", ["Redis"])).toEqual([]);
      expect(namesHeard("cleared Redis.", ["Redis"])).toEqual(["Redis"]);
      expect(namesHeard("(Redis) and ¿Iñaki?", ["Redis", "Iñaki"])).toEqual(["Redis", "Iñaki"]);
    });

    it("matches a name of several words across any whitespace", () => {
      expect(namesHeard("in San\nSebastián", ["San Sebastián"])).toEqual(["San Sebastián"]);
      expect(namesHeard("in San Sebastian", ["San Sebastián"])).toEqual([]);
    });
  });

  it("typedText() joins the lines of a clip the way a session inserts them", () => {
    const capabilities = PUNCTUATES;
    const table = defaultTable("en", capabilities);
    expect(typedText(["We met", "Siobhan today."], table, capabilities)).toBe(
      // A line that continues a sentence loses the capital the model gave it,
      // so a name the model starts a line with is typed wrong: a miss the
      // names tier must see, since models end a line before unknown words.
      "We met siobhan today."
    );
    expect(
      namesHeard(typedText(["We met", "Siobhan today."], table, capabilities), ["Siobhan"])
    ).toEqual([]);
  });

  const siobhan = () => {
    const item = namesOf("en").find((entry) => entry.names?.includes("Siobhan"));
    if (!item) throw new Error("the English names tier lost Siobhan");
    return item;
  };

  it("scores only the name words, over every take", () => {
    const item = siobhan();
    const names = item.names ?? [];
    // A second take heard all in lowercase misses every name in it, and the
    // words around the names never count either way.
    const clips = [
      ...perfectClips("en"),
      { itemId: item.id, finals: [item.say.toLowerCase().replace(/\w+$/, "mumble")] },
    ];
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const row = score.names.find((entry) => entry.item.id === item.id);
    expect(row?.takes).toBe(2);
    expect(row?.names).toEqual(names.map((name) => ({ name, hits: 1 })));
    expect(row).toMatchObject({ hits: names.length, slots: 2 * names.length });
    const total = namesOf("en").reduce((sum, entry) => sum + (entry.names?.length ?? 0), 0);
    expect(score.nameHitRate).toBeCloseTo(total / (total + names.length), 10);
  });

  it("a name split over two finished lines still counts", () => {
    const item = siobhan();
    const [before, after] = item.say.split("Siobhan");
    const clips = [{ itemId: item.id, finals: [`${before}Siobhan`, after] }];
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    const row = score.names.find((entry) => entry.item.id === item.id);
    expect(row?.names.find((entry) => entry.name === "Siobhan")?.hits).toBe(1);
  });

  it("the Dictation Vocabulary writes a misheard name, the baseline biasing must beat", () => {
    const item = siobhan();
    const clips = [{ itemId: item.id, finals: [item.say.replace("Siobhan", "shivawn")] }];
    const hitsOf = (vocabulary?: { heard: string; written: string }[]) =>
      scoreModel({ language: "en", capabilities: PUNCTUATES, clips, vocabulary })
        .names.find((entry) => entry.item.id === item.id)
        ?.names.find((entry) => entry.name === "Siobhan")?.hits;
    expect(hitsOf()).toBe(0);
    expect(hitsOf([{ heard: "shivawn", written: "Siobhan" }])).toBe(1);
  });

  it("a Vocabulary name keeps its written case at the start of a line", () => {
    const item = siobhan();
    const [before, after] = item.say.split("Siobhan");
    const clips = [{ itemId: item.id, finals: [before, `Shivawn${after}`] }];
    const score = scoreModel({
      language: "en",
      capabilities: PUNCTUATES,
      clips,
      vocabulary: [{ heard: "shivawn", written: "Siobhan" }],
    });
    const row = score.names.find((entry) => entry.item.id === item.id);
    expect(row?.names.find((entry) => entry.name === "Siobhan")?.hits).toBe(1);
  });

  it("the Vocabulary is used only for the names tier", () => {
    const vocabulary = [{ heard: "bold", written: "Bold" }];
    const plain = scoreModel({
      language: "en",
      capabilities: PUNCTUATES,
      clips: perfectClips("en"),
    });
    const taught = scoreModel({
      language: "en",
      capabilities: PUNCTUATES,
      clips: perfectClips("en"),
      vocabulary,
    });
    expect(taught.hitRate).toBe(plain.hitRate);
    expect(taught.proseTriggers).toBe(plain.proseTriggers);
  });

  it("an unrecorded names tier is not missing and has no rate", () => {
    const clips = perfectClips("en").filter((clip) => !clip.itemId.startsWith("n-"));
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.missingItems).toEqual([]);
    expect(score.nameHitRate).toBeNull();
    expect(score.names.every((row) => row.takes === 0)).toBe(true);
  });

  it("counts a names take that ran something instead of typing", () => {
    const item = siobhan();
    const clips = [{ itemId: item.id, finals: ["Make bold."] }];
    const score = scoreModel({ language: "en", capabilities: PUNCTUATES, clips });
    expect(score.names.find((entry) => entry.item.id === item.id)?.triggered).toBe(1);
  });
});
