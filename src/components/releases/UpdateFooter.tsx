import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useReleaseStore } from "@/features/releases/store";
import type { UpdatePhase } from "@/features/update/types";
import type { ReleaseNotes } from "@/features/releases/release-notes";
import { updateProgressPercent } from "@/features/update/progress";
import { canStartUpdate, useUpdateStore } from "@/features/update/store";
import { openExternal } from "@/lib/platform";
import { DOWNLOAD_PAGE } from "@/constants";

/**
 * The What's new footer: the Update flow where this install can Update, and
 * the Download Page as the way out in every state (ADR 0037).
 */
/** Retrying cannot help when the feed has no file for this install or the folder is read-only. */
function isDeadEnd(state: UpdatePhase): boolean {
  return (
    state.phase === "failed" && (state.reason === "no-asset" || state.reason === "not-writable")
  );
}

export function UpdateFooter({ release }: { release: ReleaseNotes }) {
  const { t } = useTranslation();
  const bundleType = useUpdateStore((store) => store.bundleType);
  const state = useUpdateStore((store) => store.state);
  const start = useUpdateStore((store) => store.start);
  const restart = useUpdateStore((store) => store.restart);
  const closeNotes = useReleaseStore((store) => store.closeNotes);

  const canUpdate = bundleType !== "unknown";
  const downloadPage = (
    <Button variant="secondary" onClick={() => void openExternal(release.url ?? DOWNLOAD_PAGE)}>
      <Download className="size-4" aria-hidden="true" />
      {t("releases.downloadPage")}
    </Button>
  );

  if (!canUpdate) return downloadPage;

  const percent = updateProgressPercent(state);
  return (
    <div className="flex w-full flex-col gap-3">
      {state.phase === "downloading" && (
        <div className="space-y-1">
          <p className="text-sm text-foreground">
            {t("update.downloading", { release: release.number })}
          </p>
          <progress
            className="progress-update"
            aria-label={t("update.progressLabel")}
            max={percent === null ? undefined : 100}
            value={percent ?? undefined}
          />
          <p role="status" className="sr-only">
            {percent === null
              ? ""
              : t("update.progress", { percent: Math.floor(percent / 25) * 25 })}
          </p>
        </div>
      )}
      {state.phase === "installed" && (
        <p role="status" className="text-sm text-foreground">
          {t("update.installed", { release: release.number })}
        </p>
      )}
      {state.phase === "installed" && state.notSaved && (
        <p role="alert" className="text-sm text-destructive">
          {t("update.notSaved")}
        </p>
      )}
      {state.phase === "restarting" && (
        <p role="status" className="text-sm text-foreground">
          {t("update.restarting")}
        </p>
      )}
      {state.phase === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          {t(`update.errors.${state.reason}`)}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {downloadPage}
        {canStartUpdate(state) && !isDeadEnd(state) && (
          <Button variant="primary" onClick={() => void start(release.number)}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {state.phase === "failed"
              ? t("update.retry")
              : t("update.action", { release: release.number })}
          </Button>
        )}
        {state.phase === "checking" && (
          <Button variant="primary" disabled>
            {t("update.checking")}
          </Button>
        )}
        {state.phase === "installed" && (
          <>
            <Button variant="secondary" onClick={closeNotes}>
              {t("update.later")}
            </Button>
            <Button variant="primary" onClick={() => void restart()}>
              {t("update.restartNow")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
