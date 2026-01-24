/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: "web" | "tauri" | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
