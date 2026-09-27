import { describe, expect, it } from "vitest";
import { createRouter } from "@/features/dictation/router";

describe("createRouter()", () => {
  it("inserts every line in v1", () => {
    expect(createRouter()("hola mundo")).toEqual({ kind: "insert", text: "hola mundo" });
  });

  it("lets an interpreter turn a line into a Command", () => {
    const route = createRouter((text) =>
      text === "nuevo capítulo" ? { kind: "command", id: "bookEditor.addChapter" } : null
    );
    expect(route("nuevo capítulo")).toEqual({ kind: "command", id: "bookEditor.addChapter" });
    expect(route("otra cosa")).toEqual({ kind: "insert", text: "otra cosa" });
  });
});
