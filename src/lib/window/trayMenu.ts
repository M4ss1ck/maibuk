import i18n from "@/i18n";
import { useSettingsStore } from "@/features/settings/store";
import {
  IS_DESKTOP,
  configureTray,
  getDefaultBackupDirectory,
  type TrayLabels,
} from "@/lib/platform";

let installed = false;

// i18next fills `{{value}}`; Rust fills the `{value}` left in its place.
const VALUE = { value: "{value}" };

export function buildTrayLabels(language: string): TrayLabels {
  const t = i18n.getFixedT(language);
  const decimal = new Intl.NumberFormat(language)
    .formatToParts(1.5)
    .find((part) => part.type === "decimal");
  return {
    show: t("tray.show"),
    quit: t("tray.quit"),
    cpu: t("tray.cpu", VALUE),
    ram: t("tray.ram", VALUE),
    storage: t("tray.storage", VALUE),
    app: t("tray.app", VALUE),
    data: t("tray.data", VALUE),
    backups: t("tray.backups", VALUE),
    plugins: t("tray.plugins", VALUE),
    unknown: t("tray.unknown"),
    decimalSeparator: decimal?.value ?? ".",
  };
}

async function sendTrayConfig(): Promise<void> {
  const { trayResourceUsage, backupDirectory } = useSettingsStore.getState();
  await configureTray({
    labels: buildTrayLabels(i18n.language),
    resourceUsage: trayResourceUsage,
    backupDirectory: backupDirectory ?? (await getDefaultBackupDirectory()),
  });
}

// Rust cannot read the settings store, so the tray learns its language,
// Resource Usage, and Backup Directory from here: once at startup and again
// whenever one changes. Sends run one after another so the last state wins;
// a failed send leaves the tray as it was and must not surface anywhere.
// Returns the uninstall.
export function installTrayMenu(): () => void {
  if (!IS_DESKTOP || installed) return () => {};
  installed = true;
  let queue = Promise.resolve();
  const send = () => {
    queue = queue.then(sendTrayConfig).catch(() => {});
  };
  send();
  const unsubscribe = useSettingsStore.subscribe((state, prev) => {
    if (
      state.trayResourceUsage !== prev.trayResourceUsage ||
      state.backupDirectory !== prev.backupDirectory
    ) {
      send();
    }
  });
  i18n.on("languageChanged", send);
  return () => {
    unsubscribe();
    i18n.off("languageChanged", send);
    installed = false;
  };
}
