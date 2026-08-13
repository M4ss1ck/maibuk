import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SceneBreakMenu } from "@/components/editor/SceneBreakMenu";

const { mockGetWebDialog, mockOpenWithData, mockUpsertSeparatorAsset } = vi.hoisted(() => ({
  mockGetWebDialog: vi.fn(),
  mockOpenWithData: vi.fn(),
  mockUpsertSeparatorAsset: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../../lib/platform", () => ({
  IS_ANDROID: false,
  IS_WEB: true,
  getDialog: vi.fn(),
  getFileSystem: vi.fn(),
  getWebDialog: mockGetWebDialog,
}));

vi.mock("../../../../features/import/project-assets-repo", () => ({
  upsertSeparatorAsset: mockUpsertSeparatorAsset,
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      lastSceneBreak: { kind: "text", symbols: "* * *" },
      sceneBreakPresets: [],
      setLastSceneBreak: vi.fn(),
      addSceneBreakPreset: vi.fn(),
      removeSceneBreakPreset: vi.fn(),
    }),
}));

function createEditorMock(): Editor {
  const chain = {
    focus: vi.fn(() => chain),
    setSceneBreak: vi.fn(() => chain),
    run: vi.fn(),
  };

  return {
    chain: vi.fn(() => chain),
  } as unknown as Editor;
}

describe("SceneBreakMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWebDialog.mockResolvedValue({ openWithData: mockOpenWithData });
    mockOpenWithData.mockResolvedValue(null);
  });

  it("opens the image picker even when no book id is available", async () => {
    const user = userEvent.setup();
    render(<SceneBreakMenu editor={createEditorMock()} />);

    await user.click(screen.getByRole("button", { name: "editor.sceneBreakOptions" }));
    const uploadButton = screen.getByRole("button", {
      name: /editor\.sceneBreakUploadImage/,
    });

    expect(uploadButton).toBeEnabled();
    await user.click(uploadButton);

    await waitFor(() => {
      expect(mockGetWebDialog).toHaveBeenCalledOnce();
    });
  });

  it("closes the menu on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<SceneBreakMenu editor={createEditorMock()} />);

    const trigger = screen.getByRole("button", { name: "editor.sceneBreakOptions" });
    await user.click(trigger);
    expect(document.querySelector(".scene-break-menu-portal")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(document.querySelector(".scene-break-menu-portal")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("keeps the popup bounded to the viewport height with internal scrolling", async () => {
    const user = userEvent.setup();
    render(<SceneBreakMenu editor={createEditorMock()} />);

    await user.click(screen.getByRole("button", { name: "editor.sceneBreakOptions" }));

    const menu = document.querySelector(".scene-break-menu-portal") as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu).toHaveClass("max-h-[calc(100vh-1rem)]", "overflow-y-auto");
    expect(menu.style.maxHeight).toBe("calc(100dvh - 1rem)");
  });

  it("stops Escape propagation so an outer window Escape handler is not invoked", async () => {
    const user = userEvent.setup();
    const outerEscapeSpy = vi.fn();
    window.addEventListener("keydown", outerEscapeSpy);
    try {
      render(<SceneBreakMenu editor={createEditorMock()} />);

      await user.click(screen.getByRole("button", { name: "editor.sceneBreakOptions" }));
      expect(document.querySelector(".scene-break-menu-portal")).not.toBeNull();

      await user.keyboard("{Escape}");

      expect(document.querySelector(".scene-break-menu-portal")).toBeNull();
      expect(outerEscapeSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEscapeSpy);
    }
  });
});
