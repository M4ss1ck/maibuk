import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppSettingsProvider } from "@/features/settings";
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
const loadPlugins = () => {
  void import("@/features/plugins/lifecycle").then(({ installPluginLifecycle }) =>
    installPluginLifecycle()
  );
};
if (typeof requestIdleCallback === "function") requestIdleCallback(loadPlugins);
else setTimeout(loadPlugins, 0);
