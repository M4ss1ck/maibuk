// src/test/unit/components/editor/HeadingId.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { HeadingId } from "@/components/editor/extensions/HeadingId";
import { assignHeadingIds } from "@/features/links/heading-ids";

const editors: Editor[] = [];

function makeEditor(content: string, onUpdate = vi.fn(), headingId = HeadingId) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), headingId],
    content,
    onUpdate,
  });
  editors.push(editor);
  return editor;
}

async function created(editor: Editor) {
  await new Promise<void>((resolve) => editor.on("create", () => resolve()));
}

function headingIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading") ids.push(node.attrs.id as string);
  });
  return ids;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("HeadingId extension", () => {
  it("parses an existing heading id and renders it back", () => {
    const editor = makeEditor('<h2 id="h-keep">Stable</h2>');
    expect(editor.getHTML()).toContain('id="h-keep"');
  });

  it("names id-less headings with the ids the link picker derives, without an edit", async () => {
    const content = "<h1>Night Watch</h1><p>x</p><h2>Dawn</h2><h2>Dawn</h2>";
    const onUpdate = vi.fn();
    const editor = makeEditor(content, onUpdate);
    await created(editor);

    expect(headingIds(editor)).toEqual(assignHeadingIds(content).headings.map((h) => h.id));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(editor.can().undo()).toBe(false);
  });

  it("leaves opened content unchanged when naming on open is off", async () => {
    const content = "<h1>Night Watch</h1><p>x</p>";
    const editor = makeEditor(content, vi.fn(), HeadingId.configure({ nameOnOpen: false }));
    await created(editor);
    expect(editor.getHTML()).toBe(content);
  });

  it("keeps ids of headings that have one", async () => {
    const editor = makeEditor('<h1 id="h-keep">Intro</h1><h2>Dawn</h2>');
    await created(editor);
    expect(headingIds(editor)[0]).toBe("h-keep");
  });

  it("gives a heading an edit creates an id, and typing in it keeps that id", async () => {
    const editor = makeEditor("<p>Intro</p>");
    await created(editor);

    editor.chain().setTextSelection(2).setNode("heading", { level: 2 }).run();
    const [id] = headingIds(editor);
    expect(id).toMatch(/^h-[0-9a-f]{8}$/);

    editor.chain().setTextSelection(6).insertContent(" more").run();
    expect(headingIds(editor)).toEqual([id]);
    expect(editor.getHTML()).toContain(`<h2 id="${id}">Intro more</h2>`);
  });

  it("gives the second half of a split heading its own id", async () => {
    const editor = makeEditor('<h2 id="h-keep">NightWatch</h2>');
    await created(editor);

    editor.chain().setTextSelection(6).splitBlock().run();

    const ids = headingIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("h-keep");
    expect(ids[1]).not.toBe("h-keep");
    expect(ids[1]).toMatch(/^h-/);
  });

  it("gives a pasted copy of a heading its own id and leaves the original's", async () => {
    const editor = makeEditor('<h2 id="h-keep">Stable</h2><p></p>');
    await created(editor);

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    // jsdom has no ClipboardEvent.
    editor.view.pasteHTML('<h2 id="h-keep">Stable</h2>', new Event("paste") as ClipboardEvent);

    const ids = headingIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe("h-keep");
    expect(ids[1]).not.toBe("h-keep");
  });

  it("names id-less headings in replaced content the same way", async () => {
    const editor = makeEditor("<p>old</p>");
    await created(editor);

    const content = "<h1>Night Watch</h1><h2>Dawn</h2>";
    editor.commands.setContent(content);

    expect(headingIds(editor)).toEqual(assignHeadingIds(content).headings.map((h) => h.id));
  });
});
