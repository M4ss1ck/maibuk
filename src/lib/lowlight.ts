import { common, createLowlight } from "lowlight";

/**
 * Shared lowlight (highlight.js) registry. `common` covers the ~35 most
 * popular languages — including their aliases, so the ```sh fenced shortcut
 * resolves to the shell grammar.
 */
const baseLowlight = createLowlight(common);

export const lowlight: typeof baseLowlight = {
  ...baseLowlight,
  highlightAuto(value) {
    return { type: "root", children: [{ type: "text", value }] };
  },
};
