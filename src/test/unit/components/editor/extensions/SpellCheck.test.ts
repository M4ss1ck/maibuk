import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SpellCheck } from "@/components/editor/extensions/SpellCheck";

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
