import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

describe("dictionary prompt locale strings", () => {
  it("defines the manual-entry prompt strings in English", () => {
    expect(en.dictionary.promptTitle).toBe("Look up a word");
    expect(en.dictionary.wordLabel).toBe("Word");
    expect(en.dictionary.wordPlaceholder).toBe("Enter a word");
    expect(en.dictionary.languageLabel).toBe("Language");
    expect(en.dictionary.lookUp).toBe("Look up");
  });

  it("defines the manual-entry prompt strings in Spanish", () => {
    expect(es.dictionary.promptTitle).toBe("Buscar una palabra");
    expect(es.dictionary.wordLabel).toBe("Palabra");
    expect(es.dictionary.wordPlaceholder).toBe("Escribe una palabra");
    expect(es.dictionary.languageLabel).toBe("Idioma");
    expect(es.dictionary.lookUp).toBe("Buscar");
  });
});
