import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { AppSettingsProvider } from "./features/settings";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AppSettingsProvider>
          <App />
        </AppSettingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
