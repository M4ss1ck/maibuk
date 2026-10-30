import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constants";
import { useReleaseStore } from "@/features/releases/store";
import { updateProgressPercent } from "@/features/update/progress";
import { useUpdateStore } from "@/features/update/store";

interface ReleaseBadgeProps {
  /** `sidebar` sits in the navigation footer; `about` sits on the Settings wordmark. */
  variant: "sidebar" | "about";
  className?: string;
}

const VARIANT_CLASS = {
  sidebar: "px-2 py-0.5 text-sm text-muted-foreground",
  about: "px-2.5 py-0.5 text-lg text-foreground",
} as const;

/**
 * The opaque "New" chip, shared by the badge and the newer Releases in the
 * dialog. While an Update downloads it shows the percent; once installed (or,
 * on Windows, downloaded) it reads as ready to restart.
 */
export function NewReleaseChip({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const state = useUpdateStore((store) => store.state);
  const percent = updateProgressPercent(state);
  const label =
    state.phase === "downloading" && percent !== null
      ? t("update.badgeProgress", { percent: Math.floor(percent) })
      : state.phase === "installed" || state.phase === "downloaded"
        ? t("update.badgeReady")
        : t("releases.new");
  return (
    <span
      className={`inline-flex items-center rounded-full border border-update-border bg-update-bg px-1.5 text-[0.6875rem] leading-4 font-semibold uppercase tracking-wide text-update-text ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * The installed Release number as a button that opens the Release Notes. When
 * a newer Release is published, the New chip rides along; the download itself
 * is offered only inside the dialog.
 */
export function ReleaseBadge({ variant, className = "" }: ReleaseBadgeProps) {
  const { t } = useTranslation();
  const hasUpdate = useReleaseStore((state) => state.newerReleases.length > 0);
  const openNotes = useReleaseStore((state) => state.openNotes);

  return (
    <button
      type="button"
      onClick={openNotes}
      data-command="global.openReleaseNotes"
      aria-label={t(hasUpdate ? "releases.badgeWithUpdate" : "releases.badge", {
        release: APP_VERSION,
      })}
      className={`inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card font-medium tabular-nums transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:min-h-10 ${VARIANT_CLASS[variant]} ${className}`}
    >
      <span>{APP_VERSION}</span>
      {hasUpdate && <NewReleaseChip />}
    </button>
  );
}
