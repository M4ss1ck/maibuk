/** @jsxImportSource preact */
// A Built-in Plugin fixture (issue #940): the Frame entry the build bundles
// into one classic script. It renders with Preact, so the second Vite pass must
// bundle Preact rather than leave an import the opaque Frame origin cannot
// resolve. Never shipped; only the build test reads it.
import { render } from "preact";

function FrameRoot() {
  return <div data-frame-root="frame-builtin">Frame Built-in</div>;
}

const root = document.getElementById("frame-builtin-root");
if (root) render(<FrameRoot />, root);
