import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackupSection } from "@/components/settings/BackupSection";
import { useSettingsStore } from "@/features/settings/store";
import type { BackupAdapter } from "@/lib/platform/types";

const { mockAdapter, mockTranslate, platformState, getDialog } = vi.hoisted(() => ({
  mockAdapter: {
    saveBackup: vi.fn(),
    listBackups: vi.fn().mockResolvedValue([]),
    listBackupsPage: vi.fn().mockResolvedValue({
      entries: [
        {
          filename: "maibuk-backup-manual-2026-03-15T14-30-00.sql",
          trigger: "manual",
          createdAt: new Date("2026-03-15T14:30:00.000Z"),
          sizeBytes: 1024,
          checksum: "hash",
        },
      ],
      totalCount: 21,
      totalSizeBytes: 1024,
      page: 1,
      pageSize: 10,
    }),
    readBackup: vi.fn(),
    deleteBackup: vi.fn(),
  } satisfies BackupAdapter,
  mockTranslate: vi.fn((key: string) => {
    if (key.startsWith("backup.trigger.")) return key.replace("backup.trigger.", "");
    return key;
  }),
  platformState: { isDesktop: true },
  getDialog: vi.fn().mockResolvedValue({ open: vi.fn().mockResolvedValue(null) }),
}));

vi.mock("../../../../lib/platform", () => ({
  createBackup: vi.fn().mockResolvedValue(mockAdapter),
  getDialog,
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  IS_TAURI: true,
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
}));

vi.mock("../../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: mockTranslate,
  }),
}));

describe("BackupSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      backupRetention: 20,
      backupDirectory: null,
      backupListPage: 1,
      backupListPageSize: 10,
    });
  });

  it("renders the total page count as an end adornment inside the page selector", async () => {
    render(<BackupSection />);

    await waitFor(() => expect(screen.getByText("/ 3")).toBeInTheDocument());
    const pageSelector = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "1/ 3");

    expect(pageSelector).toBeInTheDocument();
  });

  it("hides custom backup directory controls on Android", async () => {
    platformState.isDesktop = false;
    render(<BackupSection />);
    await screen.findByRole("button", { name: "backup.createBackup" });

    expect(screen.queryByLabelText("backup.directoryLabel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "backup.chooseDirectory" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "backup.createBackup" }),
    ).toBeInTheDocument();
  });

  it("opens the directory picker from the keyboard on desktop", async () => {
    platformState.isDesktop = true;
    const user = userEvent.setup();
    render(<BackupSection />);
    const choose = await screen.findByRole("button", {
      name: "backup.chooseDirectory",
    });
    choose.focus();
    await user.keyboard("{Enter}");
    expect(getDialog).toHaveBeenCalledOnce();
  });
});
