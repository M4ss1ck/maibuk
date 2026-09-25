import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  IS_TAURI: false,
  openFiles: vi.fn(),
  openMany: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("../../../lib/platform", () => ({
  get IS_TAURI() {
    return platform.IS_TAURI;
  },
  getWebDialog: async () => ({ openFiles: platform.openFiles }),
  getDialog: async () => ({ openMany: platform.openMany }),
  getFileSystem: async () => ({ readFile: platform.readFile }),
}));

const toastError = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

import { pickTextFiles } from "@/hooks/useTextFileDrop";

const FILTER = [{ name: "Text", extensions: ["md", "markdown", "txt"] }];

describe("pickTextFiles()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.IS_TAURI = false;
  });

  it("web: reads the picked Markdown and text files in order", async () => {
    platform.openFiles.mockResolvedValue([
      new File(["# One"], "One.md"),
      new File(["two"], "Two.txt"),
    ]);

    await expect(pickTextFiles()).resolves.toEqual([
      { text: "# One", stem: "One", extension: ".md" },
      { text: "two", stem: "Two", extension: ".txt" },
    ]);
    expect(platform.openFiles).toHaveBeenCalledWith({ filters: FILTER });
  });

  it("web: an unsupported file is refused with the same message as a drop", async () => {
    platform.openFiles.mockResolvedValue([new File(["x"], "cover.png")]);

    await expect(pickTextFiles()).resolves.toEqual([]);
    expect(toastError).toHaveBeenCalledWith("No supported text files (.md, .markdown, .txt)");
  });

  it("cancelling imports nothing and says nothing", async () => {
    platform.openFiles.mockResolvedValue([]);

    await expect(pickTextFiles()).resolves.toEqual([]);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("desktop: reads the picked paths from disk", async () => {
    platform.IS_TAURI = true;
    platform.openMany.mockResolvedValue(["/notes/Draft.markdown"]);
    platform.readFile.mockResolvedValue(new TextEncoder().encode("Hello"));

    await expect(pickTextFiles()).resolves.toEqual([
      { text: "Hello", stem: "Draft", extension: ".markdown" },
    ]);
    expect(platform.openMany).toHaveBeenCalledWith({ filters: FILTER });
  });
});
