import { describe, expect, it } from "vitest";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
  type InterpreterState,
} from "@/features/dictation/interpreter";
import { normalizePhrase } from "@/features/dictation/normalize";
import { defaultSpokenPunctuationLanguageSettings } from "@/features/dictation/spoken-punctuation";
import type { ModelSpec } from "@/features/dictation/types";
import en from "@/test/fixtures/dictation/interpreter/en.json";
import es from "@/test/fixtures/dictation/interpreter/es.json";

type Capabilities = ModelSpec["capabilities"];

interface FixtureCase {
  name: string;
  line: string;
  before: string;
  capabilities?: Capabilities;
  state?: InterpreterState;
  /** The author's Dictation Vocabulary for this case. */
  vocabulary?: { heard: string; written: string }[];
  expected: {
    edits: { kind: string; text?: string }[];
    state: InterpreterState;
    spokenPunctuationCount: number;
  };
}

interface FixtureFile {
  language: "en" | "es";
  capabilities: Capabilities;
  cases: FixtureCase[];
}

const fixtures = [es, en] as unknown as FixtureFile[];

describe("normalizePhrase()", () => {
  it("folds case and accents and drops punctuation", () => {
    expect(normalizePhrase("Punto, y Aparte.")).toBe("punto y aparte");
    expect(normalizePhrase("  ¡Nuevo   PÁRRAFO! ")).toBe("nuevo parrafo");
    expect(normalizePhrase("¿Cómo estás?")).toBe("como estas");
  });

  it("returns an empty string for punctuation and whitespace only", () => {
    expect(normalizePhrase(" ,.!? ")).toBe("");
    expect(normalizePhrase("")).toBe("");
  });
});

describe("buildPhraseTable()", () => {
  it("builds a trie for both Dictation Languages", () => {
    for (const language of ["en", "es"] as const) {
      const table = buildPhraseTable(language);
      expect(table.language).toBe(language);
      expect(table.trie.children.size).toBeGreaterThan(0);
    }
  });

  it("is pure: rebuilding yields an equivalent table", () => {
    const a = interpret({
      line: "uno punto y coma dos",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table: buildPhraseTable("es"),
      state: INITIAL_INTERPRETER_STATE,
    });
    const b = interpret({
      line: "uno punto y coma dos",
      before: "",
      capabilities: { casing: false, punctuation: false, streaming: true },
      table: buildPhraseTable("es"),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(a).toEqual(b);
  });

  it("leaves punctuation entries out where the model punctuates, unless switched on", () => {
    const punctuating: Capabilities = { casing: true, punctuation: true, streaming: true };
    const interpretWith = (table: ReturnType<typeof buildPhraseTable>) =>
      interpret({
        line: "uno coma dos",
        before: "",
        capabilities: punctuating,
        table,
        state: INITIAL_INTERPRETER_STATE,
      });
    const off = interpretWith(buildPhraseTable("es", { capabilities: punctuating }));
    expect(off.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "Uno coma dos" }] });

    const settings = defaultSpokenPunctuationLanguageSettings();
    settings.entries.coma = true;
    const on = interpretWith(buildPhraseTable("es", { capabilities: punctuating, settings }));
    expect(on.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "Uno, dos" }] });
  });

  it("drops a switched-off entry and the whole layer with the master switch", () => {
    const line = "uno coma dos punto nuevo párrafo tres";
    const capabilities: Capabilities = { casing: false, punctuation: false, streaming: true };
    const run = (settings: ReturnType<typeof defaultSpokenPunctuationLanguageSettings>) =>
      interpret({
        line,
        before: "",
        capabilities,
        table: buildPhraseTable("es", { capabilities, settings }),
        state: INITIAL_INTERPRETER_STATE,
      });

    const punctuationOff = defaultSpokenPunctuationLanguageSettings();
    punctuationOff.entries.coma = false;
    const entryOff = run(punctuationOff);
    expect(entryOff.result).toEqual({
      kind: "edits",
      edits: [
        { kind: "text", text: "Uno coma dos." },
        { kind: "paragraph" },
        { kind: "text", text: "Tres" },
      ],
    });

    const masterOff = defaultSpokenPunctuationLanguageSettings();
    masterOff.enabled = false;
    const allOff = run(masterOff);
    expect(allOff.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Uno coma dos punto nuevo párrafo tres" }],
    });
  });

  it("matches an author's alias in place of the default phrasing", () => {
    const capabilities: Capabilities = { casing: false, punctuation: false, streaming: true };
    const settings = defaultSpokenPunctuationLanguageSettings();
    settings.aliases.puntoYAparte = ["punto y la parte"];
    const result = interpret({
      line: "uno punto y la parte dos",
      before: "",
      capabilities,
      table: buildPhraseTable("es", { capabilities, settings }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Uno." }, { kind: "paragraph" }, { kind: "text", text: "Dos" }],
    });
    expect(result.spokenPunctuationCount).toBe(1);
  });

  it("falls back to the defaults when settings are partial", () => {
    const capabilities: Capabilities = { casing: false, punctuation: false, streaming: true };
    const table = buildPhraseTable("es", {
      capabilities,
      settings: { enabled: true, entries: {}, aliases: {} },
    });
    expect(
      interpret({
        line: "uno punto y coma dos",
        before: "",
        capabilities,
        table,
        state: INITIAL_INTERPRETER_STATE,
      }).result
    ).toEqual({ kind: "edits", edits: [{ kind: "text", text: "Uno; dos" }] });
  });
});

