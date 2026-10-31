import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { platformState, mockConfigureTray, mockDefaultBackupDirectory } = vi.hoisted(() => ({
  platformState: { isDesktop: true },
  mockConfigureTray: vi.fn().mockResolvedValue(undefined),
  mockDefaultBackupDirectory: vi.fn().mockResolvedValue("/home/a/.config/com.maibuk.app/backups"),
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  configureTray: mockConfigureTray,
  getDefaultBackupDirectory: mockDefaultBackupDirectory,
}));

import type { TrayConfig } from "@/lib/platform";

let i18n: typeof import("@/i18n").default;
let useSettingsStore: typeof import("@/features/settings/store").useSettingsStore;

function lastConfig(): TrayConfig {
  return mockConfigureTray.mock.lastCall?.[0] as TrayConfig;
}

beforeEach(async () => {
  platformState.isDesktop = true;
  vi.resetModules();
  mockConfigureTray.mockClear();
  i18n = (await import("@/i18n")).default;
  useSettingsStore = (await import("@/features/settings/store")).useSettingsStore;
  await i18n.changeLanguage("en");
  useSettingsStore.setState({ trayResourceUsage: false, backupDirectory: null, language: "en" });
});

describe("buildTrayLabels", () => {
  it("words the tray in English with the period decimal", async () => {
    const { buildTrayLabels } = await import("@/lib/window/trayMenu");
    expect(buildTrayLabels("en")).toEqual({
      show: "Show Maibuk",
      quit: "Quit",
      cpu: "CPU {value}",
      ram: "RAM {value}",
      storage: "Storage {value}",
      app: "App {value}",
      data: "Data {value}",
      backups: "Backups {value}",
      plugins: "Plugins {value}",
      unknown: "—",
      decimalSeparator: ".",
    });
  });

  it("words the tray in Spanish with the comma decimal", async () => {
    const { buildTrayLabels } = await import("@/lib/window/trayMenu");
    const labels = buildTrayLabels("es");
    expect(labels.show).toBe("Mostrar Maibuk");
    expect(labels.quit).toBe("Salir");
    expect(labels.backups).toBe("Copias de seguridad {value}");
    expect(labels.decimalSeparator).toBe(",");
  });
});

describe("installTrayMenu", () => {
  let uninstall = () => {};

  afterEach(() => uninstall());

  async function installFresh(): Promise<void> {
    const { installTrayMenu } = await import("@/lib/window/trayMenu");
    uninstall = installTrayMenu();
  }

  it("sends the labels and the setting at startup, with the default Backup Directory", async () => {
    await installFresh();
    await vi.waitFor(() => expect(mockConfigureTray).toHaveBeenCalledTimes(1));
    expect(lastConfig()).toMatchObject({
      resourceUsage: false,
      backupDirectory: "/home/a/.config/com.maibuk.app/backups",
      labels: { show: "Show Maibuk" },
    });
  });

  it("turns Resource Usage on and off as the setting changes", async () => {
    await installFresh();
    await vi.waitFor(() => expect(mockConfigureTray).toHaveBeenCalledTimes(1));
    useSettingsStore.getState().setTrayResourceUsage(true);
    await vi.waitFor(() => expect(lastConfig().resourceUsage).toBe(true));
    useSettingsStore.getState().setTrayResourceUsage(false);
    await vi.waitFor(() => expect(lastConfig().resourceUsage).toBe(false));
  });

  it("follows a custom Backup Directory", async () => {
    await installFresh();
    await vi.waitFor(() => expect(mockConfigureTray).toHaveBeenCalledTimes(1));
    useSettingsStore.getState().setBackupDirectory("/mnt/backups");
    await vi.waitFor(() => expect(lastConfig().backupDirectory).toBe("/mnt/backups"));
  });

  it("rewords the tray when the language changes", async () => {
    await installFresh();
    await vi.waitFor(() => expect(mockConfigureTray).toHaveBeenCalledTimes(1));
    await i18n.changeLanguage("es");
    await vi.waitFor(() => expect(lastConfig().labels.quit).toBe("Salir"));
    expect(lastConfig().labels.decimalSeparator).toBe(",");
  });

  it("ignores settings that do not reach the tray", async () => {
    await installFresh();
    await vi.waitFor(() => expect(mockConfigureTray).toHaveBeenCalledTimes(1));
    useSettingsStore.getState().setCloseToTray(true);
    useSettingsStore.getState().setTrayResourceUsage(true);
    await vi.waitFor(() => expect(lastConfig().resourceUsage).toBe(true));
    expect(mockConfigureTray).toHaveBeenCalledTimes(2);
  });

  it("does nothing outside the desktop app", async () => {
    platformState.isDesktop = false;
    await installFresh();
    useSettingsStore.getState().setTrayResourceUsage(true);
    expect(mockConfigureTray).not.toHaveBeenCalled();
  });
});
