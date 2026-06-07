import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { BookEditor } from "./pages/BookEditor";
import { CoverDesigner } from "./pages/CoverDesigner";
import { Settings } from "./pages/Settings";
import { Metrics } from "./pages/Metrics";
import { Notes } from "./pages/Notes";
import { Embed } from "./pages/Embed";
import { StartupRedirect } from "./components/StartupRedirect";
import { PathTracker } from "./components/PathTracker";
import { ToastViewport } from "./components/ui";
import { GlobalShortcuts } from "./components/GlobalShortcuts";
import { runDailyBackupOnce } from "./features/backup/lifecycle";
import { installWindowCloseHandler } from "./lib/window/closeHandler";

function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed";
}

function App() {
  const { pathname } = useLocation();
  const embedMode = isEmbedPath(pathname);

  useEffect(() => {
    if (embedMode) return;
    void runDailyBackupOnce();
    void installWindowCloseHandler();
  }, [embedMode]);

  if (embedMode) {
    return (
      <Routes>
        <Route path="embed" element={<Embed />} />
      </Routes>
    );
  }

  return (
    <StartupRedirect>
      <PathTracker />
      <GlobalShortcuts />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="notes" element={<Notes />} />
          <Route path="metrics" element={<Metrics />} />
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