describe("interpret() heard Spoken Punctuation", () => {
  const noPunctuation: Capabilities = { casing: false, punctuation: false, streaming: true };

  it("inserts the mark a misheard close-question phrase means", () => {
    const { result, spokenPunctuationCount } = interpret({
      line: "Cierre interrogación",
      before: "",
      capabilities: noPunctuation,
      table: buildPhraseTable("es", { capabilities: noPunctuation }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({
      kind: "edits",
      edits: [
        { kind: "opener", mark: "¿" },
        { kind: "text", text: "?" },
      ],
    });
    expect(spokenPunctuationCount).toBe(1);
  });

  it("stops acting when the entry is switched off", () => {
    const settings = defaultSpokenPunctuationLanguageSettings();
    settings.entries.signoDeInterrogacion = false;
    const { result, spokenPunctuationCount } = interpret({
      line: "Cierre interrogación",
      before: "",
      capabilities: noPunctuation,
      table: buildPhraseTable("es", { capabilities: noPunctuation, settings }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Cierre interrogación" }],
    });
    expect(spokenPunctuationCount).toBe(0);
  });
});

describe("interpret() fixtures", () => {
  for (const file of fixtures) {
    describe(file.language, () => {
      for (const fixture of file.cases) {
        it(fixture.name, () => {
          const capabilities = fixture.capabilities ?? file.capabilities;
          const result = interpret({
            line: fixture.line,
            before: fixture.before,
            capabilities,
            table: buildPhraseTable(file.language, {
              capabilities,
              vocabulary: fixture.vocabulary,
            }),
            state: fixture.state ?? INITIAL_INTERPRETER_STATE,
          });
          expect(result).toEqual({
            result: { kind: "edits", edits: fixture.expected.edits },
            state: fixture.expected.state,
            spokenPunctuationCount: fixture.expected.spokenPunctuationCount,
          });
        });
      }
    });
  }
});

describe("interpret() contract", () => {
  const esTable = buildPhraseTable("es");
  const noPunctuation: Capabilities = { casing: false, punctuation: false, streaming: true };

  it("returns no edits for an empty line and keeps the state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false, allCaps: false };
    expect(
      interpret({ line: "", before: "uno ", capabilities: noPunctuation, table: esTable, state })
    ).toEqual({
      result: { kind: "edits", edits: [] },
      state,
      spokenPunctuationCount: 0,
    });
  });

  it("does not mutate the input state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false, allCaps: false };
    interpret({
      line: "cómo estás",
      before: "",
      capabilities: noPunctuation,
      table: esTable,
      state,
    });
    expect(state).toEqual({ capitalizeNext: true, noSpaceNext: false, allCaps: false });
  });

  it("does not include a leading space in the first text edit", () => {
    const { result } = interpret({
      line: "hola mundo",
      before: "dijo ",
      capabilities: noPunctuation,
      table: esTable,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "hola mundo" }] });
  });

  it("keeps the model's period before a spoken paragraph break", () => {
    const { result } = interpret({
      line: "Termina. Nuevo párrafo Sigue",
      before: "",
      capabilities: { casing: true, punctuation: true, streaming: true },
      table: esTable,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({
      kind: "edits",
      edits: [
        { kind: "text", text: "Termina." },
        { kind: "paragraph" },
        { kind: "text", text: "Sigue" },
      ],
    });
  });

  it("capitalizes after adjacent model sentence marks", () => {
    const { result } = interpret({
      line: "hola?! cómo sigues",
      before: "",
      capabilities: { casing: true, punctuation: true, streaming: true },
      table: esTable,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Hola?! Cómo sigues" }],
    });
  });

  it("matches decomposed accents as one phrase", () => {
    const line = "hola nuevo pa\u0301rrafo mundo";
    expect(normalizePhrase(line)).toBe("hola nuevo parrafo mundo");
    const { result } = interpret({
      line,
      before: "",
      capabilities: noPunctuation,
      table: esTable,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(result).toEqual({
      kind: "edits",
      edits: [
        { kind: "text", text: "Hola" },
        { kind: "paragraph" },
        { kind: "text", text: "Mundo" },
      ],
    });
  });
});

describe("interpret() Dictation Vocabulary", () => {
  const noPunctuation: Capabilities = { casing: false, punctuation: false, streaming: true };
  const tableWith = (vocabulary: { heard: string; written: string }[]) =>
    buildPhraseTable("es", { capabilities: noPunctuation, vocabulary });
  const run = (line: string, table: ReturnType<typeof buildPhraseTable>, before = "") =>
    interpret({
      line,
      before,
      capabilities: noPunctuation,
      table,
      state: INITIAL_INTERPRETER_STATE,
    });

  it("replaces every heard form with the written form exactly as typed", () => {
    const table = tableWith([
      { heard: "a reliano", written: "Aureliano" },
      { heard: "buendía", written: "Buendía" },
    ]);
    const { result } = run("hola a reliano buendía punto", table);
    expect(result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Hola Aureliano Buendía." }],
    });
  });

  it("matches whole words, folding case and accents", () => {
    const table = tableWith([{ heard: "buendia", written: "Buendía" }]);
    // Case and accents fold on the heard side; the written form keeps its own.
    expect(run("A BUENDÍA punto", table).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "A Buendía." }],
    });
    // "mariano" is one word, so an entry for "ariano" never reaches inside it.
    const owner = tableWith([{ heard: "ariano", written: "Ariano" }]);
    expect(run("mariano punto", owner).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Mariano." }],
    });
  });

  it("takes the longest match first", () => {
    const table = tableWith([
      { heard: "reliano", written: "Reliano" },
      { heard: "a reliano", written: "Aureliano" },
    ]);
    expect(run("a reliano punto", table).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Aureliano." }],
    });
  });

  it("inserts the written form exactly: no sentence casing, no lowercasing", () => {
    const lower = tableWith([{ heard: "a reliano", written: "aureliano buendía" }]);
    expect(run("a reliano", lower).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "aureliano buendía" }],
    });
    const upper = tableWith([{ heard: "a reliano", written: "Aureliano Buendía" }]);
    expect(run("a reliano", upper, "hola ").result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Aureliano Buendía" }],
    });
  });

  it("never reinterprets the written form as punctuation", () => {
    const table = tableWith([{ heard: "marca", written: "punto y aparte" }]);
    const { result, spokenPunctuationCount } = run("hola marca", table);
    expect(result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Hola punto y aparte" }],
    });
    expect(spokenPunctuationCount).toBe(0);
  });

  it("never reinterprets the written form as scratch that", () => {
    const table = tableWith([{ heard: "vora eso", written: "borra eso" }]);
    const { result } = run("vora eso", table);
    expect(result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "borra eso" }] });
  });

  it("runs first: the heard form shadows a Spoken Punctuation phrase", () => {
    const table = tableWith([{ heard: "nuevo párrafo", written: "Nuevo Palafox" }]);
    const { result, spokenPunctuationCount } = run("nuevo párrafo", table);
    expect(result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "Nuevo Palafox" }] });
    expect(spokenPunctuationCount).toBe(0);
  });

  it("drops model punctuation inside the heard span, keeps what follows", () => {
    const table = tableWith([{ heard: "a reliano", written: "Aureliano" }]);
    expect(run("a, reliano.", table).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Aureliano." }],
    });
  });

  it("a cap modifier cannot re-case the written form", () => {
    const table = tableWith([{ heard: "a reliano", written: "aureliano" }]);
    expect(run("mayúscula a reliano dijo", table).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "aureliano dijo" }],
    });
  });
});

