import { Node, mergeAttributes } from "@tiptap/core";

export interface SceneBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sceneBreak: {
      setSceneBreak: () => ReturnType;
    };
  }
}

export const SceneBreak = Node.create<SceneBreakOptions>({
  name: "sceneBreak",

  group: "block",

  parseHTML() {
    return [
      {
        tag: "div[data-scene-break]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-scene-break": "",
        class: "scene-break",
      }),
      ["span", { class: "scene-break-symbols" }, "* * *"],
    ];
  },

  addCommands() {
    return {
      setSceneBreak:
        () =>
          ({ chain }: { chain: () => any }) => {
            return chain()
              .insertContent({ type: this.name })
              .run();
          },
    };
  },
});
