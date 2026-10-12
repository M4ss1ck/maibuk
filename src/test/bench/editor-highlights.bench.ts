// Periodic lane for Plugin editor highlights (#441, #396). The #401 budget
// measures the long Chapter (`perfLongChapter`, 19771 words by countWords) with ~500
// highlights from Echoes. Two rows: a keystroke there must map the stored
// decorations, never rebuild them; a highlight update is the host share of an
// Echoes update — the plain-text map walk plus ~500 decorations — with a p99
// budget under 10 ms (the #401 Echoes main-thread budget). The read Echoes
// makes first (`editor.getContent`) is DOM-bound: jsdom overstates its
// DOMPurify pass about 15x (1.4 ms mean in Chromium on this Chapter), so the
// end-to-end update is measured by the bench:frames Echoes scenario #401
// assigns to the Echoes slice (#403), not here. The script checks p99 because
// vitest bench has no p95. Run `pnpm bench:editor-highlights`;
// scripts/editor-highlights-bench-budget.mjs fails the run when a p99 budget
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
const highlightRanges = spreadHighlightRanges(buildPlainTextMap(editor.state.doc).text);
setPluginEditorHighlights("echoes", {
  kind: "info",
  ranges: highlightRanges,
});

describe("plugin editor highlights", () => {
  bench("keystroke with highlights:", () => {
    editor.commands.insertContentAt(1, "x");
    editor.commands.deleteRange({ from: 1, to: 2 });
  });

  bench("highlight update:", () => {
    setPluginEditorHighlights("echoes", { kind: "info", ranges: highlightRanges });
  });
});
