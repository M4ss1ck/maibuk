import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { SceneBreakView } from "../SceneBreakView";
import {
  DEFAULT_SCENE_BREAK,
  descriptorToAttrs,
  type SceneBreakAttrs,
  type SceneBreakDescriptor,
} from "./scene-break-utils";

export interface SceneBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sceneBreak: {
      setSceneBreak: (descriptor?: SceneBreakDescriptor) => ReturnType;
    };
  }
}

export const SceneBreak = Node.create<SceneBreakOptions>({
  name: "sceneBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: "text",
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-kind") === "image" ? "image" : "text",
        renderHTML: (attrs: SceneBreakAttrs) => ({ "data-kind": attrs.kind }),
      },
      symbols: {
        default: "* * *",
        parseHTML: (el: HTMLElement) => {
          const symbols = el
            .querySelector(".scene-break-symbols")
            ?.textContent?.trim();
          return symbols && symbols.length > 0 ? symbols : "* * *";
        },
        renderHTML: () => ({}),
      },
      unit: { default: null },
      count: { default: null },
      spaced: { default: true },
      src: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.querySelector("img")?.getAttribute("src") ?? null,
        renderHTML: () => ({}),
      },
      assetId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-asset-id"),
        renderHTML: (attrs: SceneBreakAttrs) =>
          attrs.assetId ? { "data-asset-id": attrs.assetId } : {},
      },
      alt: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.querySelector("img")?.getAttribute("alt") ?? null,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-scene-break]",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as SceneBreakAttrs;
    const wrapper = mergeAttributes(HTMLAttributes, {
        "data-scene-break": "",
        class: "scene-break",
      });

    if (attrs.kind === "image" && attrs.src) {
      return ["div", wrapper, ["img", { src: attrs.src, alt: attrs.alt ?? "" }]];
    }

    return [
      "div",
      wrapper,
      ["span", { class: "scene-break-symbols" }, attrs.symbols],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SceneBreakView);
  },

  addKeyboardShortcuts() {
    const deleteAdjacentSceneBreak = () => {
      const { state } = this.editor;
      const { selection } = state;
      const { empty, $from } = selection;

      if (!empty || $from.parentOffset !== 0) {
        return false;
      }

      const indexBefore = $from.index($from.depth - 1) - 1;
      if (indexBefore < 0) return false;

      const parent = $from.node($from.depth - 1);
      const before = parent.maybeChild(indexBefore);
      if (!before || before.type.name !== this.name) {
        return false;
      }

      const sceneBreakPos = $from.before($from.depth) - before.nodeSize;
      return this.editor
        .chain()
        .deleteRange({
          from: sceneBreakPos,
          to: sceneBreakPos + before.nodeSize,
        })
        .run();
    };

    return {
      Backspace: deleteAdjacentSceneBreak,
    };
  },

  addCommands() {
    return {
      setSceneBreak:
        (descriptor?: SceneBreakDescriptor) =>
        ({ chain }) => {
          const attrs = descriptorToAttrs(descriptor ?? DEFAULT_SCENE_BREAK);
          return chain().insertContent({ type: this.name, attrs }).run();
        },
    };
  },
});
