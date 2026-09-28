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
      text === "nuevo capítulo" ? { kind: "voice_command", id: "bookEditor.addChapter" } : null
    );
    expect(route("nuevo capítulo", "")).toEqual({
      kind: "voice_command",
      id: "bookEditor.addChapter",
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
});
