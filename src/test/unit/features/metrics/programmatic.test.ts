import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { setContentSilently } from "@/features/metrics/programmatic";

describe("setContentSilently()", () => {
  it("marks replacement transactions as programmatic without emitting editor updates", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Initial</p>",
    });
    const onUpdate = vi.fn();
    const seenMeta: Array<{
      programmatic: unknown;
      preventUpdate: unknown;
    }> = [];

    editor.on("update", onUpdate);
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) {
        seenMeta.push({
          programmatic: transaction.getMeta("metrics:programmatic"),
          preventUpdate: transaction.getMeta("preventUpdate"),
        });
      }
    });

    setContentSilently(editor, "<p>Loaded chapter</p>");

    expect(editor.getText()).toBe("Loaded chapter");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(seenMeta).toContainEqual({
      programmatic: true,
      preventUpdate: true,
    });

    editor.destroy();
  });
});
