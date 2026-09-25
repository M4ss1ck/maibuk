import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupSection } from "@/components/settings/BackupSection";
import { toast } from "@/components/ui/Toast";
import { formatBackupDate } from "@/features/backup/utils";
import { useSettingsStore } from "@/features/settings/store";
import type { BackupAdapter, BackupEntry, BackupPage } from "@/lib/platform/types";

const {
  mockAdapter,
  mockTranslate,
  platformState,
  mockPickBackupDirectory,
  mockRequestBackupDirectory,
  mockForgetBackupDirectory,
  i18nState,
  mockGetDefaultBackupDirectory,
  mockCreateBackup,
} = vi.hoisted(() => ({
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
  mockTranslate: vi.fn((key: string, options?: Record<string, unknown>) => {
    if (key.startsWith("backup.trigger.")) return key.replace("backup.trigger.", "");
    if (options?.count !== undefined) return `${key}:${options.count}`;
    if (options?.date !== undefined) return `${key}:${options.date}`;
    return key;
  }),
  i18nState: { language: "en" },
  platformState: { isDesktop: true, defaultDirectory: "/home/author/.config/maibuk/backups" },
  mockPickBackupDirectory: vi.fn(),
  mockRequestBackupDirectory: vi.fn(),
  mockForgetBackupDirectory: vi.fn(),
  mockCreateBackup: vi.fn(),
  mockGetDefaultBackupDirectory: vi.fn(),
}));

vi.mock("../../../../lib/platform", () => ({
  BACKUP_DIRECTORY_NOT_APPROVED: "BACKUP_DIRECTORY_NOT_APPROVED",
  createBackup: mockCreateBackup,
  pickBackupDirectory: mockPickBackupDirectory,
  requestBackupDirectory: mockRequestBackupDirectory,
  forgetBackupDirectory: mockForgetBackupDirectory,
  getOS: vi.fn().mockResolvedValue({ locale: vi.fn().mockResolvedValue("en-US") }),
  getDefaultBackupDirectory: mockGetDefaultBackupDirectory,
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
    i18n: i18nState,
  }),
}));

const MANUAL = "maibuk-backup-manual-2026-03-15T14-30-00.sql";
const DAILY = "maibuk-backup-daily-2026-03-14T09-05-03.sql";
const CLOSE = "maibuk-backup-close-2026-03-13T18-00-00.sql";

function entry(filename: string, trigger: BackupEntry["trigger"], createdAt: Date): BackupEntry {
  return { filename, trigger, createdAt, sizeBytes: 1024, checksum: "hash" };
}

function threeBackupPage(): BackupPage {
  return {
    entries: [
      entry(MANUAL, "manual", new Date(2026, 2, 15, 14, 30, 0)),
      entry(DAILY, "daily", new Date(2026, 2, 14, 9, 5, 3)),
      entry(CLOSE, "close", new Date(2026, 2, 13, 18, 0, 0)),
    ],
    totalCount: 13,
    totalSizeBytes: 3072,
    page: 1,
    pageSize: 10,
  };
}

function rowCheckboxes(): HTMLElement[] {
  return screen.getAllByRole("checkbox", { name: /^backup\.selectRow:/ });
}

function selectAllCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: "backup.selectAllOnPage" });
}

function bulkDeleteButton(count: number): HTMLElement {
  return screen.getByRole("button", {
    name: "backup.deleteBackup",
    description: `backup.selectedCount:${count}`,
  });
}

