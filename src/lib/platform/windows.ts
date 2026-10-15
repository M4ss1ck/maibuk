/**
 * The Tauri Windows *desktop shell* (WebView2), read by the Frame platform gate
 * (#454 D6). A leaf, so the gate reads it without pulling the platform
 * factories, and read through a cast so a `tsx` script without Vite's
 * `import.meta.env` can import this. This is the Tauri build alone — a web
 * build opened in a Windows browser has `IS_WEB` true and `IS_WINDOWS` false,
 * and its Frame stays on (the gate is about the desktop shell, not the OS).
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;

/** The Tauri platform this build runs on, or null (the web build, or `tsx`). */
export const TAURI_PLATFORM = env?.TAURI_ENV_PLATFORM ?? null;

export const IS_WINDOWS = env?.VITE_BUILD_TARGET !== "web" && TAURI_PLATFORM === "windows";
