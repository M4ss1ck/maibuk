/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: "web" | "tauri" | undefined;
  readonly TAURI_ENV_PLATFORM:
    | "linux"
    | "windows"
    | "macos"
    | "android"
    | "ios"
    | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
