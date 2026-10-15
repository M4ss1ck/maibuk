import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppSettingsProvider } from "@/features/settings";
import { IS_DESKTOP } from "@/lib/platform";
import "@/index.css";

// Initialize i18n before app mounts
import "@/i18n";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AppSettingsProvider>
          <App />
        </AppSettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Approved Plugins load after the first render: the Plugin Directory scan must
// not delay launch (#401). The lifecycle (#436) decides what starts and when —
// persistent Plugins after the Library, the launch Auto Sync, and the launch
// Backup; on-demand Plugins only when one of their surfaces is reachable. With
// no approvals this creates no frame and no Worker, and the lifecycle and its
// adapters stay out of the first chunk until the idle callback.
//
// `VITE_PLUGIN_BENCH_DRIVER` is read inline so Rollup replaces it statically:
// in a normal build it folds to false, both guarded blocks are dropped, and the
// bench driver is never emitted. Only the native `bench:plugins` WebKitGTK
// build (issue #448) seeds its approvals and runs its measurement.
const BENCH_DRIVER_ENABLED = import.meta.env.VITE_PLUGIN_BENCH_DRIVER === "1";

const loadPlugins = async () => {
  // A Plugin credential store is always present: the OS keychain on desktop
  // (ADR 0023), in memory on the web build and on Android, where no Plugin runs
  // in v1.
  const { createMemoryPluginSecretStore, registerPluginSecretStore } = await import(
    "@/features/plugins/secret-store"
  );
  if (IS_DESKTOP) {
    const { createKeychainPluginSecretStore } = await import("@/lib/platform/tauri/secrets");
    registerPluginSecretStore(createKeychainPluginSecretStore());
  } else {
    registerPluginSecretStore(createMemoryPluginSecretStore());
  }
  if (BENCH_DRIVER_ENABLED) {
    const { preparePluginsBench } = await import("@/features/plugins/bench");
    await preparePluginsBench();
  }
  const { installPluginLifecycle } = await import("@/features/plugins/lifecycle");
  installPluginLifecycle();
  if (BENCH_DRIVER_ENABLED) {
    const { runPluginsBenchDriver } = await import("@/features/plugins/bench");
    void runPluginsBenchDriver();
  }
};
if (typeof requestIdleCallback === "function") requestIdleCallback(loadPlugins);
else setTimeout(loadPlugins, 0);
