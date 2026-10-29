// The Plugin Frame feature's public API (ADR 0021, #454 units 2 and 4): the
// host-side builder and load message, the fixed host document with its shim,
// and the frozen public theme-token table. No mounting or UI here — the page
// `frame` and the kit `Frame` render it in U3.

export { createSandboxElement, hostDocument } from "@/features/plugins/frame/host-document";
export {
  FRAME_CSP,
  FRAME_DOCUMENT,
  FRAME_LOAD_MESSAGE,
  FRAME_READY_MESSAGE,
  FRAME_FULLSCREEN_MESSAGE,
  FRAME_FULLSCREEN_STATE_MESSAGE,
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
export {
  FRAME_THEME_COLOR_SCHEME,
  FRAME_THEME_TOKENS,
  readFrameThemeTokens,
} from "@/features/plugins/frame/theme-tokens";
export type { FrameThemeToken } from "@/features/plugins/frame/theme-tokens";
