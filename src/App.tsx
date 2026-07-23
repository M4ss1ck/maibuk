import { useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { FullPageScreen } from "@/components/FullPageScreen";
import { Home } from "@/pages/Home";
import { BookEditor } from "@/pages/BookEditor";
import { CoverDesigner } from "@/pages/CoverDesigner";
import { Settings } from "@/pages/Settings";
import { Metrics } from "@/pages/Metrics";
import { Notes } from "@/pages/Notes";
import { NotesGallery } from "@/pages/NotesGallery";
import { Canvas } from "@/pages/Canvas";
import { CanvasGallery } from "@/pages/CanvasGallery";
import { Ephemeral } from "@/pages/Ephemeral";
import { Embed } from "@/pages/Embed";
import { StartupRedirect } from "@/components/StartupRedirect";
import { PathTracker } from "@/components/PathTracker";
import { RouteAnnouncer } from "@/components/RouteAnnouncer";
import { ToastViewport } from "@/components/ui";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";
import { runDailyBackupOnce } from "@/features/backup/lifecycle";
import { installTraySyncIndicator } from "@/features/sync/trayIndicator";
import { IS_ANDROID, IS_DESKTOP } from "@/lib/platform";
import { installAndroidBackHandler } from "@/lib/window/androidBack";
import { installAndroidLifecycleHandler } from "@/lib/window/androidLifecycle";
import { installWindowCloseHandler } from "@/lib/window/closeHandler";
import { installAlwaysOnTopReapply } from "@/lib/window/alwaysOnTop";

function isEmbedPath(pathname: string): boolean {
  return pathname === "/embed";
}

function App() {
  const { pathname } = useLocation();
  const embedMode = isEmbedPath(pathname);

  useEffect(() => {
    if (embedMode) return;
    void runDailyBackupOnce();
    if (IS_ANDROID) {
      void installAndroidBackHandler();
      void installAndroidLifecycleHandler();
    }
    if (!IS_DESKTOP) return;
    void installWindowCloseHandler();
    void installAlwaysOnTopReapply();
    installTraySyncIndicator();
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
      <RouteAnnouncer />
      <GlobalShortcuts />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="notes" element={<NotesGallery />} />
          <Route path="canvas" element={<CanvasGallery />} />
          <Route path="ephemeral" element={<Ephemeral />} />
          <Route path="metrics" element={<Metrics />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        {/* Full-page editors without sidebar */}
        <Route element={<FullPageScreen />}>
          <Route path="notes/:noteId" element={<Notes />} />
          <Route path="canvas/:canvasId" element={<Canvas />} />
          <Route path="book/:bookId" element={<BookEditor />} />
          <Route path="book/:bookId/cover" element={<CoverDesigner />} />
        </Route>
      </Routes>
      <ToastViewport />
    </StartupRedirect>
  );
}

export default App;
