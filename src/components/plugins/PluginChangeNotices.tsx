/**
 * The Plugin changed-files notice (#442). The management store lists one
 * non-blocking notification per changed copy (or Built-in update); this surface
 * renders each with the two actions a toast cannot hold: Review, which opens
 * Settings > Plugins and the copy's review dialog, and Dismiss, which clears
 * it. Nothing blocks the author's work; the notice is a polite live region so a
 * screen reader hears it, and it joins React Aria's top layer so an open Modal
 * leaves it announced.
 */

import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { usePluginManagementStore } from "@/features/plugins/management";
import { requestPluginReview } from "@/features/settings/focus-row";

export function PluginChangeNotices() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notifications = usePluginManagementStore((state) => state.notifications);

  return (
    <div
      data-react-aria-top-layer
      className="fixed top-[calc(1.5rem+env(safe-area-inset-top))] right-[calc(1.5rem+env(safe-area-inset-right))] z-50 flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {notifications.map((notification) => (
        <div
          key={notification.pluginId}
          role="status"
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-sm text-foreground toast-enter"
        >
          <span className="flex-1">
            {notification.kind === "changed"
              ? t("plugins.changedNotice", { name: notification.name })
              : notification.kind === "size"
                ? t("plugins.management.sizeWarning")
                : `${notification.name} · ${t("plugins.available")}`}
          </span>
          {notification.kind !== "size" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                usePluginManagementStore.getState().dismissNotification(notification.pluginId);
                requestPluginReview(notification.pluginId);
                navigate("/settings#plugins");
              }}
            >
              {t("plugins.noticeReview")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              usePluginManagementStore.getState().dismissNotification(notification.pluginId)
            }
          >
            {t("plugins.noticeDismiss")}
          </Button>
        </div>
      ))}
    </div>
  );
}
