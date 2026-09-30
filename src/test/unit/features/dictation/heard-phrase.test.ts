import { describe, expect, it } from "vitest";
import { heardPhrase } from "@/features/dictation/normalize";

describe("heardPhrase()", () => {
  it("lowercases the model's words and drops its punctuation", () => {
    expect(heardPhrase("Press tab.", "en")).toBe("press tab");
  });

  it("keeps accents and the opening marks the model wrote", () => {
    expect(heardPhrase("Poner NEGRITA, ¿vale?", "es")).toBe("poner negrita vale");
    expect(heardPhrase("Añadir Índice", "es")).toBe("añadir índice");
  });

  it("is empty for a line with no words", () => {
    expect(heardPhrase(".", "en")).toBe("");
  });
});
