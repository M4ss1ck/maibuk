// src/test/unit/components/editor/Wikilink.test.ts
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { Wikilink } from "@/components/editor/extensions/Wikilink";
import type { SuggestionProps } from "@tiptap/suggestion";
import type { WikilinkCandidate } from "@/features/links/wikilink-targets";

function makeEditor(content = "<p></p>") {
  return new Editor({ extensions: [StarterKit, Wikilink], content });
}

describe("Wikilink node", () => {
  it("renders a bound wikilink as a maibuk anchor", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "wikilink",
      attrs: { href: "maibuk://note/n1", label: "My Note" },
    });
    const html = editor.getHTML();
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('href="maibuk://note/n1"');
    expect(html).toContain("My Note");
    editor.destroy();
  });

  it("renders an unresolved wikilink with broken class and data-label", () => {
    const editor = makeEditor();
    editor.commands.insertContent({
      type: "wikilink",
      attrs: { href: null, label: "New Idea" },
    });
    const html = editor.getHTML();
    expect(html).toContain("wikilink-broken");
    expect(html).toContain('data-label="New Idea"');
    editor.destroy();
  });

  it("parses a bound wikilink back from html", () => {
    const editor = makeEditor('<p><a class="wikilink" href="maibuk://book/b1">Book</a></p>');
    const json = editor.getJSON();
    const node = JSON.stringify(json);
    expect(node).toContain("wikilink");
    expect(node).toContain("maibuk://book/b1");
    editor.destroy();
  });
});

describe("picking a [[ suggestion", () => {
  type Pick = (candidate: WikilinkCandidate) => void;

  /** An editor whose [[ list hands its pick function to the test. */
  function makeSuggestingEditor({ autoClose }: { autoClose: boolean }) {
    const picks: Pick[] = [];
    const exits: string[] = [];
    const editor = new Editor({
      extensions: [
        ...createRichTextExtensions({ autoClose }),
        Wikilink.configure({
          suggestion: {
            items: () => [],
            onCreateNote: async (title: string) => ({ noteId: `new-${title}` }),
            render: () => ({
              onStart: (props: SuggestionProps) => {
                picks.push(props.command as Pick);
              },
              onExit: (props: SuggestionProps) => {
                exits.push(props.query);
              },
            }),
          },
        }),
      ],
      content: "<p>See</p>",
    });
    editor.commands.focus("end");
    return {
      editor,
      exits,
      pick: async (candidate: WikilinkCandidate) => {
        await vi.waitFor(() => expect(picks).not.toHaveLength(0));
        picks[picks.length - 1](candidate);
        // createNote resolves before the Link goes in.
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }

  function type(editor: Editor, text: string) {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handler) =>
        handler(editor.view, from, to, char, () => editor.state.tr)
      );
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
  }

  const linkMarks = (editor: Editor) => {
    const found: { text: string; href: string }[] = [];
    editor.state.doc.descendants((node) => {
      const link = node.marks.find((mark) => mark.type.name === "link");
      if (node.isText && link) found.push({ text: node.text ?? "", href: link.attrs.href });
    });
    return found;
  };

  // A wikilink node was an atom: its text could not be selected, and right
  // click had no Link to edit until the Note reloaded it as a Link mark.
  it("inserts a Link mark, the same Link a reload produces", async () => {
    const { editor, pick } = makeSuggestingEditor({ autoClose: false });
    type(editor, " [[Fa");

    await pick({ kind: "note", id: "n1", label: "Faro" });

    expect(editor.getText()).toBe("See Faro");
    expect(linkMarks(editor)).toEqual([{ text: "Faro", href: "maibuk://note/n1" }]);
    let wikilinkNodes = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "wikilink") wikilinkNodes += 1;
    });
    expect(wikilinkNodes).toBe(0);
    const reloaded = new Editor({
      extensions: [...createRichTextExtensions(), Wikilink],
      content: editor.getHTML(),
    });
    expect(reloaded.getHTML()).toBe(editor.getHTML());
    editor.destroy();
    reloaded.destroy();
  });

  it("selects the Link's text like any other text", async () => {
    const { editor, pick } = makeSuggestingEditor({ autoClose: false });
    type(editor, " [[Fa");
    await pick({ kind: "note", id: "n1", label: "Faro" });

    // "See " is 4 characters; the Link's text starts at position 5.
    editor.commands.setTextSelection({ from: 6, to: 8 });

    expect(editor.state.doc.textBetween(6, 8)).toBe("ar");
    expect(editor.getAttributes("link").href).toBe("maibuk://note/n1");
    editor.destroy();
  });

  it("swallows the ]] that auto-close typed after [[", async () => {
    const { editor, pick } = makeSuggestingEditor({ autoClose: true });
    type(editor, " [[Fa");
    expect(editor.getText()).toBe("See [[Fa]]");

    await pick({ kind: "note", id: "n1", label: "Faro" });

    expect(editor.getText()).toBe("See Faro");
    editor.destroy();
  });

  // "]" may sit in a query, so stepping over the auto-closed "]]" kept the
  // list open on "Fa]]", and Enter made a Note by that name.
  it("closes the list once ]] is typed by hand, leaving the text as typed", async () => {
    const { editor, exits } = makeSuggestingEditor({ autoClose: true });
    type(editor, " [[Fa");
    await vi.waitFor(() => expect(exits).toHaveLength(0));

    type(editor, "]]");

    await vi.waitFor(() => expect(exits).toEqual(["Fa"]));
    expect(editor.getText()).toBe("See [[Fa]]");
    editor.destroy();
  });

  it("keeps typing after the Link out of it", async () => {
    const { editor, pick } = makeSuggestingEditor({ autoClose: true });
    type(editor, " [[Fa");
    await pick({ kind: "note", id: "n1", label: "Faro" });

    type(editor, " lit");

    expect(editor.getText()).toBe("See Faro lit");
    expect(linkMarks(editor)).toEqual([{ text: "Faro", href: "maibuk://note/n1" }]);
    editor.destroy();
  });

  it("links a Note created from the typed title", async () => {
    const { editor, pick } = makeSuggestingEditor({ autoClose: true });
    type(editor, " [[Idea");

    await pick({ kind: "createNote", label: "Idea" });

    await vi.waitFor(() =>
      expect(linkMarks(editor)).toEqual([{ text: "Idea", href: "maibuk://note/new-Idea" }])
    );
    expect(editor.getText()).toBe("See Idea");
    editor.destroy();
  });
});
