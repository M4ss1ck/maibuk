/**
 * What a Stopped Plugin's page shows instead of its body (#618): why it
 * stopped, and the way forward. Try again starts it explicitly and reads
 * "Starting…" until it is ready or fails again; a refusal a retry cannot fix
 * offers Review in Settings instead, which opens a changed copy's review.
 * Plugin settings opens the Plugin's own Settings row. Both actions are
 * Commands of the `pluginPage` Context.
 */

import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { pluginStoppedReasonText } from "@/components/plugins/plugin-startup-error";
import { asPluginTranslate } from "@/components/settings/plugin-translate";
import { Button } from "@/components/ui/Button";
import type { StoppedPlugin } from "@/features/plugins/stopped";
import { focusSettingsRow, requestPluginReview } from "@/features/settings/focus-row";
import { pluginCardRowId } from "@/features/settings/rows";
import { useShortcuts } from "@/lib/shortcuts";

export function PluginStoppedPanel({
  pluginId,
  name,
  stopped,
  starting,
  onTryAgain,
}: {
  pluginId: string;
  name: string;
  /** Null while a retry is starting and nothing has stopped it again yet. */
  stopped: StoppedPlugin | null;
  starting: boolean;
  onTryAgain: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const review = stopped?.action === "review";
  const tryAgain = () => {
    if (!starting) onTryAgain();
  };
  const openSettings = () => {
    // A changed copy opens straight into its review, like the changed-files notice.
    if (stopped?.reason.kind === "review") {
      requestPluginReview(pluginId);
      navigate("/settings#plugins");
      return;
    }
    focusSettingsRow(pluginCardRowId(pluginId));
    navigate("/settings");
  };

  useShortcuts([
    { id: "pluginPage.tryAgain", enabled: !review && !starting, onTrigger: tryAgain },
    { id: "pluginPage.openSettings", onTrigger: openSettings },
  ]);

  return (
    <div className="flex max-w-xl gap-3 rounded-lg border border-destructive/40 bg-card p-4">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("plugins.stoppedPanel.title", { name })}</p>
        {/* An alert, so a screen reader hears the reason and any new one after a retry. */}
        <p role="alert" className="mt-1 text-sm text-muted-foreground">
          {stopped !== null && !starting
            ? pluginStoppedReasonText(stopped.reason, name, asPluginTranslate(t))
            : null}
        </p>
        <p role="status" className="text-sm text-muted-foreground">
          {starting ? t("plugins.stoppedPanel.starting") : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {review ? (
            <Button
              variant="secondary"
              className="pointer-coarse:min-h-12"
              data-command="pluginPage.openSettings"
              onClick={openSettings}
            >
              {t("plugins.stoppedPanel.reviewInSettings")}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                className="pointer-coarse:min-h-12"
                data-command="pluginPage.tryAgain"
                // Kept focusable while starting, so focus stays put; a press then does nothing.
                aria-disabled={starting || undefined}
                onClick={tryAgain}
              >
                {t("plugins.stoppedPanel.tryAgain")}
              </Button>
              <Button
                variant="ghost"
                className="pointer-coarse:min-h-12"
                data-command="pluginPage.openSettings"
                onClick={openSettings}
              >
                {t("plugins.stoppedPanel.pluginSettings")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