describe("interpret() scratch that", () => {
  const esTable = buildPhraseTable("es");
  const enTable = buildPhraseTable("en");
  const caps: Capabilities = { casing: false, punctuation: false, streaming: true };

  /** The whole-line rule as the author sees it: the line is a scratch request. */
  const isScratch = (line: string, table: ReturnType<typeof buildPhraseTable>) =>
    interpret({ line, before: "", capabilities: caps, table, state: INITIAL_INTERPRETER_STATE })
      .result.kind === "scratch";

  it("matches the whole line per language, folding case and model punctuation", () => {
    expect(isScratch("borra eso", esTable)).toBe(true);
    expect(isScratch("Borra eso.", esTable)).toBe(true);
    expect(isScratch("¡BORRA ESO!", esTable)).toBe(true);
    expect(isScratch("scratch that", enTable)).toBe(true);
    expect(isScratch("Scratch that.", enTable)).toBe(true);
  });

  it("does not cross languages", () => {
    expect(isScratch("scratch that", esTable)).toBe(false);
    expect(isScratch("borra eso", enTable)).toBe(false);
  });

  it("never acts inside prose", () => {
    expect(isScratch("dije borra eso alto", esTable)).toBe(false);
    expect(isScratch("I said scratch that loudly", enTable)).toBe(false);
    expect(isScratch("", esTable)).toBe(false);
  });

  it("stops matching when the entry is switched off and takes an alias", () => {
    const settings = defaultSpokenPunctuationLanguageSettings();
    const capabilities: Capabilities = { casing: false, punctuation: false, streaming: true };
    settings.entries.borraEso = false;
    const offTable = buildPhraseTable("es", { settings, capabilities });
    expect(isScratch("borra eso", offTable)).toBe(false);

    const aliasSettings = defaultSpokenPunctuationLanguageSettings();
    aliasSettings.aliases.borraEso = ["bórralo"];
    const aliasTable = buildPhraseTable("es", { settings: aliasSettings, capabilities });
    expect(isScratch("Bórralo.", aliasTable)).toBe(true);
    expect(
      interpret({
        line: "bórralo",
        before: "hola ",
        capabilities,
        table: aliasTable,
        state: INITIAL_INTERPRETER_STATE,
      }).result
    ).toEqual({ kind: "scratch" });
  });

  it("returns a scratch result with unchanged state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false, allCaps: false };
    const out = interpret({
      line: "Borra eso.",
      before: "hola ",
      capabilities: caps,
      table: esTable,
      state,
    });
    expect(out.result).toEqual({ kind: "scratch" });
    expect(out.state).toBe(state);
    expect(out.spokenPunctuationCount).toBe(0);
  });

  it("returns scratch in English", () => {
    const out = interpret({
      line: "scratch that",
      before: "",
      capabilities: { casing: true, punctuation: true, streaming: true },
      table: enTable,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(out.result).toEqual({ kind: "scratch" });
  });
});

describe("interpret() Voice Commands", () => {
  const esTable = buildPhraseTable("es");
  const enTable = buildPhraseTable("en");
  const caps: Capabilities = { casing: false, punctuation: false, streaming: true };

  const run = (line: string, table: ReturnType<typeof buildPhraseTable>, before = "") =>
    interpret({ line, before, capabilities: caps, table, state: INITIAL_INTERPRETER_STATE });

  it("returns the Command and its polarity instead of edits", () => {
    expect(run("poner negrita", esTable).result).toEqual({
      kind: "voice_command",
      id: "editor.bold",
      polarity: "on",
    });
    expect(run("Quitar negrita.", esTable).result).toEqual({
      kind: "voice_command",
      id: "editor.bold",
      polarity: "off",
    });
    expect(run("undo that", enTable).result).toEqual({
      kind: "voice_command",
      id: "common.undo",
      polarity: null,
    });
  });

  it("never counts a Voice Command as Spoken Punctuation and keeps the state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false, allCaps: false };
    const out = interpret({
      line: "convertir en título uno",
      before: "hola ",
      capabilities: caps,
      table: esTable,
      state,
    });
    expect(out.result).toEqual({
      kind: "voice_command",
      id: "editor.heading1",
      polarity: null,
    });
    expect(out.spokenPunctuationCount).toBe(0);
    expect(out.state).toBe(state);
  });

  it("runs before scratch that: a Command line never removes the last sentence", () => {
    expect(run("parar dictado", esTable).result).toEqual({
      kind: "voice_command",
      id: "dictation.stop",
      polarity: null,
    });
  });

  it("never fires from prose that contains the words", () => {
    expect(run("puso la negrita en el título", esTable).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Puso la negrita en el título" }],
    });
    expect(run("make the sentence bold", enTable).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Make the sentence bold" }],
    });
  });

  it("never fires for a written form the Dictation Vocabulary produced", () => {
    const table = buildPhraseTable("es", {
      capabilities: caps,
      vocabulary: [{ heard: "orden", written: "poner negrita" }],
    });
    expect(run("orden", table).result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "poner negrita" }],
    });
  });

  it("carries the demonstrative flag with model punctuation", () => {
    expect(
      interpret({
        line: "Bold that.",
        before: "",
        capabilities: { casing: true, punctuation: true, streaming: true },
        table: enTable,
        state: INITIAL_INTERPRETER_STATE,
      }).result
    ).toEqual({ kind: "voice_command", id: "editor.bold", polarity: "on", that: true });
  });
});

