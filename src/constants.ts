declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
export const DOWNLOAD_PAGE = "https://github.com/M4ss1ck/maibuk/releases";

export const CANVAS_TEXT_NODE_DEFAULT_WIDTH = 288;

// Auto-checkpoint heuristics for book version control
export const VERSION_CHECKPOINT_WORD_THRESHOLD = 300;
export const VERSION_CHECKPOINT_IDLE_MS = 2 * 60 * 1000;
export const VERSION_CHECKPOINT_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const VERSION_AUTO_PRUNE_KEEP = 5;
