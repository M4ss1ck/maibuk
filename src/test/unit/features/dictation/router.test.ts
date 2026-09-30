import { describe, expect, it } from "vitest";
import { createRouter } from "@/features/dictation/router";

describe("createRouter()", () => {
  it("inserts every line in v1", () => {
    expect(createRouter()("hola mundo", "")).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "hola mundo" }],
    });
  });

  it("lets an interpreter turn a line into a Command", () => {
    const route = createRouter((text) =>
      text === "nuevo capítulo"
        ? { kind: "voice_command", id: "bookEditor.addChapter", polarity: null }
        : null
    );
    expect(route("nuevo capítulo", "")).toEqual({
      kind: "voice_command",
      id: "bookEditor.addChapter",
      polarity: null,
    });
    expect(route("otra cosa", "")).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "otra cosa" }],
    });
  });

  it("passes the bounded editor context to an interpreter", () => {
    const seen: string[] = [];
    createRouter((_text, before) => {
      seen.push(before);
      return { kind: "scratch" };
    })("borra eso", "última frase");
    expect(seen).toEqual(["última frase"]);
  });

  it("passes route options through to the interpreter", () => {
    const seen: unknown[] = [];
    const route = createRouter((_text, _before, options) => {
      seen.push(options);
      return null;
    });
    route("hello", "", { verbatim: true });
    route("hello", "", { verbatim: false });
    route("hello", "");
    expect(seen).toEqual([{ verbatim: true }, { verbatim: false }, undefined]);
  });

  it("still inserts every line without an interpreter, ignoring options", () => {
    expect(createRouter()("hola mundo", "", { verbatim: true })).toEqual({
      kind: "edits",
      edits: [{ kind: "text", text: "hola mundo" }],
    });
  });
});
