// The Plugin Frame feature's public API (ADR 0021, #454 unit 2): the host-side
// builder and load message, and the fixed host document with its shim. No
// mounting or UI here — the page `frame` and the kit `Frame` render it in U3.

export { createSandboxElement, hostDocument } from "@/features/plugins/frame/host-document";
export {
  FRAME_CSP,
  FRAME_DOCUMENT,
  FRAME_LOAD_MESSAGE,
  FRAME_READY_MESSAGE,
  FRAME_THEME_MESSAGE,
  frameShim,
} from "@/features/plugins/frame/shim";
export {
  FrameLoadError,
  buildFrameLoadMessage,
  createFrameElement,
  frameMimeType,
} from "@/features/plugins/frame/frame";
export type { FrameLoadFile, FrameLoadMessage } from "@/features/plugins/frame/frame";
