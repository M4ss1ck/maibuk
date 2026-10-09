declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;
export const DOWNLOAD_PAGE = "https://github.com/M4ss1ck/maibuk/releases";

export const CANVAS_TEXT_NODE_DEFAULT_WIDTH = 288;
// Matches the Text Node's `min-h-24` (6rem). Used only to give React Flow a
// starting height so a Text Node renders visible before it is measured; a
// hidden node cannot receive focus when its editor opens.
export const CANVAS_TEXT_NODE_MIN_HEIGHT = 96;

// Long enough to read "Settings → Tutorial" and "Keyboard shortcuts" after a dismiss.
export const TUTORIAL_RELAUNCH_HINT_DURATION_MS = 8000;

// Auto-checkpoint heuristics for book version control
export const VERSION_CHECKPOINT_WORD_THRESHOLD = 300;
export const VERSION_CHECKPOINT_IDLE_MS = 2 * 60 * 1000;
export const VERSION_CHECKPOINT_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const VERSION_AUTO_PRUNE_KEEP = 5;

// Editable Shortcuts the Shortcut Editor lets one Command hold. The stored
// model has no limit (ADR 0012); this only keeps the row readable.
export const MAX_SHORTCUTS_PER_COMMAND = 3;

// Link Preview: visible characters of the target's text, the hover and caret
// delay (the Tooltip's), and the Book cover thumbnail's longest side.
export const LINK_PREVIEW_SNIPPET_CHARS = 200;
export const LINK_PREVIEW_DELAY_MS = 500;
export const LINK_PREVIEW_COVER_PX = 96;
// A Backup restore emits no Change, so a cached Link Preview also expires.
export const LINK_PREVIEW_CACHE_MS = 30_000;
