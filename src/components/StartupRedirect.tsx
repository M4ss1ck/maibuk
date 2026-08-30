import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/features/settings/store";
import { getDatabase } from "@/lib/db";
import { LoadingScreen } from "@/components/LoadingScreen";
import { getDeepLinkBootstrap, releaseDeepLinkQueue, resolveBatch } from "@/features/deep-link";
import { forceToastError } from "@/components/ui/Toast";

interface StartupRedirectProps {
  children: ReactNode;
}

export function StartupRedirect({ children }: StartupRedirectProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const lastPath = useSettingsStore((s) => s.lastPath);
  const setLastPath = useSettingsStore((s) => s.setLastPath);

  // Track hydration state locally
  const [hasHydrated, setHasHydrated] = useState(useSettingsStore.persist.hasHydrated());
  // Start as checked=true if not at root (no redirect check needed)
  const [checked, setChecked] = useState(location.pathname !== "/");

  // Listen for hydration completion
  useEffect(() => {
    // Check if already hydrated (in case it happened before mount)
    if (useSettingsStore.persist.hasHydrated()) {
      setHasHydrated(true);
    }

    const unsubscribe = useSettingsStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }
    if (checked) {
      releaseDeepLinkQueue();
      return;
    }

    async function restore() {
      try {
        // Cold deep-link bootstrap: race against 3000ms timeout that resolves to null
        if (location.pathname === "/") {
          try {
            const bootstrap = await Promise.race([
              getDeepLinkBootstrap(),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
            ]);
            if (bootstrap && bootstrap.length > 0) {
              const outcome = await resolveBatch(bootstrap);
              if (outcome) {
                if (outcome.to === null) {
                  forceToastError(t(outcome.toastKey));
                } else {
                  if (outcome.toastKey) {
                    forceToastError(t(outcome.toastKey));
                  }
                  navigate(outcome.to, {
                    replace: true,
                    state: outcome.state,
                  });
                  setChecked(true);
                  return;
                }
              }
            }
          } catch {
            // Plugin/lookup failure must settle gate and do normal startup
          }
        }

        // No saved path or already at home - just render
        if (!lastPath || lastPath === "/") {
          setChecked(true);
          return;
        }

        // For book routes, validate book exists
        const bookMatch = lastPath.match(/^\/book\/([^/]+)/);
        if (bookMatch) {
          const bookId = bookMatch[1];
          try {
            const db = await getDatabase();
            const result = await db.select<{ id: string }[]>("SELECT id FROM books WHERE id = ?", [
              bookId,
            ]);
            if (result.length === 0) {
              // Book was deleted, clear the saved path
              setLastPath(null);
              setChecked(true);
              return;
            }
          } catch (error) {
            console.error("Failed to validate book:", error);
            setLastPath(null);
            setChecked(true);
            return;
          }
        }

        // Redirect to the saved path and mark as checked
        navigate(lastPath, { replace: true });
        setChecked(true);
      } finally {
        releaseDeepLinkQueue();
      }
    }

    restore();
  }, [hasHydrated, checked, lastPath, navigate, setLastPath, t, location.pathname]);

  // Show loading screen until hydrated and checked
  if (!hasHydrated || !checked) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