describe("all-caps lock (#271)", () => {
  const bare: Capabilities = { casing: false, punctuation: false, streaming: true };
  const enTable = () => buildPhraseTable("en", { capabilities: bare });
  const esTable = () => buildPhraseTable("es", { capabilities: bare });

  it("upper-cases words after all caps on in the same line", () => {
    const output = interpret({
      line: "all caps on hello world",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "HELLO WORLD" }],
    });
    expect(output.state.allCaps).toBe(true);
    expect(output.capsLock).toBe(true);
    expect(output.spokenPunctuationCount).toBe(1);
  });

  it("carries the lock across lines until all caps off", () => {
    const first = interpret({
      line: "all caps on we",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(first.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "WE" }] });
    expect(first.capsLock).toBe(true);

    const second = interpret({
      line: "keep going",
      before: "WE",
      capabilities: bare,
      table: enTable(),
      state: first.state,
    });
    expect(second.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "KEEP GOING" }],
    });
    expect(second.capsLock).toBeUndefined();
    expect(second.state.allCaps).toBe(true);

    const third = interpret({
      line: "all caps off and stop",
      before: "WE KEEP GOING",
      capabilities: bare,
      table: enTable(),
      state: second.state,
    });
    expect(third.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "and stop" }] });
    expect(third.capsLock).toBe(false);
    expect(third.state.allCaps).toBe(false);
    expect(third.spokenPunctuationCount).toBe(1);
  });

  it("leaves punctuation marks unchanged while locked", () => {
    const output = interpret({
      line: "all caps on wait comma what question mark",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "WAIT, WHAT?" }],
    });
    expect(output.capsLock).toBe(true);
    expect(output.spokenPunctuationCount).toBe(3);
  });

  it("consumes a pending capitalize before the lock starts", () => {
    const output = interpret({
      line: "capitalize summer all caps on is here all caps off now",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Summer IS HERE now" }],
    });
    expect(output.capsLock).toBe(false);
    expect(output.state.allCaps).toBe(false);
    expect(output.spokenPunctuationCount).toBe(3);
  });

  it("never upper-cases a protected Vocabulary written form", () => {
    const table = buildPhraseTable("en", {
      capabilities: bare,
      vocabulary: [{ heard: "a reliano", written: "Aureliano" }],
    });
    const output = interpret({
      line: "all caps on a reliano came",
      before: "",
      capabilities: bare,
      table,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Aureliano CAME" }],
    });
    expect(output.capsLock).toBe(true);
  });

  it("upper-cases accented Spanish words while locked", () => {
    const output = interpret({
      line: "mayúsculas activadas qué año tan ñoño",
      before: "",
      capabilities: bare,
      table: esTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "QUÉ AÑO TAN ÑOÑO" }],
    });
    expect(output.capsLock).toBe(true);
    expect(output.spokenPunctuationCount).toBe(1);
  });

  it("stays prose when the on entry is switched off", () => {
    const settings = defaultSpokenPunctuationLanguageSettings();
    settings.entries.allCapsOn = false;
    const output = interpret({
      line: "all caps on hello",
      before: "she said ",
      capabilities: bare,
      table: buildPhraseTable("en", { capabilities: bare, settings }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "all caps on hello" }],
    });
    expect(output.capsLock).toBeUndefined();
    expect(output.state.allCaps).toBe(false);
    expect(output.spokenPunctuationCount).toBe(0);
  });

  it("does not turn the lock on through the literal escape", () => {
    const output = interpret({
      line: "literal all caps on hello",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "All caps on hello" }],
    });
    expect(output.capsLock).toBeUndefined();
    expect(output.state.allCaps).toBe(false);
  });
});

