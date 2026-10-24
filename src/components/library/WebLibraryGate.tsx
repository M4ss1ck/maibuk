import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FocusScope } from "react-aria";
import { RefreshCw } from "lucide-react";
import { MaibukLogo } from "@/components/icons";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Button } from "@/components/ui";
import type { WebLibraryOpenResult } from "@/lib/platform/web/library-open";

/**
 * The web Library's open result decides what the author sees before any screen
 * loads (ADR 0035). A tab that does not own the Library never renders the app;
 * the in-memory fallback and a failed move render the app with a notice. The
 * desktop and Android builds never mount this.
 */

/** Opens the Library and says how it opened. */
export type OpenWebLibrary = () => Promise<WebLibraryOpenResult>;

type GateState =
  | { status: "opening" }
  | { status: "ready"; result: WebLibraryOpenResult | null };

interface WebLibraryGateProps {
  children: ReactNode;
  /** Test seam: the real web open by default. */
  open?: OpenWebLibrary;
}

/**
 * Opens the author's Library and reports the result the app branches on. The
 * old IndexedDB copy is only read by the web adapter, so this stays behind the
 * dynamic imports: no web module joins the desktop or Android bundle.
 */
async function openAuthorLibrary(): Promise<WebLibraryOpenResult> {
  const { getAuthorDatabase } = await import("@/lib/db");
  try {
    await getAuthorDatabase();
  } catch (error) {
    const { LibraryLockedError } = await import("@/lib/platform/web/database");
    if (error instanceof LibraryLockedError) return { kind: "locked" };
    throw error;
  }
  const { getWebLibraryOpenResult } = await import("@/lib/platform/web/database");
  return getWebLibraryOpenResult() ?? { kind: "opfs" };
}

export function WebLibraryGate({ children, open = openAuthorLibrary }: WebLibraryGateProps) {
  const [state, setState] = useState<GateState>({ status: "opening" });

  const attempt = useCallback(async () => {
    setState({ status: "opening" });
    try {
      setState({ status: "ready", result: await open() });
    } catch (error) {
      // Every other failure is the screens' own to report (LibraryLoadError,
      // which carries its own retry); blocking here would hide it.
      console.error("[db] the web Library could not be opened", error);
      setState({ status: "ready", result: null });
    }
  }, [open]);

  useEffect(() => {
    void attempt();
  }, [attempt]);

  if (state.status === "opening") return <LoadingScreen />;
  if (state.result?.kind === "locked") return <LockedScreen onRetry={() => void attempt()} />;

  return (
    <>
      {children}
      {state.result && state.result.kind !== "opfs" && (
        <WebLibraryNotice result={state.result} />
      )}
    </>
  );
}

/**
 * A full-screen stop, not a dialog over the app: the Library was never opened
 * in this tab, so there is nothing to go back to. Focus stays on the one
 * action, and Try again re-runs the whole open sequence (including the lock).
 */
function LockedScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-dvh items-center justify-center bg-background px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <FocusScope contain autoFocus>
        <div className="flex max-w-md flex-col items-center text-center">
          <MaibukLogo className="mb-6 h-16 w-16 text-primary" />
          <div role="alert" aria-labelledby="web-library-locked-title" className="mb-8">
            <h1
              id="web-library-locked-title"
              className="mb-3 text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              {t("webLibrary.locked.title")}
            </h1>
            <p className="leading-relaxed text-muted-foreground">{t("webLibrary.locked.body")}</p>
          </div>
          <Button size="lg" onClick={onRetry}>
            <RefreshCw className="h-5 w-5" aria-hidden="true" />
            {t("webLibrary.locked.tryAgain")}
          </Button>
        </div>
      </FocusScope>
    </div>
  );
}

type NoticeResult = Extract<WebLibraryOpenResult, { kind: "memory" } | { kind: "migration-failed" }>;

/**
 * The app-wide notice for the two Library states that still let the author
 * write. It is a live region, fixed above the screen and never in the way of a
 * pointer; it stays for the session because what it says stays true.
 */
function WebLibraryNotice({ result }: { result: NoticeResult }) {
  const { t } = useTranslation();
  const isFailure = result.kind === "migration-failed";
  return (
    <div
      role={isFailure ? "alert" : "status"}
      className="pointer-events-none fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-[min(32rem,calc(100vw-3rem))] -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 shadow-lg"
    >
      <p
        className={`text-sm font-medium ${isFailure ? "text-destructive" : "text-foreground"}`}
      >
        {isFailure ? t("webLibrary.migrationFailed.title") : t("webLibrary.memory.title")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isFailure
          ? result.error.code === "quota-exceeded"
            ? t("webLibrary.migrationFailed.quota")
            : t("webLibrary.migrationFailed.body")
          : t("webLibrary.memory.body")}
      </p>
    </div>
  );
}
