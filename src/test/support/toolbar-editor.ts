import type { Editor } from "@tiptap/react";

export function makeToolbarEditor(options?: { taskList?: boolean }): Editor {
  const chain = new Proxy(
    {},
    {
      get: () => () => chain,
    }
  );
  const can = new Proxy(
    {},
    {
      get: () => () => false,
    }
  );

  return {
    isActive: () => false,
    can: () => can,
    chain: () => chain,
    commands: { toggleTaskList: () => true },
    schema: { nodes: options?.taskList ? { taskList: {} } : {} },
    state: {
      selection: { empty: true, from: 0, to: 0 },
      doc: { textBetween: () => "" },
    },
    getAttributes: () => ({}),
  } as unknown as Editor;
}
