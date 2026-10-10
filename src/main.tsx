import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppSettingsProvider } from "@/features/settings";
import { startApprovedPlugins } from "@/features/plugins";
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
// not delay launch (#401). The lifecycle slice (#436) owns the full scheduling;
// with no approvals this creates no frame and no Worker.
const loadPlugins = () => {
  void startApprovedPlugins();
};
if (typeof requestIdleCallback === "function") requestIdleCallback(loadPlugins);
else setTimeout(loadPlugins, 0);