describe("BackupSection", () => {
  afterEach(() => {
    // Only vi.spyOn spies (toast, console); hoisted vi.fn mocks keep their setup.
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    i18nState.language = "en";
    platformState.isDesktop = true;
    mockCreateBackup.mockResolvedValue(mockAdapter);
    mockGetDefaultBackupDirectory.mockResolvedValue(platformState.defaultDirectory);
    mockPickBackupDirectory.mockResolvedValue(null);
    mockRequestBackupDirectory.mockResolvedValue(true);
    mockForgetBackupDirectory.mockResolvedValue(undefined);
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

  it("renders a close backup with its localized trigger", async () => {
    platformState.isDesktop = true;
    mockAdapter.listBackupsPage.mockResolvedValueOnce({
      entries: [
        {
          filename: "maibuk-backup-close-2026-03-15T14-30-00.sql",
          trigger: "close",
          createdAt: new Date("2026-03-15T14:30:00.000Z"),
          sizeBytes: 1024,
          checksum: "hash",
        },
      ],
      totalCount: 1,
      totalSizeBytes: 1024,
      page: 1,
      pageSize: 10,
    });

    render(<BackupSection />);

    expect(await screen.findByText("close")).toBeInTheDocument();
    expect(mockTranslate).toHaveBeenCalledWith("backup.trigger.close");
  });

  it("hides custom backup directory controls on Android", async () => {
    platformState.isDesktop = false;
    render(<BackupSection />);
    await screen.findByRole("button", { name: "backup.createBackup" });

    expect(screen.queryByLabelText("backup.directoryLabel")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "backup.chooseDirectory" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "backup.createBackup" })).toBeInTheDocument();
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
    expect(mockPickBackupDirectory).toHaveBeenCalledOnce();
  });

  it("scrolls the backup table horizontally instead of clipping row actions", async () => {
    render(<BackupSection />);

    const table = await screen.findByRole("table");
    expect(table).toHaveClass("min-w-[600px]");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
  });

  it("stacks the directory input and choose button on narrow containers", async () => {
    platformState.isDesktop = true;
    render(<BackupSection />);

    const choose = await screen.findByRole("button", { name: "backup.chooseDirectory" });
    const row = choose.parentElement;
    expect(row).not.toBeNull();
    expect(row).toHaveClass("flex-col", "@sm:flex-row");
  });

  describe("backup directory", () => {
    beforeEach(() => {
      // jsdom never has window focus; the app window does while the author types.
      vi.spyOn(document, "hasFocus").mockReturnValue(true);
    });

    async function renderWithDirectoryField() {
      const user = userEvent.setup();
      render(<BackupSection />);
      const input = await screen.findByLabelText("backup.directoryLabel");
      const shown = useSettingsStore.getState().backupDirectory ?? platformState.defaultDirectory;
      await waitFor(() => expect(input).toHaveValue(shown));
      // The default directory resolves once; custom-directory tests compare against it.
      await waitFor(() => expect(mockGetDefaultBackupDirectory).toHaveBeenCalled());
      await act(async () => {});
      return { user, input };
    }

    async function typeDirectory(
      user: ReturnType<typeof userEvent.setup>,
      input: HTMLElement,
      path: string
    ) {
      input.focus();
      await user.clear(input);
      if (path) await user.type(input, path);
    }

    it("shows the directory backups are saved in when no custom one is set", async () => {
      const { input } = await renderWithDirectoryField();

      expect(input).toHaveValue(platformState.defaultDirectory);
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
    });

    it("opens the folder picker at the custom directory", async () => {
      useSettingsStore.setState({ backupDirectory: "/mnt/backups" });
      const user = userEvent.setup();
      render(<BackupSection />);

      const choose = await screen.findByRole("button", { name: "backup.chooseDirectory" });
      choose.focus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(mockPickBackupDirectory).toHaveBeenCalledWith("/mnt/backups"));
    });

    it("opens the folder picker at the default directory when none is set", async () => {
      const { user } = await renderWithDirectoryField();
      const choose = screen.getByRole("button", { name: "backup.chooseDirectory" });
      choose.focus();
      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(mockPickBackupDirectory).toHaveBeenCalledWith(platformState.defaultDirectory)
      );
    });

    it("moving from a typed path to Choose folder starts the picker there without saving it", async () => {
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      await user.tab();
      expect(screen.getByRole("button", { name: "backup.chooseDirectory" })).toHaveFocus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(mockPickBackupDirectory).toHaveBeenCalledWith("/mnt/typed"));
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
    });

    it("commits the typed path once focus leaves Choose folder too", async () => {
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      await user.tab();
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
      await user.tab();

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/typed"));
      expect(mockRequestBackupDirectory).toHaveBeenCalledOnce();
    });

    it("keeps the draft when a native window takes focus", async () => {
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      input.blur();

      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
      expect(input).toHaveValue("/mnt/typed");
    });

    it("returns to the typed path when the picker is cancelled", async () => {
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      await user.click(screen.getByRole("button", { name: "backup.chooseDirectory" }));

      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveValue("/mnt/typed");
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
    });

    it("keeps focus while typing and asks for approval only on Enter", async () => {
      i18nState.language = "es";
      const { user, input } = await renderWithDirectoryField();

      input.focus();
      await user.keyboard("x");
      expect(input).toHaveFocus();

      await typeDirectory(user, input, "/mnt/custom backups");
      expect(input).toHaveFocus();
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
      expect(mockGetDefaultBackupDirectory).toHaveBeenCalledTimes(1);

      await user.keyboard("{Enter}");

      expect(mockRequestBackupDirectory).toHaveBeenCalledWith("/mnt/custom backups", "es");
      await waitFor(() =>
        expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/custom backups")
      );
      await waitFor(() => expect(mockCreateBackup).toHaveBeenLastCalledWith("/mnt/custom backups"));
      expect(input).toHaveFocus();
      expect(screen.getByRole("button", { name: "backup.createBackup" })).toBeInTheDocument();
    });

    it("asks for approval when the field loses focus", async () => {
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      input.blur();

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/typed"));
      expect(mockRequestBackupDirectory).toHaveBeenCalledOnce();
    });

    it("asks once when the native confirmation blurs the field mid-commit", async () => {
      let answer: ((approved: boolean) => void) | undefined;
      mockRequestBackupDirectory.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/typed");
      await user.keyboard("{Enter}");
      input.blur();
      answer?.(true);

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/typed"));
      expect(mockRequestBackupDirectory).toHaveBeenCalledOnce();
    });

    it("changes nothing when the author declines the native confirmation", async () => {
      mockRequestBackupDirectory.mockResolvedValue(false);
      useSettingsStore.setState({ backupDirectory: "/mnt/current" });
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/home/author/.ssh");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(input).toHaveValue("/mnt/current"));
      expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/current");
      expect(screen.queryByText("backup.directoryAccessFailed")).not.toBeInTheDocument();
    });

    it.each(["backups", "~/Backups", "./backups"])(
      "rejects the relative path %s without asking or saving",
      async (path) => {
        const { user, input } = await renderWithDirectoryField();

        await typeDirectory(user, input, path);
        await user.keyboard("{Enter}");

        expect(input).toHaveAccessibleDescription("backup.directoryNotAbsolute");
        expect(input).toBeInvalid();
        expect(input).toHaveValue(path);
        expect(input).toHaveFocus();
        expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().backupDirectory).toBeNull();

        await typeDirectory(user, input, "/mnt/fixed");
        expect(input).not.toBeInvalid();
      }
    );

    it("shows an error when approval fails", async () => {
      mockRequestBackupDirectory.mockRejectedValue(new Error("BACKUP_DIRECTORY_INVALID"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/");
      await user.keyboard("{Enter}");

      await waitFor(() =>
        expect(input).toHaveAccessibleDescription("backup.directoryAccessFailed")
      );
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
    });

    it("falls back to the default directory and forgets the approval when the field is cleared", async () => {
      useSettingsStore.setState({ backupDirectory: "/mnt/custom" });
      const { user, input } = await renderWithDirectoryField();
      expect(input).toHaveValue("/mnt/custom");

      await typeDirectory(user, input, "");
      await user.keyboard("{Enter}");

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBeNull());
      expect(input).toHaveValue(platformState.defaultDirectory);
      await waitFor(() => expect(mockCreateBackup).toHaveBeenLastCalledWith(null));
      expect(mockForgetBackupDirectory).toHaveBeenCalledOnce();
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
    });

    it.each([
      ["typed back in", (dir: string) => dir],
      ["with a trailing slash", (dir: string) => `${dir}/`],
    ])("treats the default directory %s as the default", async (_label, variant) => {
      useSettingsStore.setState({ backupDirectory: "/mnt/custom" });
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, variant(platformState.defaultDirectory));
      await user.keyboard("{Enter}");

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBeNull());
      await waitFor(() => expect(mockCreateBackup).toHaveBeenLastCalledWith(null));
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
    });

    it("does not ask again for the current directory with a trailing slash", async () => {
      useSettingsStore.setState({ backupDirectory: "/mnt/custom" });
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "/mnt/custom/");
      await user.keyboard("{Enter}");

      expect(input).toHaveValue("/mnt/custom");
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
    });

    it("reverts an uncommitted draft and its error on Escape", async () => {
      const { user, input } = await renderWithDirectoryField();

      await typeDirectory(user, input, "relative");
      await user.keyboard("{Enter}");
      expect(input).toBeInvalid();
      await user.keyboard("{Escape}");

      expect(input).toHaveValue(platformState.defaultDirectory);
      expect(input).not.toBeInvalid();
      expect(useSettingsStore.getState().backupDirectory).toBeNull();
    });

    it("updates the field and the store when a folder is picked", async () => {
      mockPickBackupDirectory.mockResolvedValue("/picked/backups");
      const user = userEvent.setup();
      render(<BackupSection />);

      await user.click(await screen.findByRole("button", { name: "backup.chooseDirectory" }));

      await waitFor(() =>
        expect(useSettingsStore.getState().backupDirectory).toBe("/picked/backups")
      );
      expect(await screen.findByLabelText("backup.directoryLabel")).toHaveValue("/picked/backups");
      expect(mockRequestBackupDirectory).not.toHaveBeenCalled();
    });

    it("picking the default folder goes back to the default", async () => {
      useSettingsStore.setState({ backupDirectory: "/mnt/custom" });
      mockPickBackupDirectory.mockResolvedValue(platformState.defaultDirectory);
      const { user } = await renderWithDirectoryField();

      await user.click(screen.getByRole("button", { name: "backup.chooseDirectory" }));

      await waitFor(() => expect(useSettingsStore.getState().backupDirectory).toBeNull());
      expect(mockForgetBackupDirectory).toHaveBeenCalledOnce();
    });

    describe("a saved directory this device never approved", () => {
      beforeEach(() => {
        useSettingsStore.setState({ backupDirectory: "/mnt/old" });
        mockCreateBackup.mockImplementation(async (dir: string | null) => {
          if (dir === "/mnt/old" && !mockRequestBackupDirectory.mock.calls.length) {
            throw new Error("BACKUP_DIRECTORY_NOT_APPROVED");
          }
          return mockAdapter;
        });
      });

      it("says so on the field and disables Create", async () => {
        const { input } = await renderWithDirectoryField();

        await waitFor(() =>
          expect(input).toHaveAccessibleDescription("backup.directoryNeedsApproval")
        );
        expect(screen.getByRole("button", { name: "backup.createBackup" })).toBeDisabled();
        expect(screen.queryByText("backup.loadFailed")).not.toBeInTheDocument();
      });

      it("asks again on Enter in the unchanged field, then reloads the Backups", async () => {
        const { user, input } = await renderWithDirectoryField();
        await waitFor(() => expect(input).toBeInvalid());

        input.focus();
        await user.keyboard("{Enter}");

        expect(mockRequestBackupDirectory).toHaveBeenCalledWith("/mnt/old", "en");
        await waitFor(() => expect(input).not.toBeInvalid());
        await waitFor(() =>
          expect(screen.getByRole("button", { name: "backup.createBackup" })).toBeEnabled()
        );
        expect(useSettingsStore.getState().backupDirectory).toBe("/mnt/old");
      });
    });

    it("shows a loading state instead of unmounting the controls while the directory changes", async () => {
      let resolvePage: (() => void) | undefined;
      const { user, input } = await renderWithDirectoryField();

      mockAdapter.listBackupsPage.mockImplementationOnce(
        () =>
          new Promise<BackupPage>((resolve) => {
            resolvePage = () => resolve(threeBackupPage());
          })
      );

      await typeDirectory(user, input, "/mnt/slow");
      await user.keyboard("{Enter}");

      expect(await screen.findByText("common.loading")).toBeInTheDocument();
      expect(screen.getByLabelText("backup.directoryLabel")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "backup.createBackup" })).toBeInTheDocument();

      resolvePage?.();
      await screen.findByRole("table");
    });
  });

  describe("Date column", () => {
    it("formats dates in the app language, not the browser's", async () => {
      i18nState.language = "es";
      mockAdapter.listBackupsPage.mockResolvedValueOnce(threeBackupPage());
      render(<BackupSection />);

      const created = new Date(2026, 2, 14, 9, 5, 3);
      expect(await screen.findByText(formatBackupDate(created, "es"))).toBeInTheDocument();
      expect(screen.queryByText(formatBackupDate(created, "en"))).not.toBeInTheDocument();
    });
  });

  describe("selecting backups", () => {
    beforeEach(() => {
      mockAdapter.listBackupsPage.mockImplementation(async ({ page, pageSize }) => ({
        ...threeBackupPage(),
        page,
        pageSize,
      }));
      mockAdapter.deleteBackup.mockResolvedValue(undefined);
    });

    it("gives each row a checkbox named after its date and shows no selection bar at first", async () => {
      render(<BackupSection />);
      await screen.findByRole("table");

      expect(rowCheckboxes()).toHaveLength(3);
      expect(
        screen.getByRole("checkbox", {
          name: `backup.selectRow:${formatBackupDate(new Date(2026, 2, 15, 14, 30, 0), "en")}`,
        })
      ).toBeInTheDocument();
      expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument();
    });

    it("puts the checkbox column first in the header and in every row", async () => {
      render(<BackupSection />);
      const table = await screen.findByRole("table");

      const rows = within(table).getAllByRole("row");
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        const firstCell = row.firstElementChild as HTMLElement;
        expect(within(firstCell).getByRole("checkbox")).toBeInTheDocument();
        expect(firstCell).toHaveClass("w-10");
        // A flex box centers the checkbox on both axes; inline content would sit on the text baseline.
        expect(firstCell.firstElementChild).toHaveClass("flex", "items-center", "justify-center");
      }
    });

    it("selects a row with Space and shows the count with an inline Delete", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");

      rowCheckboxes()[1].focus();
      await user.keyboard(" ");

      expect(rowCheckboxes()[1]).toBeChecked();
      expect(screen.getByText("backup.selectedCount:1")).toBeInTheDocument();
      expect(bulkDeleteButton(1)).toBeInTheDocument();

      await user.keyboard(" ");
      expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument();
    });

    it("selects and clears the whole page from the header checkbox", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");

      selectAllCheckbox().focus();
      await user.keyboard(" ");
      expect(rowCheckboxes().every((box) => (box as HTMLInputElement).checked)).toBe(true);
      expect(screen.getByText("backup.selectedCount:3")).toBeInTheDocument();

      await user.keyboard(" ");
      expect(rowCheckboxes().some((box) => (box as HTMLInputElement).checked)).toBe(false);
    });

    it("shows the header checkbox as mixed when only some rows are selected", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");

      await user.click(rowCheckboxes()[0]);

      expect(selectAllCheckbox()).toBePartiallyChecked();
    });

    it("clears the selection when the page changes", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");
      await user.click(rowCheckboxes()[0]);

      await user.click(screen.getByRole("button", { name: "backup.nextPage" }));

      await waitFor(() => expect(useSettingsStore.getState().backupListPage).toBe(2));
      await waitFor(() =>
        expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument()
      );
      expect(rowCheckboxes().some((box) => (box as HTMLInputElement).checked)).toBe(false);
    });

    it("clears the selection when the page size changes", async () => {
      render(<BackupSection />);
      await screen.findByRole("table");
      const user = userEvent.setup();
      await user.click(rowCheckboxes()[0]);

      useSettingsStore.getState().setBackupListPageSize(25);

      await waitFor(() =>
        expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument()
      );
    });

    it("asks before deleting; Escape cancels and returns focus to Delete", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");
      selectAllCheckbox().focus();
      await user.keyboard(" ");

      bulkDeleteButton(3).focus();
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("backup.deleteSelectedConfirm:3")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(bulkDeleteButton(3)).toHaveFocus();
      expect(mockAdapter.deleteBackup).not.toHaveBeenCalled();
    });

    it("deletes every selected backup from the keyboard, then clears the selection", async () => {
      const success = vi.spyOn(toast, "success");
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");
      rowCheckboxes()[0].focus();
      await user.keyboard(" ");
      rowCheckboxes()[2].focus();
      await user.keyboard(" ");

      bulkDeleteButton(2).focus();
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog");
      within(dialog).getByRole("button", { name: "backup.deleteBackup" }).focus();
      await user.keyboard("{Enter}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(mockAdapter.deleteBackup.mock.calls.map(([name]) => name)).toEqual([MANUAL, CLOSE]);
      expect(success).toHaveBeenCalledWith("backup.deletedCount:2");
      await waitFor(() =>
        expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument()
      );
      expect(mockAdapter.listBackupsPage.mock.calls.length).toBeGreaterThan(1);
      expect(selectAllCheckbox()).toHaveFocus();
    });

    it("keeps deleting after a failure, reports the failures, and keeps them selected", async () => {
      const success = vi.spyOn(toast, "success");
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockAdapter.deleteBackup.mockImplementation(async (filename: string) => {
        if (filename === DAILY) throw new Error("EACCES");
      });
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");
      await user.click(selectAllCheckbox());

      await user.click(bulkDeleteButton(3));
      await user.click(
        within(await screen.findByRole("dialog")).getByRole("button", {
          name: "backup.deleteBackup",
        })
      );

      expect(await screen.findByText("backup.deleteSomeFailed:1")).toBeInTheDocument();
      expect(mockAdapter.deleteBackup).toHaveBeenCalledTimes(3);
      expect(success).toHaveBeenCalledWith("backup.deletedCount:2");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(screen.getByText("backup.selectedCount:1")).toBeInTheDocument();
      const dailyRow = screen.getByText("daily").closest("tr") as HTMLElement;
      expect(within(dailyRow).getByRole("checkbox")).toBeChecked();
    });

    it("drops a selected backup that leaves the page after a refresh", async () => {
      const user = userEvent.setup();
      render(<BackupSection />);
      await screen.findByRole("table");
      await user.click(rowCheckboxes()[2]);
      expect(screen.getByText("backup.selectedCount:1")).toBeInTheDocument();

      const shifted = threeBackupPage();
      shifted.entries = shifted.entries.slice(0, 2);
      mockAdapter.listBackupsPage.mockResolvedValue(shifted);
      // Deleting another row through its own button refreshes the page.
      const manualRow = screen.getByText("manual").closest("tr") as HTMLElement;
      await user.click(within(manualRow).getByRole("button", { name: "backup.deleteBackup" }));

      await waitFor(() =>
        expect(screen.queryByText(/^backup\.selectedCount/)).not.toBeInTheDocument()
      );
    });
  });
});
