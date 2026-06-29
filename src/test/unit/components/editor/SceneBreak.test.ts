import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { SceneBreak } from "../../../../components/editor/extensions/SceneBreak";

function makeEditor(content: string) {
  return new Editor({ extensions: [StarterKit, SceneBreak], content });
}

describe("SceneBreak node", () => {
  it("renders a text variant with its symbols", () => {
    const editor = makeEditor(
      '<div data-scene-break data-kind="text" class="scene-break"><span class="scene-break-symbols">❧</span></div>'
    );

    const html = editor.getHTML();

    expect(html).toContain("data-scene-break");
    expect(html).toContain('data-kind="text"');
    expect(html).toContain("❧");
    editor.destroy();
  });

  it("parses a legacy attribute-less scene break as '* * *'", () => {
    const editor = makeEditor("<div data-scene-break></div>");
    let symbols = "";

    editor.state.doc.descendants((node) => {
      if (node.type.name === "sceneBreak") {
        symbols = node.attrs.symbols as string;
      }
    });

    expect(symbols).toBe("* * *");
    editor.destroy();
  });

  it("renders an image variant", () => {
    const editor = makeEditor(
      '<div data-scene-break data-kind="image" class="scene-break"><img src="data:image/png;base64,AA" alt="orn"></div>'
    );

    const html = editor.getHTML();

    expect(html).toContain('data-kind="image"');
    expect(html).toContain('src="data:image/png;base64,AA"');
    expect(html).toContain('alt="orn"');
    editor.destroy();
  });

  it("deletes the scene break with Backspace from the next paragraph", () => {
    const editor = makeEditor("<p>before</p><div data-scene-break></div><p>after</p>");
    let afterStart = 0;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "after") {
        afterStart = pos + 1;
      }
    });
    editor.commands.setTextSelection(afterStart);
    editor.commands.keyboardShortcut("Backspace");

    let count = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "sceneBreak") count += 1;
    });
    expect(count).toBe(0);
    editor.destroy();
  });

  it("deletes a node-selected scene break with Backspace", () => {
    const editor = makeEditor("<p>a</p><div data-scene-break></div><p>b</p>");
    let sceneBreakPos = 0;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "sceneBreak") sceneBreakPos = pos;
    });
    editor.commands.setNodeSelection(sceneBreakPos);
    editor.commands.keyboardShortcut("Backspace");

    let count = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "sceneBreak") count += 1;
    });
    expect(count).toBe(0);
    editor.destroy();
  });

  it("inserts a default scene break when called with no args", () => {
    const editor = makeEditor("<p>x</p>");

    editor.commands.setSceneBreak();

    expect(editor.getHTML()).toContain("* * *");
    editor.destroy();
  });

  it("inserts a custom text descriptor", () => {
    const editor = makeEditor("<p>x</p>");

    editor.commands.setSceneBreak({
      kind: "text",
      symbols: "-*- -*-",
      unit: "-*-",
      count: 2,
      spaced: true,
    });
    const html = editor.getHTML();

    expect(html).toContain("-*- -*-");
    expect(html).toContain('data-kind="text"');
    editor.destroy();
  });

  it("inserts an image descriptor", () => {
    const editor = makeEditor("<p>x</p>");

    editor.commands.setSceneBreak({
      kind: "image",
      src: "data:image/png;base64,AA",
      alt: "o",
    });
    const html = editor.getHTML();

    expect(html).toContain('data-kind="image"');
    expect(html).toContain("data:image/png;base64,AA");
    editor.destroy();
  });
});
