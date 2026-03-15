import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { BookEditor } from "./pages/BookEditor";
import { CoverDesigner } from "./pages/CoverDesigner";
import { Settings } from "./pages/Settings";
import { StartupRedirect } from "./components/StartupRedirect";
import { PathTracker } from "./components/PathTracker";
import { ToastViewport } from "./components/ui";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { IS_TAURI } from "./lib/platform";
import { createLaunchBackup, createCloseBackup } from "./features/backup/lifecycle";

function App() {
  useEffect(() => {
    createLaunchBackup();
  }, []);

  useEffect(() => {
    if (!IS_TAURI) return;

    let unlisten: (() => void) | undefined;

    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault();
        await createCloseBackup();
        // Use destroy() instead of close() to avoid re-triggering onCloseRequested
        getCurrentWindow().destroy();
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <StartupRedirect>
      <PathTracker />
      <GlobalShortcuts />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        {/* Full-page editors without sidebar */}
        <Route path="book/:bookId" element={<BookEditor />} />
        <Route path="book/:bookId/cover" element={<CoverDesigner />} />
      </Routes>
      <ToastViewport />
    </StartupRedirect>
  );
}

export default App;
