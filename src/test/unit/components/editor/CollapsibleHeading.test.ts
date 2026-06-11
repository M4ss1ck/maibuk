import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CollapsibleHeading, collapsibleHeadingPluginKey } from "../../../../components/editor/extensions/CollapsibleHeading";

function createEditor(content: string, collapsedHeadings: string[] = []) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      CollapsibleHeading.configure({ collapsedHeadings }),
    ],
    content,
  });

  return editor;
}

function getCollapsedSet(editor: Editor): Set<string> {
  const state = collapsibleHeadingPluginKey.getState(editor.state);
  return state?.collapsed ?? new Set();
}

function getHeadingIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.attrs.headingId) {
      ids.push(node.attrs.headingId as string);
    }
  });
  return ids;
}

describe("CollapsibleHeading", () => {
  it("initializes with no collapsed headings by default", () => {
    const editor = createEditor("<h2>Hello</h2><p>World</p>");
    const collapsed = getCollapsedSet(editor);
    expect(collapsed.size).toBe(0);
    editor.destroy();
  });

  it("initializes with provided collapsedHeadings", () => {
    const editor = createEditor("<h2>Hello</h2>", ["some-id"]);
    const collapsed = getCollapsedSet(editor);
    expect(collapsed.has("some-id")).toBe(true);
    editor.destroy();
  });

  it("assigns headingId to headings that lack one", () => {
    const editor = createEditor("<h2>First</h2><p>Text</p><h3>Second</h3>");

    const ids = getHeadingIds(editor);
    expect(ids.length).toBe(2);
    ids.forEach((id) => {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
    editor.destroy();
  });

  it("hides lower-level headings inside a collapsed parent section", () => {
    const editor = createEditor(
      '<h2 data-heading-id="parent">Parent</h2><p>Intro</p><h3 data-heading-id="child">Child</h3><p>Child text</p>',
    );

    editor.view.dispatch(
      editor.state.tr.setMeta(collapsibleHeadingPluginKey, { toggle: "parent" }),
    );

    const childHeading = editor.view.dom.querySelector("h3");
    expect(childHeading).toHaveClass("heading-section-hidden");

    editor.destroy();
  });

  it("toggles a heading collapse via transaction meta", () => {
    const editor = createEditor("<h2>Test</h2><p>Content</p>");
    editor.commands.setContent("<h2>Test</h2><p>Content</p>");

    const headingId = getHeadingIds(editor)[0];
    expect(headingId).toBeDefined();

    editor.commands.command(({ tr }) => {
      tr.setMeta(collapsibleHeadingPluginKey, { toggle: headingId });
      return true;
    });

    const collapsed = getCollapsedSet(editor);
    expect(collapsed.has(headingId)).toBe(true);

    editor.commands.command(({ tr }) => {
      tr.setMeta(collapsibleHeadingPluginKey, { toggle: headingId });
      return true;
    });

    const collapsedAfterSecondToggle = getCollapsedSet(editor);
    expect(collapsedAfterSecondToggle.has(headingId)).toBe(false);

    editor.destroy();
  });

  it("cleans up orphaned IDs when headings are removed", () => {
    const editor = createEditor("<h2>Keep</h2><p>Content</p>");
    editor.commands.setContent("<h2>Keep</h2><p>Content</p>");

    const headingId = getHeadingIds(editor)[0];

    editor.commands.command(({ tr }) => {
      tr.setMeta(collapsibleHeadingPluginKey, { toggle: headingId });
      return true;
    });

    expect(getCollapsedSet(editor).has(headingId)).toBe(true);

    editor.commands.setContent("<p>No headings left</p>");

    const collapsedAfterRemoval = getCollapsedSet(editor);
    expect(collapsedAfterRemoval.has(headingId)).toBe(false);

    editor.destroy();
  });

  it("preserves non-orphaned IDs when headings exist", () => {
    const editor = createEditor("<h2>Heading A</h2><p>Text</p><h3>Heading B</h3>");
    editor.commands.setContent("<h2>Heading A</h2><p>Text</p><h3>Heading B</h3>");

    const ids = getHeadingIds(editor);

    editor.commands.command(({ tr }) => {
      tr.setMeta(collapsibleHeadingPluginKey, { toggle: ids[0] });
      return true;
    });

    expect(getCollapsedSet(editor).has(ids[0])).toBe(true);

    const tr = editor.state.tr.insert(
      editor.state.doc.content.size,
      editor.state.schema.nodes.paragraph.create(null, editor.state.schema.text("Added text")),
    );
    editor.view.dispatch(tr);

    expect(getCollapsedSet(editor).has(ids[0])).toBe(true);

    editor.destroy();
  });

  it("assigns different IDs to different headings", () => {
    const editor = createEditor("<h2>One</h2><h2>Two</h2>");
    editor.commands.setContent("<h2>One</h2><h2>Two</h2>");

    const ids = getHeadingIds(editor);
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    editor.destroy();
  });

  it("does not add headingId attribute to non-heading nodes", () => {
    const editor = createEditor("<p>Paragraph</p><h2>Heading</h2><ul><li>Item</li></ul>");
    let nonHeadingWithId = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "heading" && node.attrs.headingId) {
        nonHeadingWithId = true;
      }
    });
    expect(nonHeadingWithId).toBe(false);
    editor.destroy();
  });

  it("assigns heading ids on create when the initial doc has none", async () => {
    // JSON content skips parseHTML, so headings start without an id and must
    // be backfilled by the onCreate hook. onCreate only fires once mounted,
    // on the next macrotask, so the editor must be attached and awaited.
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        CollapsibleHeading,
      ],
      content: {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hi" }] },
        ],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const ids = getHeadingIds(editor);
    expect(ids).toHaveLength(1);
    expect(ids[0].length).toBeGreaterThan(0);
    editor.destroy();
    element.remove();
  });

  it("toggles collapse when the decoration toggle button is pressed", () => {
    const editor = createEditor('<h2 data-heading-id="h1">Title</h2><p>Body</p>');

    const button = editor.view.dom.querySelector(
      ".heading-collapse-toggle",
    ) as HTMLElement | null;
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(getCollapsedSet(editor).has("h1")).toBe(true);
    editor.destroy();
  });

  it("updates the decoration toggle state immediately after collapsing", () => {
    const editor = createEditor('<h2 data-heading-id="h1">Title</h2><p>Body</p>');

    const button = editor.view.dom.querySelector(
      ".heading-collapse-toggle",
    ) as HTMLElement | null;
    expect(button).not.toBeNull();
    expect(button?.getAttribute("data-collapsed")).toBe("false");
    expect(button?.getAttribute("aria-label")).toBe("Collapse heading");

    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    const updatedButton = editor.view.dom.querySelector(
      ".heading-collapse-toggle",
    ) as HTMLElement | null;
    expect(updatedButton).not.toBeNull();
    expect(updatedButton?.getAttribute("data-collapsed")).toBe("true");
    expect(updatedButton?.getAttribute("aria-label")).toBe("Expand heading");
    editor.destroy();
  });

  it("assigns an id to a heading inserted without one", () => {
    const editor = createEditor("<p>Body</p>");
    const { schema } = editor.state;
    const heading = schema.nodes.heading.create({ level: 2 }, schema.text("New"));

    editor.view.dispatch(editor.state.tr.insert(0, heading));

    expect(getHeadingIds(editor)).toHaveLength(1);
    editor.destroy();
  });

  it("stops hiding once a sibling heading at the same level is reached", () => {
    const editor = createEditor(
      '<h2 data-heading-id="a">A</h2><p>under a</p><h2 data-heading-id="b">B</h2><p>under b</p>',
    );

    editor.view.dispatch(
      editor.state.tr.setMeta(collapsibleHeadingPluginKey, { toggle: "a" }),
    );

    const headings = editor.view.dom.querySelectorAll("h2");
    // Section under A is hidden, but sibling B at the same level is not.
    expect(headings[1]).not.toHaveClass("heading-section-hidden");
    editor.destroy();
  });

  it("replaces collapsed state via replace meta", () => {
    const editor = createEditor("<h2>A</h2><p>Text</p><h3>B</h3>", ["pre-existing-id"]);
    expect(getCollapsedSet(editor).has("pre-existing-id")).toBe(true);

    editor.commands.setContent("<h2>A</h2><p>Text</p><h3>B</h3>");
    const ids = getHeadingIds(editor);

    editor.view.dispatch(
      editor.state.tr.setMeta(collapsibleHeadingPluginKey, { replace: [ids[0]] }),
    );

    const collapsed = getCollapsedSet(editor);
    expect(collapsed.size).toBe(1);
    expect(collapsed.has(ids[0])).toBe(true);
    expect(collapsed.has("pre-existing-id")).toBe(false);

    editor.destroy();
  });
});
