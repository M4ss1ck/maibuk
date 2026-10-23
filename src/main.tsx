import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppSettingsProvider } from "@/features/settings";
import { seedPluginSidebarFromSnapshot } from "@/features/plugins/sidebar-snapshot";
import { IS_DESKTOP, IS_WEB } from "@/lib/platform";
import { endBooting, captureStartupScreen } from "@/lib/startup-screen";
import "@/index.css";

// Initialize i18n before app mounts
import "@/i18n";

// The enabled Plugins' sidebar entries are in the first frame: the approvals
// and the last launch's snapshot are both synchronous reads, while the Plugin
// Directory scan that confirms them runs after the render.
seedPluginSidebarFromSnapshot();

// The inline startup screen's logo is mid-entrance; record how far it got so
// the first LoadingScreen resumes it instead of restarting it under React.
captureStartupScreen();

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

// The startup screen painted the first frame; let the first theme switch
// animate again once React has replaced it.
endBooting();

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

// The E2E lane's Plugin Endpoint seam (#586) rides the E2E-only flag
// `e2e/run-steps.mjs` sets on the web build: the build has no socket, so the
// `@wf:plugins-endpoint` spec drives the real dispatcher through it. Read inline
// for the same reason as the bench flag, so a normal build drops it with the
// dynamic import inside `loadPlugins`.
const ENDPOINT_SEAM_ENABLED = import.meta.env.VITE_E2E_BUILTIN_SEED === "1";

const loadPlugins = async () => {
  // A Plugin credential store is always present: the OS keychain on desktop
  // (ADR 0023), the browser store with an opt-in "remember on this device" on
  // the web build, and in memory on Android.
  const { createMemoryPluginSecretStore, registerPluginSecretStore } = await import(
    "@/features/plugins/secret-store"
  );
  if (IS_DESKTOP) {
    const { createKeychainPluginSecretStore } = await import("@/lib/platform/tauri/secrets");
    registerPluginSecretStore(createKeychainPluginSecretStore());
  } else if (IS_WEB) {
    const { createWebPluginSecretStore } = await import("@/lib/platform/web/secrets");
    registerPluginSecretStore(createWebPluginSecretStore());
  } else {
    registerPluginSecretStore(createMemoryPluginSecretStore());
  }
  if (BENCH_DRIVER_ENABLED) {
    const { preparePluginsBench } = await import("@/features/plugins/bench");
    await preparePluginsBench();
  }
  const { installPluginLifecycle } = await import("@/features/plugins/lifecycle");
  installPluginLifecycle();
  if (ENDPOINT_SEAM_ENABLED) {
    const { installEndpointSeam } = await import("@/features/plugins/endpoint-seam");
    installEndpointSeam();
  }
  if (BENCH_DRIVER_ENABLED) {
    const { runPluginsBenchDriver } = await import("@/features/plugins/bench");
    void runPluginsBenchDriver();
  }
};
if (typeof requestIdleCallback === "function") requestIdleCallback(loadPlugins);
else setTimeout(loadPlugins, 0);
