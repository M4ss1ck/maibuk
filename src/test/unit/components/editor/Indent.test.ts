import { Editor as TiptapEditor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { Indent } from "@/components/editor/extensions/Indent";

// ── jsdom polyfills for ProseMirror scrollToSelection ──
// ProseMirror's domAtPos can return text nodes on which it calls
// getClientRects / getBoundingClientRect; these are undefined in jsdom.
const dummyDOMRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON() {
    return {};
  },
};
const dummyClientRects = (): DOMRectList =>
  ({
    length: 1,
    item: () => dummyDOMRect,
    [0 as unknown as number]: dummyDOMRect,
    [Symbol.iterator]: function* () {
      yield dummyDOMRect;
    },
  }) as unknown as DOMRectList;

for (const proto of [
  Range.prototype,
  Text.prototype as unknown as Record<string, unknown>,
  Comment.prototype as unknown as Record<string, unknown>,
]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.getClientRects !== "function") {
    p.getClientRects = dummyClientRects;
  }
  if (typeof p.getBoundingClientRect !== "function") {
    p.getBoundingClientRect = () => dummyDOMRect;
  }
}

const mountedEditors: TiptapEditor[] = [];
afterEach(() => {
  for (const editor of mountedEditors) editor.destroy();
  mountedEditors.length = 0;
});

function editorWithContent(content: string): TiptapEditor {
  const editor = new TiptapEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Indent,
    ],
    content,
  });
  document.body.appendChild(editor.view.dom);
  mountedEditors.push(editor);
  return editor;
}

function editorForTable(html: string): TiptapEditor {
  const editor = new TiptapEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Indent,
    ],
    content: html,
  });
  document.body.appendChild(editor.view.dom);
  mountedEditors.push(editor);
  return editor;
}

function editorForCodeBlock(html: string): TiptapEditor {
  const editor = new TiptapEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Indent],
    content: html,
  });
  document.body.appendChild(editor.view.dom);
  mountedEditors.push(editor);
  return editor;
}

function pressTab(editor: TiptapEditor, shift = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    code: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

function getIndent(editor: TiptapEditor): number {
  return editor.state.selection.$from.parent.attrs?.indent ?? 0;
}

function setIndent(editor: TiptapEditor, indent: number): void {
  editor.commands.setIndent(indent);
}

/** Find a listItem containing text and set cursor inside it. */
function selectItemWithText(editor: TiptapEditor, text: string): void {
  let targetPos = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "listItem") {
      const p = node.firstChild;
      const tn = p?.firstChild;
      if (tn?.isText && tn.text?.includes(text)) {
        targetPos = pos + 2 + tn.text.indexOf(text) + 1;
        return false;
      }
    }
  });
  if (targetPos > 0) editor.commands.setTextSelection(targetPos);
}

