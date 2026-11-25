/** @jsxImportSource preact */
/* The Reader Frame's Preact app (#942). The groundwork only: it renders
   nothing yet, so the DOM UI `entry.ts` wires keeps working unchanged. The
   port fills `App` in behind `#app-root` without moving the existing markup.

   The Frame is bundled as one classic script, so this file takes Preact's
   automatic runtime and nothing else: no context, no state, no props. */

import { render } from "preact";

/** The Frame's app root. Renders nothing for now. */
function App() {
  return null;
}

/** Mounts the Preact app into `root` (the Frame's `#app-root`). */
export function mountApp(root: HTMLElement) {
  render(<App />, root);
}
