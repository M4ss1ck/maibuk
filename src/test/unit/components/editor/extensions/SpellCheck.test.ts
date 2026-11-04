import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpellCheck, WORD_REGEX } from "@/components/editor/extensions/SpellCheck";
import { useSpellCheckDictionaries } from "@/features/spell-check-dictionaries/store";

const spellCheck = vi.hoisted(() => {
  const state = { language: "en" };
  return {
    state,
    service: {
      init: vi.fn(async (language: string) => {
        state.language = language;
      }),
      check: vi.fn(async (words: string[]) =>
        state.language === "en" ? words.filter((word) => word === "ola") : []
      ),
      addWord: vi.fn(),
      loadCustomDictionary: vi.fn(async () => undefined),
      suggest: vi.fn(async () => []),
    },
  };
});

vi.mock("@/lib/spellcheck", () => ({ spellCheckService: spellCheck.service }));

function errors(editor: Editor): number {
  return editor.view.dom.querySelectorAll(".spellcheck-error").length;
}

describe("SpellCheck language", () => {
  afterEach(() => {
    spellCheck.state.language = "en";
    spellCheck.service.init.mockClear();
    spellCheck.service.check.mockClear();
  });

  it("clears misspellings when the new language has no dictionary", async () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        SpellCheck.configure({ language: "en", enabled: true, debounceMs: 0 }),
      ],
      content: "<p>ola</p>",
    });

    await vi.waitFor(() => expect(errors(editor)).toBe(1));

    editor.commands.setSpellCheckLanguage("fr");

    await vi.waitFor(() => expect(spellCheck.service.init).toHaveBeenCalledWith("fr", {}));
    await vi.waitFor(() => expect(errors(editor)).toBe(0));
    editor.destroy();
  });
});

describe("SpellCheck dictionary installs", () => {
  afterEach(() => {
    useSpellCheckDictionaries.setState({
      installed: [],
      downloading: [],
      failed: [],
      loaded: false,
    });
    spellCheck.state.language = "en";
    spellCheck.service.init.mockClear();
    spellCheck.service.check.mockClear();
  });

  it("re-inits and rechecks when its language becomes installed", async () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        SpellCheck.configure({ language: "fr", enabled: true, debounceMs: 0 }),
      ],
      content: "<p>bonjour</p>",
    });

    await vi.waitFor(() => expect(spellCheck.service.check).toHaveBeenCalled());
    spellCheck.service.init.mockClear();
    spellCheck.service.check.mockClear();

    useSpellCheckDictionaries.setState({ installed: ["fr"] });

    await vi.waitFor(() =>
      expect(spellCheck.service.init).toHaveBeenCalledWith("fr", { force: true })
    );
    await vi.waitFor(() => expect(spellCheck.service.check).toHaveBeenCalled());
    editor.destroy();
  });
});

describe("WORD_REGEX", () => {
  const words = (text: string) => Array.from(text.matchAll(WORD_REGEX), (match) => match[0]);

  it("keeps a decomposed accent inside the word", () => {
    expect(words("cafe\u0301")).toEqual(["cafe\u0301"]);
  });

  it("keeps a Devanagari vowel sign inside the word", () => {
    expect(words("नमस्ते")).toEqual(["नमस्ते"]);
  });

  it("keeps an apostrophe inside the word", () => {
    expect(words("l'école")).toEqual(["l'école"]);
  });
});