describe("Indent extension keyboard shortcuts", () => {
  describe("paragraph — Tab", () => {
    it("increases indent, defaultPrevented true, focus retained", () => {
      const editor = editorWithContent("<p>hello</p>");
      editor.view.dom.focus();
      const ev = pressTab(editor);
      expect(getIndent(editor)).toBe(40);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("cumulative indent at each step", () => {
      const editor = editorWithContent("<p>hello</p>");
      editor.view.dom.focus();
      expect(pressTab(editor).defaultPrevented).toBe(true);
      expect(getIndent(editor)).toBe(40);
      expect(document.activeElement).toBe(editor.view.dom);
      expect(pressTab(editor).defaultPrevented).toBe(true);
      expect(getIndent(editor)).toBe(80);
      expect(document.activeElement).toBe(editor.view.dom);
      expect(pressTab(editor).defaultPrevented).toBe(true);
      expect(getIndent(editor)).toBe(120);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("clamps at max indent and still prevents default", () => {
      const editor = editorWithContent("<p>hello</p>");
      setIndent(editor, 200);
      editor.view.dom.focus();
      const ev = pressTab(editor);
      expect(getIndent(editor)).toBe(200);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("paragraph — Shift+Tab", () => {
    it("decreases indent, defaultPrevented true, focus retained", () => {
      const editor = editorWithContent("<p>hello</p>");
      setIndent(editor, 80);
      editor.view.dom.focus();
      const ev = pressTab(editor, true);
      expect(getIndent(editor)).toBe(40);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("zero-indent no-op still prevents default", () => {
      const editor = editorWithContent("<p>hello</p>");
      editor.view.dom.focus();
      const ev = pressTab(editor, true);
      expect(getIndent(editor)).toBe(0);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("heading", () => {
    it("Tab increases indent and prevents default", () => {
      const editor = editorWithContent("<h2>hello</h2>");
      editor.view.dom.focus();
      const ev = pressTab(editor);
      expect(getIndent(editor)).toBe(40);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("Shift+Tab decreases indent and prevents default", () => {
      const editor = editorWithContent("<h2>hello</h2>");
      setIndent(editor, 80);
      editor.view.dom.focus();
      const ev = pressTab(editor, true);
      expect(getIndent(editor)).toBe(40);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("listItem — Tab (sink)", () => {
    it("sinks root item, defaultPrevented true, focus retained", () => {
      const editor = editorWithContent("<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>");
      selectItemWithText(editor, "beta");
      const depthBefore = editor.state.selection.$from.depth;
      editor.view.dom.focus();
      const ev = pressTab(editor);
      expect(editor.state.selection.$from.depth).toBeGreaterThan(depthBefore);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("lone nested item does not sink but still prevents default", () => {
      const editor = editorWithContent(
        "<ul><li><p>alpha</p><ul><li><p>beta</p></li></ul></li></ul>"
      );
      selectItemWithText(editor, "beta");
      const depthBefore = editor.state.selection.$from.depth;
      editor.view.dom.focus();
      const ev = pressTab(editor);
      expect(editor.state.selection.$from.depth).toBe(depthBefore);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("listItem — Shift+Tab (lift)", () => {
    it("lifts nested item, defaultPrevented true, focus retained", () => {
      const editor = editorWithContent(
        "<ul><li><p>alpha</p><ul><li><p>beta</p></li></ul></li></ul>"
      );
      selectItemWithText(editor, "beta");
      const depthBefore = editor.state.selection.$from.depth;
      editor.view.dom.focus();
      const ev = pressTab(editor, true);
      expect(editor.state.selection.$from.depth).toBeLessThan(depthBefore);
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("root-level lift converts to paragraph, defaultPrevented true", () => {
      const editor = editorWithContent("<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>");
      selectItemWithText(editor, "beta");
      editor.view.dom.focus();
      const ev = pressTab(editor, true);
      expect(ev.defaultPrevented).toBe(true);
      expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("table — Tab ownership", () => {
    function cursorInFirstCellPara(editor: TiptapEditor): void {
      let pos = 0;
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === "paragraph" && pos === 0) {
          pos = p + 1;
          return false;
        }
      });
      if (pos > 0) editor.commands.setTextSelection(pos);
    }

    it("Tab in a table cell does not change paragraph indent", () => {
      const editor = editorForTable("<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>");
      cursorInFirstCellPara(editor);
      const before = getIndent(editor);
      editor.view.dom.focus();
      pressTab(editor);
      // Indent must not change (Indent extension returns false for tables)
      expect(getIndent(editor)).toBe(before);
      expect(document.activeElement).toBe(editor.view.dom);
    });
    it("Shift+Tab in a table cell does not change paragraph indent", () => {
      const editor = editorForTable("<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>");
      cursorInFirstCellPara(editor);
      const before = getIndent(editor);
      editor.view.dom.focus();
      pressTab(editor, true);
      expect(getIndent(editor)).toBe(before);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });

  describe("code block — Tab ownership", () => {
    it.each([false, true])("does not apply paragraph indent (shift=%s)", (shift) => {
      const editor = editorForCodeBlock("<pre><code>const value = 1;</code></pre>");
      editor.commands.setTextSelection(2);
      editor.view.dom.focus();

      pressTab(editor, shift);

      expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
      expect(getIndent(editor)).toBe(0);
      expect(document.activeElement).toBe(editor.view.dom);
    });
  });
});
