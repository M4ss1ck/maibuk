import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import type { SpellCheckDictionaryFiles } from "@/features/spell-check-dictionaries/types";
import {
  EditorToolbarGroups,
  type ToolbarGroupCallbacks,
} from "@/components/editor/toolbar/EditorToolbarGroups";
import { makeToolbarEditor } from "@/test/support/toolbar-editor";
import i18n from "@/i18n";
import "@/i18n";

const { mockGetFiles } = vi.hoisted(() => ({ mockGetFiles: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getSpellCheckDictionaryFiles: mockGetFiles,
}));

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

const { dictionaryFor } = await import("@/features/spell-check-dictionaries/catalog");
const { useSpellCheckDictionaries } = await import("@/features/spell-check-dictionaries/store");

const AFF = new TextEncoder().encode("AFF");
const DIC = new TextEncoder().encode("DIC");
const affSha256 = await computeChecksum(AFF);
const dicSha256 = await computeChecksum(DIC);

const fr = dictionaryFor("fr");
if (!fr) throw new Error("the catalog has no French entry");
const originalAff = { ...fr.aff };
const originalDic = { ...fr.dic };

function memoryFiles(): SpellCheckDictionaryFiles {
  const store = new Map<string, Uint8Array>();
  return {
    read: vi.fn(async (language, name) => store.get(`${language}/${name}`) ?? null),
    write: vi.fn(async (language, name, data) => {
      store.set(`${language}/${name}`, data);
    }),
    remove: vi.fn(async (language) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${language}/`)) store.delete(key);
      }
    }),
  };
}

function callbacks(overrides: Partial<ToolbarGroupCallbacks> = {}): ToolbarGroupCallbacks {
  return {
    spellCheckLanguage: "en",
    onSpellCheckLanguageChange: vi.fn(),
    openFindReplace: vi.fn(),
    isFindReplaceOpen: false,
    onToggleFindReplace: vi.fn(),
    openImageDialog: vi.fn(),
    openFootnote: vi.fn(),
    openLinkDialog: vi.fn(),
    openDictionary: vi.fn(),
    openSymbols: vi.fn(),
    openHtmlPanel: vi.fn(),
    ...overrides,
  };
}

/** Presses an arrow until `target` has focus, like an author would. */
async function pressUntilFocused(
  user: ReturnType<typeof userEvent.setup>,
  key: string,
  target: HTMLElement
) {
  for (let i = 0; i < 40; i++) {
    if (document.activeElement === target) return;
    await user.keyboard(`{${key}}`);
  }
  expect(target).toHaveFocus();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  fr.aff = { ...originalAff, bytes: AFF.length, sha256: affSha256 };
  fr.dic = { ...originalDic, bytes: DIC.length, sha256: dicSha256 };
  mockGetFiles.mockResolvedValue(memoryFiles());
  useSpellCheckDictionaries.setState({
    installed: [],
    downloading: [],
    failed: [],
    loaded: false,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === fr.aff.url) return new Response(AFF);
      if (url === fr.dic.url) return new Response(DIC);
      return new Response(null, { status: 404 });
    })
  );
});

afterEach(() => {
  fr.aff = originalAff;
  fr.dic = originalDic;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Spell Check language menu dictionaries", () => {
  it("a French Book not installed shows the state and Enter on Download starts it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["spellcheck"]}
        callbacks={callbacks({ spellCheckLanguage: "fr", onSpellCheckLanguageChange: onChange })}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Spell check language: Dictionary not downloaded",
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu", { name: /Spell check language/ });
    expect(
      within(menu).getByRole("menuitemradio", { name: "No dictionary for français" })
    ).toBeInTheDocument();

    const download = within(menu).getByRole("menuitemradio", {
      name: "Download dictionary for français (0 MB)",
    });
    await pressUntilFocused(user, "ArrowDown", download);

    await user.keyboard("{Enter}");

    await waitFor(() => expect(useSpellCheckDictionaries.getState().installed).toContain("fr"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a language outside the catalog says it has no dictionary and offers no download", async () => {
    const user = userEvent.setup();
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["spellcheck"]}
        callbacks={callbacks({ spellCheckLanguage: "ja" })}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Spell check language: No dictionary",
    });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu", { name: /Spell check language/ });
    expect(
      within(menu).getByRole("menuitemradio", { name: "No Spell Check dictionary for 日本語" })
    ).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitemradio", { name: /Download dictionary/ })).toBeNull();
  });

  it("a ready language shows no dictionary section and still lists the catalog", async () => {
    const user = userEvent.setup();
    render(
      <EditorToolbarGroups
        editor={makeToolbarEditor()}
        groupIds={["spellcheck"]}
        callbacks={callbacks()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Spell check language" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu", { name: /Spell check language/ });
    expect(within(menu).queryByText(/No dictionary/)).toBeNull();
    expect(within(menu).queryByRole("menuitemradio", { name: /Download dictionary/ })).toBeNull();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitemradio", { name: /français/ })).toHaveFocus();
  });
});
