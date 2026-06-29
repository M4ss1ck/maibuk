import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@/components/editor/Editor";

const { useReadingPositionMock } = vi.hoisted(() => ({
  useReadingPositionMock: vi.fn(),
}));

vi.mock("../../../../features/reading-position/useReadingPosition", () => ({
  useReadingPosition: (opts: unknown) => useReadingPositionMock(opts),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        spellCheckEnabled: false,
        language: "en",
        metrics: { enabled: { writing: false } },
      }),
    {
      getState: () => ({
        spellCheckEnabled: false,
        language: "en",
        metrics: { enabled: { writing: false } },
      }),
    }
  ),
}));

vi.mock("../../../../features/metrics/programmatic", () => ({
  setContentSilently: vi.fn(),
}));

vi.mock("../../../../components/editor/EditorToolbar", () => ({
  EditorToolbar: () => null,
}));

vi.mock("../../../../components/editor/SelectionToolbar", () => ({
  SelectionToolbar: () => null,
}));

vi.mock("../../../../components/editor/LinkClickHandler", () => ({
  LinkClickHandler: () => null,
}));

vi.mock("../../../../components/editor/LinkDialog", () => ({
  LinkDialog: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return {
    SpellCheck: Extension.create({ name: "mockSpellCheck" }),
  };
});

describe("Editor reading-position wiring", () => {
  beforeEach(() => {
    useReadingPositionMock.mockClear();
  });

  it("calls useReadingPosition with the restoreKey and suppressRestore props", async () => {
    render(
      <Editor
        content="<p>hello</p>"
        onUpdate={() => {}}
        restoreKey="chapter:abc"
        suppressRestore={false}
      />
    );

    await waitFor(() => {
      expect(useReadingPositionMock).toHaveBeenCalled();
    });
    const calls = useReadingPositionMock.mock.calls;
    const lastCall = calls[calls.length - 1]?.[0] as {
      storageKey: string | null;
      suppressRestore?: boolean;
    };
    expect(lastCall.storageKey).toBe("chapter:abc");
    expect(lastCall.suppressRestore).toBe(false);
  });
});