describe("numeral (#272)", () => {
  const bare: Capabilities = { casing: false, punctuation: false, streaming: true };
  const enTable = () => buildPhraseTable("en", { capabilities: bare });
  const esTable = () => buildPhraseTable("es", { capabilities: bare });

  const runEn = (line: string, before = "") =>
    interpret({
      line,
      before,
      capabilities: bare,
      table: enTable(),
      state: INITIAL_INTERPRETER_STATE,
    });

  const runEs = (line: string, before = "") =>
    interpret({
      line,
      before,
      capabilities: bare,
      table: esTable(),
      state: INITIAL_INTERPRETER_STATE,
    });

  it("leaves numeral as prose when the author switches it off", () => {
    const table = buildPhraseTable("en", {
      capabilities: bare,
      settings: { enabled: true, entries: { numeral: false }, aliases: {} },
    });
    const output = interpret({
      line: "numeral twenty one",
      before: "",
      capabilities: bare,
      table,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "Numeral twenty one" }],
    });
    expect(output.spokenPunctuationCount).toBe(0);
  });

  it("gives the tail of a phrase that starts inside the number back to prose", () => {
    const table = buildPhraseTable("en", {
      capabilities: bare,
      settings: { enabled: true, entries: {}, aliases: { comma: ["one two"] } },
    });
    const output = interpret({
      line: "numeral twenty one two apples",
      before: "",
      capabilities: bare,
      table,
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "21 two apples" }],
    });
  });

  it.each([
    { line: "numeral twenty one apples", expected: "21 apples", count: 1 },
    { line: "numeral twenty-one apples", expected: "21 apples", count: 1 },
    { line: "numeral one hundred and five pages", expected: "105 pages" },
    { line: "numeral one hundred and bread", expected: "100 and bread" },
    { line: "numeral three four", expected: "3 four" },
    { line: "numeral apples", expected: "Numeral apples", count: 0 },
    { line: "the end numeral", expected: "The end numeral", count: 0 },
    { line: "numeral 21 apples", expected: "21 apples", count: 1 },
    { line: "numeral twenty one comma then", expected: "21, then", count: 2 },
    { line: "numeral twenty one period", expected: "21.", count: 2 },
    { line: "chapter numeral one million", expected: "Chapter 1000000" },
    { line: "literal numeral three", expected: "Numeral three" },
  ])("$line -> $expected", ({ line, expected, count }) => {
    const output = runEn(line);
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: expected }],
    });
    if (count !== undefined) expect(output.spokenPunctuationCount).toBe(count);
  });

  it("writes zero with text before the caret", () => {
    const output = runEn("numeral zero", "hello ");
    expect(output.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "0" }] });
  });

  it.each([
    { line: "capítulo numeral veintiún", expected: "Capítulo 21" },
    { line: "numeral un millón de euros", expected: "1000000 de euros" },
    { line: "numeral treinta y pan", expected: "30 y pan" },
    { line: "numeral doscientos cinco coma luego", expected: "205, luego", count: 2 },
    { line: "numeral número", expected: "Numeral número", count: 0 },
  ])("$line -> $expected", ({ line, expected, count }) => {
    const output = runEs(line);
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: expected }],
    });
    if (count !== undefined) expect(output.spokenPunctuationCount).toBe(count);
  });

  it("writes digits from model punctuation", () => {
    const capabilities: Capabilities = { casing: true, punctuation: true, streaming: true };
    const output = interpret({
      line: "Numeral, twenty one.",
      before: "",
      capabilities,
      table: buildPhraseTable("en", { capabilities }),
      state: INITIAL_INTERPRETER_STATE,
    });
    expect(output.result).toEqual({ kind: "edits", edits: [{ kind: "text", text: "21." }] });
  });

  it("upper-cases the prose after the digits while all caps is on", () => {
    const output = interpret({
      line: "numeral twenty one apples",
      before: "",
      capabilities: bare,
      table: enTable(),
      state: { ...INITIAL_INTERPRETER_STATE, allCaps: true },
    });
    expect(output.result).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "21 APPLES" }],
    });
  });
});

