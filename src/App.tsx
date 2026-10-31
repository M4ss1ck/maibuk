import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
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
import { PluginPage } from "@/pages/PluginPage";
import { StartupRedirect } from "@/components/StartupRedirect";
import { WebLibraryGate } from "@/components/library/WebLibraryGate";
import { PathTracker } from "@/components/PathTracker";
import { PluginCommands } from "@/components/plugins/PluginCommands";
import { PluginChangeNotices } from "@/components/plugins/PluginChangeNotices";
import { RouteAnnouncer } from "@/components/RouteAnnouncer";
import { ToastViewport } from "@/components/ui";
import { ClickBadges, DictationLiveRegion } from "@/components/dictation";
import { PaneFocusFrame } from "@/components/PaneFocusFrame";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { AndroidBackNavigator } from "@/components/AndroidBackNavigator";
import { TutorialBoundary, TutorialRunner } from "@/components/tutorial/TutorialRunner";
import { TutorialOffer } from "@/components/tutorial/TutorialOffer";
import { scheduleDailyBackup } from "@/features/backup/lifecycle";
import { scheduleVersionStorageUpgrade } from "@/features/versions/upgrade";
import { installDictationFieldTracker } from "@/features/dictation/field-target";
import { installTraySyncIndicator } from "@/features/sync/trayIndicator";
import { installTrayMenu } from "@/lib/window/trayMenu";
import { installAuthKeepAlive } from "@/features/sync/auth-keep-alive";
import { installAutoSync } from "@/features/sync/auto-sync";
import { installReleaseCheck } from "@/features/releases/release-check";
import { useUpdateStore } from "@/features/update/store";
import { installViewRefresh } from "@/features/sync/view-refresh";
import { installSearchIndex } from "@/features/search";
import { isEmbedPath } from "@/lib/embed";
import { IS_ANDROID, IS_DESKTOP, IS_WEB } from "@/lib/platform";
import { installAndroidBackHandler } from "@/lib/window/androidBack";
import { installAndroidLifecycleHandler } from "@/lib/window/androidLifecycle";
import { installWindowCloseHandler } from "@/lib/window/closeHandler";
import { installAlwaysOnTopReapply } from "@/lib/window/alwaysOnTop";
import { installFocusReturn } from "@/lib/window/focusReturn";

/**
 * The test-only Plugin conformance route (#447, D3). `VITE_PLUGIN_CONFORMANCE`
 * is read inline so Rollup replaces it statically: in a normal build it folds
 * to false, the whole guarded block below is dropped, and the lazy import is
 * never emitted, so no conformance code reaches a shipped bundle. Only the
 * conformance build (`VITE_PLUGIN_CONFORMANCE=1`) registers the route and
 * redirects `/` to it.
 *
 * The `/` redirect is a render-time guard, not a `<Route path="/">`: the home
 * branch (`<Route path="/" element={<Layout/>}>` with its index) outranks a
 * sibling flat `/` route, so a redirect route there never runs and the app
 * renders Home instead of the probe. `ConformancePage` is lazy, so its route
 * element sits behind a `Suspense` boundary.
 *
 * The path is a variable on purpose. The route exists only in the flag build,
 * so it must stay out of the always-bundled route registries — `ROUTE_CONTEXTS`
 * and the E2E coverage matrix enumerate literal `path="..."` in App.tsx — and
 * out of every shipped chunk, including the `__conformance` string. A dropped
 * constant carries no bundle bytes; a literal in `ROUTE_CONTEXTS` would.
 */
const CONFORMANCE_ENABLED = import.meta.env.VITE_PLUGIN_CONFORMANCE === "1";
const CONFORMANCE_ROUTE = "/__conformance/plugins";
const ConformancePage = CONFORMANCE_ENABLED
  ? lazy(() => import("@/features/plugins/conformance"))
  : null;

function App() {
  const { pathname } = useLocation();
  const embedMode = isEmbedPath(pathname);

  // Plain text fields register as Dictation targets while focused, for the app
  // lifetime, independent of whatever else mounts.
  useEffect(() => installDictationFieldTracker(), []);

  // Focus the browser hands back when the window returns shows no focus ring.
  useEffect(() => installFocusReturn(), []);

  useEffect(() => {
    if (embedMode) return;
    scheduleDailyBackup();
    scheduleVersionStorageUpgrade();
    installAuthKeepAlive();
    installAutoSync();
    installViewRefresh();
    installSearchIndex();
    installReleaseCheck();
    void useUpdateStore.getState().loadBundleType();
    if (IS_ANDROID) {
      void installAndroidBackHandler();
      void installAndroidLifecycleHandler();
    }
    if (!IS_DESKTOP) return;
    void installWindowCloseHandler();
    void installAlwaysOnTopReapply();
    installTraySyncIndicator();
    installTrayMenu();
  }, [embedMode]);

  if (embedMode) {
    return (
      <Routes>
        <Route path="embed" element={<Embed />} />
      </Routes>
    );
  }

  // The conformance build lands on the probe route; see CONFORMANCE_ENABLED.
  if (CONFORMANCE_ENABLED && pathname === "/") {
    return <Navigate to={CONFORMANCE_ROUTE} replace />;
  }

  const app = (
    <>
      <DeepLinkHandler />
      <AndroidBackNavigator />
      <StartupRedirect>
        <PathTracker />
        <RouteAnnouncer />
        <GlobalShortcuts />
        <PluginCommands />
        <PaneFocusFrame />
        <CommandPalette />
        <TutorialBoundary>
          <Routes>
            {CONFORMANCE_ENABLED && ConformancePage !== null && (
              <Route
                path={CONFORMANCE_ROUTE}
                element={
                  <Suspense fallback={null}>
                    <ConformancePage />
                  </Suspense>
                }
              />
            )}
            <Route path="/" element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="notes" element={<NotesGallery />} />
              <Route path="canvas" element={<CanvasGallery />} />
              <Route path="ephemeral" element={<Ephemeral />} />
              <Route path="metrics" element={<Metrics />} />
              <Route path="settings" element={<Settings />} />
              <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
            </Route>
            {/* Full-page editors without sidebar */}
            <Route element={<FullPageScreen />}>
              <Route path="notes/:noteId" element={<Notes />} />
              <Route path="canvas/:canvasId" element={<Canvas />} />
              <Route path="book/:bookId" element={<BookEditor />} />
              <Route path="book/:bookId/cover" element={<CoverDesigner />} />
            </Route>
          </Routes>
        </TutorialBoundary>
        <TutorialRunner />
        <TutorialOffer />
        <ToastViewport />
        <PluginChangeNotices />
        <DictationLiveRegion />
        <ClickBadges />
      </StartupRedirect>
    </>
  );

  // The web Library's open result decides whether the app mounts at all
  // (ADR 0035): a tab that does not own the Library gets the locked screen,
  // and no store or write happens before the Library is open.
  return IS_WEB ? <WebLibraryGate>{app}</WebLibraryGate> : app;
}

export default App;
