import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { installDeepLinkBridge, uninstallDeepLinkBridge, resolveBatch } from "@/features/deep-link";
import { forceToastError } from "@/components/ui/Toast";

export function DeepLinkHandler() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    void installDeepLinkBridge(async (urls: string[]) => {
      if (cancelled) return;

      const outcome = await resolveBatch(urls);
      if (!outcome) return;

      if (outcome.to === null) {
        forceToastError(t(outcome.toastKey));
        return;
      }

      if (outcome.toastKey) {
        forceToastError(t(outcome.toastKey));
      }
      // Warm link: push so Back returns
      navigate(outcome.to, { state: outcome.state });
    });

    return () => {
      cancelled = true;
      uninstallDeepLinkBridge();
    };
  }, [navigate, t]);

  return null;
}
