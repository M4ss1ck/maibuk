// Periodic lane for Plugin editor highlights (#441, #396). The #401 budget
// measures the long Chapter (`perfLongChapter`, 19771 words by countWords) with ~500
// highlights from Echoes; a keystroke there must map the stored decorations,
// never rebuild them. Run `pnpm bench:editor-highlights`;
// scripts/editor-highlights-bench-budget.mjs fails the run when the p99 budget
// is missed. Never part of `pnpm test`: the gate lane has no timing assertions.
import { Editor } from "@tiptap/core";
import { bench, describe } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { buildPlainTextMap } from "@/components/editor/plain-text-offsets";
import { registerPluginEditor, setPluginEditorHighlights } from "@/features/plugins/editor-host";
import { longChapterHtml, spreadHighlightRanges } from "@/test/support/long-chapter";

const editor = new Editor({
  extensions: createRichTextExtensions(),
  content: longChapterHtml(),
});
document.body.appendChild(editor.view.dom);
editor.view.dom.focus();
registerPluginEditor({
  id: "editor-highlights-bench",
  editor,
  entity: { kind: "chapter", id: "bench" },
});
setPluginEditorHighlights("echoes", {
  kind: "info",
  ranges: spreadHighlightRanges(buildPlainTextMap(editor.state.doc).text),
});

describe("plugin editor highlights", () => {
  bench("keystroke with highlights:", () => {
    editor.commands.insertContentAt(1, "x");
    editor.commands.deleteRange({ from: 1, to: 2 });
  });
});
