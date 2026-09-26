import { afterEach, describe, expect, it, vi } from "vitest";
import { webDialog } from "@/lib/platform/web/dialog";

// The picker is a transient <input type="file">. The tests capture it when
// the adapter clicks it and play the browser's part: set files, fire change
// or cancel.
function capturePicker(): Promise<HTMLInputElement> {
  return new Promise((resolve) => {
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement
    ) {
      resolve(this);
    });
  });
}

function choose(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
}

describe("webDialog.openFiles()", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens a multi-file picker for the filter's extensions and resolves with the chosen files", async () => {
    const picker = capturePicker();
    const result = webDialog.openFiles({
      filters: [{ name: "Text", extensions: ["md", "txt"] }],
    });
    const input = await picker;

    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe(".md,.txt");

    const files = [new File(["# A"], "a.md"), new File(["b"], "b.txt")];
    choose(input, files);

    await expect(result).resolves.toEqual(files);
  });

  it("resolves with no files when the picker is cancelled", async () => {
    const picker = capturePicker();
    const result = webDialog.openFiles({});
    (await picker).dispatchEvent(new Event("cancel"));

    await expect(result).resolves.toEqual([]);
  });
});
