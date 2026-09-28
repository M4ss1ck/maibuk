import { describe, expect, it } from "vitest";
import {
  INITIAL_INTERPRETER_STATE,
  buildPhraseTable,
  interpret,
  isScratchLine,
  normalizePhrase,
  type InterpreterState,
} from "@/features/dictation/interpreter";
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
});

describe("interpret() fixtures", () => {
  for (const file of fixtures) {
    describe(file.language, () => {
      const table = buildPhraseTable(file.language);
      for (const fixture of file.cases) {
        it(fixture.name, () => {
          const result = interpret({
            line: fixture.line,
            before: fixture.before,
            capabilities: fixture.capabilities ?? file.capabilities,
            table,
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
    const state = { capitalizeNext: true, noSpaceNext: false };
    expect(
      interpret({ line: "", before: "uno ", capabilities: noPunctuation, table: esTable, state })
    ).toEqual({
      result: { kind: "edits", edits: [] },
      state,
      spokenPunctuationCount: 0,
    });
  });

  it("does not mutate the input state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false };
    interpret({
      line: "cómo estás",
      before: "",
      capabilities: noPunctuation,
      table: esTable,
      state,
    });
    expect(state).toEqual({ capitalizeNext: true, noSpaceNext: false });
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

describe("interpret() scratch that", () => {
  const esTable = buildPhraseTable("es");
  const enTable = buildPhraseTable("en");
  const caps: Capabilities = { casing: false, punctuation: false, streaming: true };

  it("matches the whole line per language, folding case and model punctuation", () => {
    expect(isScratchLine("borra eso", "es")).toBe(true);
    expect(isScratchLine("Borra eso.", "es")).toBe(true);
    expect(isScratchLine("¡BORRA ESO!", "es")).toBe(true);
    expect(isScratchLine("scratch that", "en")).toBe(true);
    expect(isScratchLine("Scratch that.", "en")).toBe(true);
  });

  it("does not cross languages", () => {
    expect(isScratchLine("scratch that", "es")).toBe(false);
    expect(isScratchLine("borra eso", "en")).toBe(false);
  });

  it("never acts inside prose", () => {
    expect(isScratchLine("dije borra eso alto", "es")).toBe(false);
    expect(isScratchLine("I said scratch that loudly", "en")).toBe(false);
    expect(isScratchLine("", "es")).toBe(false);
  });

  it("returns a scratch result with unchanged state", () => {
    const state = { capitalizeNext: true, noSpaceNext: false };
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