describe("interpret() Click by Name", () => {
  const caps = { casing: false, punctuation: false, streaming: true } as const;
  const enTable = () => buildPhraseTable("en", { capabilities: caps });
  const esTable = () => buildPhraseTable("es", { capabilities: caps });
  const run = (line: string, table: ReturnType<typeof buildPhraseTable>) =>
    interpret({ line, before: "", capabilities: caps, table, state: INITIAL_INTERPRETER_STATE });

  it("clicks a named control in English, folding case and punctuation", () => {
    expect(run("Click Export.", enTable()).result).toEqual({ kind: "click", name: "export" });
  });

  it("clicks a number as digits or words", () => {
    expect(run("click 2", enTable()).result).toEqual({ kind: "click_number", n: 2 });
    expect(run("click two", enTable()).result).toEqual({ kind: "click_number", n: 2 });
  });

  it("clicks a named control in Spanish", () => {
    expect(run("Pulsar Exportar.", esTable()).result).toEqual({ kind: "click", name: "exportar" });
    expect(run("pulsa dos", esTable()).result).toEqual({ kind: "click_number", n: 2 });
  });

  it("lets Voice Commands win first", () => {
    expect(run("Pulsar tab.", esTable()).result).toEqual({
      kind: "voice_command",
      id: "focus.next",
      polarity: null,
    });
  });

  it("presses Tab when the model writes pulsar tap (issue #324)", () => {
    expect(run("pulsar tap", esTable()).result).toEqual({
      kind: "voice_command",
      id: "focus.next",
      polarity: null,
    });
  });

  it("stays text when click is not first", () => {
    const { result } = run("I will click the button later", enTable());
    expect(result.kind).toBe("edits");
  });

  it("stops when a protected Vocabulary token is present", () => {
    const table = buildPhraseTable("en", {
      capabilities: caps,
      vocabulary: [{ heard: "export", written: "Export" }],
    });
    const { result } = run("click export", table);
    expect(result.kind).toBe("edits");
  });
});
