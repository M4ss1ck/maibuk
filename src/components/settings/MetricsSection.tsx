import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCategoryMeasuringSince } from "@/features/metrics/events-repo";
import { purgeMetricCategory } from "@/features/metrics/purge";
import type { MetricsCategory } from "@/features/metrics/types";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { getDatabase } from "@/lib/db";
import { metricsService } from "@/lib/metrics/MetricsService";
import { Button, Modal, Switch } from "@/components/ui";
import { SettingRow } from "@/components/settings/SettingRow";
import { SETTINGS_ROW_CLASS } from "@/components/settings/SettingsSection";
import type { SettingsRowId } from "@/components/settings/settings-sections";

const METRIC_CATEGORIES: MetricsCategory[] = ["writing", "time", "engagement"];

const CATEGORY_ROW_IDS: Record<MetricsCategory, SettingsRowId> = {
  writing: "metricsWriting",
  time: "metricsTime",
  engagement: "metricsEngagement",
};

const CATEGORY_EVENT_PREFIX: Partial<Record<MetricsCategory, string>> = {
  writing: "writing.",
  time: "session.",
};

export function MetricsSection() {
  const { t } = useTranslation();
  const { metrics, setMetricsCategoryEnabled, setMetricsSyncEnabled } = useSettingsStore();
  const authStatus = useSyncStore((state) => state.authStatus);
  const [pendingDisable, setPendingDisable] = useState<MetricsCategory | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const [measuringSince, setMeasuringSince] = useState<
    Partial<Record<MetricsCategory, string | null>>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function loadMeasuringSince() {
      const db = await getDatabase();
      const entries = await Promise.all(
        METRIC_CATEGORIES.map(
          async (category) => [category, await getCategoryMeasuringSince(db, category)] as const
        )
      );
      if (!cancelled) {
        setMeasuringSince(Object.fromEntries(entries));
      }
    }

    void loadMeasuringSince();
    return () => {
      cancelled = true;
    };
  }, [metrics.enabled.writing, metrics.enabled.time, metrics.enabled.engagement]);

  const handleCategoryChange = (category: MetricsCategory, enabled: boolean) => {
    if (enabled) {
      setMetricsCategoryEnabled(category, true);
      return;
    }

    if (category === "engagement") {
      setMetricsCategoryEnabled(category, false);
      shutdownIfNoCategoriesRemain(category, false);
      return;
    }

    setPendingDisable(category);
  };

  const handleConfirmDisable = async () => {
    if (!pendingDisable) return;
    const prefix = CATEGORY_EVENT_PREFIX[pendingDisable];
    if (!prefix) return;

    setIsPurging(true);
    try {
      await purgeMetricCategory(prefix);
      setMetricsCategoryEnabled(pendingDisable, false);
      setMeasuringSince((current) => ({ ...current, [pendingDisable]: null }));
      shutdownIfNoCategoriesRemain(pendingDisable, false);
      setPendingDisable(null);
    } finally {
      setIsPurging(false);
    }
  };

  const pendingLabel = pendingDisable ? t(`settings.metrics.${pendingDisable}.label`) : "";
  const pendingDeletedData = pendingDisable
    ? t(`settings.metrics.${pendingDisable}.description`)
    : "";

  return (
    <>
      {METRIC_CATEGORIES.map((category) => {
        const measuredDate = formatMeasuredDate(measuringSince[category]);
        return (
          <SettingRow
            key={category}
            id={CATEGORY_ROW_IDS[category]}
            className={SETTINGS_ROW_CLASS}
            labelExtra={
              <p className="mt-1 text-xs text-muted-foreground">
                {measuredDate
                  ? t("settings.metrics.measuringSince", {
                      date: measuredDate,
                    })
                  : t("settings.metrics.notMeasuredYet")}
              </p>
            }
          >
            <Switch
              checked={metrics.enabled[category]}
              onChange={(enabled) => handleCategoryChange(category, enabled)}
              label={t(`settings.metrics.${category}.label`)}
            />
          </SettingRow>
        );
      })}

      <SettingRow
        id="metricsSync"
        className={SETTINGS_ROW_CLASS}
        labelExtra={
          authStatus !== "logged-in" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.metrics.syncRequiresAuth")}
            </p>
          ) : undefined
        }
      >
        <Switch
          checked={metrics.syncMetrics}
          onChange={setMetricsSyncEnabled}
          label={t("settings.metrics.sync.label")}
          disabled={authStatus !== "logged-in"}
        />
      </SettingRow>

      <Modal
        isOpen={pendingDisable !== null}
        onClose={() => {
          if (!isPurging) setPendingDisable(null);
        }}
        title={t("settings.metrics.disableTitle", { label: pendingLabel })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingDisable(null)} disabled={isPurging}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDisable} disabled={isPurging}>
              {t("settings.metrics.confirmDisable", { label: pendingLabel })}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("settings.metrics.disableDescription", {
            deletedData: pendingDeletedData,
          })}
        </p>
      </Modal>
    </>
  );

  function shutdownIfNoCategoriesRemain(category: MetricsCategory, enabled: boolean) {
    const next = { ...metrics.enabled, [category]: enabled };
    if (!Object.values(next).some(Boolean)) {
      metricsService.shutdown();
    }
  }
}

function formatMeasuredDate(value: string | null | undefined): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
