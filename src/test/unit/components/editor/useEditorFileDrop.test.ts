import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { schema } from "@tiptap/pm/schema-basic";
import {
  createFileDropCaretPlugin,
  fileDropCaretKey,
} from "@/components/editor/useEditorFileDrop";

describe("file drop caret plugin", () => {
  it("stores the caret position from meta and clears it with null", () => {
    const plugin = createFileDropCaretPlugin();
    let state = EditorState.create({ schema, plugins: [plugin] });
    expect(fileDropCaretKey.getState(state)).toBeNull();

    state = state.apply(state.tr.setMeta(fileDropCaretKey, 1));
    expect(fileDropCaretKey.getState(state)).toBe(1);

    state = state.apply(state.tr.setMeta(fileDropCaretKey, null));
    expect(fileDropCaretKey.getState(state)).toBeNull();
  });
});
