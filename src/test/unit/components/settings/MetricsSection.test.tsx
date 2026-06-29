import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_METRICS_SETTINGS } from "@/features/settings/types";

const {
  mockChangeLanguage,
  mockGetDatabase,
  mockGetCategoryMeasuringSince,
  mockPurgeMetricCategory,
  mockShutdown,
  mockUseSyncStoreSelector,
} = vi.hoisted(() => ({
  mockChangeLanguage: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockGetCategoryMeasuringSince: vi.fn(),
  mockPurgeMetricCategory: vi.fn(),
  mockShutdown: vi.fn(),
  mockUseSyncStoreSelector: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "settings.metrics.title": "Metrics",
        "settings.metrics.description": "Control local writing metrics.",
        "settings.metrics.writing.label": "Writing volume",
        "settings.metrics.writing.description": "Typed, pasted, and deleted word events.",
        "settings.metrics.time.label": "Time tracking",
        "settings.metrics.time.description": "Session timing events.",
        "settings.metrics.engagement.label": "Engagement",
        "settings.metrics.engagement.description": "Edit ratio and deepest session views.",
        "settings.metrics.sync.label": "Sync metrics",
        "settings.metrics.sync.description": "Share metrics across signed-in devices.",
        "settings.metrics.syncRequiresAuth": "Sign in to sync to enable metrics sharing",
        "settings.metrics.measuringSince": `Measuring since ${params?.date}`,
        "settings.metrics.notMeasuredYet": "Not measured yet",
        "settings.metrics.disableTitle": `Delete ${params?.label}?`,
        "settings.metrics.disableDescription": `${params?.deletedData} will be deleted from this device.`,
        "settings.metrics.confirmDisable": `Delete ${params?.label}`,
        "common.cancel": "Cancel",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: mockChangeLanguage,
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../../features/sync/store", () => ({
  useSyncStore: (selector?: (state: { authStatus: string }) => string) => {
    const state = { authStatus: mockUseSyncStoreSelector() };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../../../features/metrics/events-repo", () => ({
  getCategoryMeasuringSince: mockGetCategoryMeasuringSince,
}));

vi.mock("../../../../features/metrics/purge", () => ({
  purgeMetricCategory: mockPurgeMetricCategory,
}));

vi.mock("../../../../lib/metrics/MetricsService", () => ({
  metricsService: {
    shutdown: mockShutdown,
  },
}));

const { useSettingsStore } = await import("@/features/settings/store");
const { MetricsSection } = await import("@/components/settings/MetricsSection");

describe("MetricsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockGetDatabase.mockResolvedValue({});
    mockGetCategoryMeasuringSince.mockImplementation((_db: unknown, category: string) =>
      category === "writing" ? Promise.resolve("2026-05-23T12:00:00.000Z") : Promise.resolve(null)
    );
    mockPurgeMetricCategory.mockResolvedValue(1);
    mockUseSyncStoreSelector.mockReturnValue("logged-out");
    useSettingsStore.setState({
      metrics: {
        ...DEFAULT_METRICS_SETTINGS,
        enabled: { ...DEFAULT_METRICS_SETTINGS.enabled },
      },
    });
  });

  it("confirms before disabling Writing volume and purges local writing events", async () => {
    const user = userEvent.setup();
    render(<MetricsSection />);

    await user.click(screen.getByRole("switch", { name: "Writing volume" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Typed, pasted, and deleted word events.");
    await user.click(screen.getByRole("button", { name: "Delete Writing volume" }));

    await waitFor(() => {
      expect(mockPurgeMetricCategory).toHaveBeenCalledWith("writing.");
    });
    expect(useSettingsStore.getState().metrics.enabled.writing).toBe(false);
  });

  it("hides Engagement without purging stored events", async () => {
    const user = userEvent.setup();
    render(<MetricsSection />);

    await user.click(screen.getByRole("switch", { name: "Engagement" }));

    expect(mockPurgeMetricCategory).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().metrics.enabled.engagement).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("terminates the worker when the last collection category is disabled", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({
      metrics: {
        ...DEFAULT_METRICS_SETTINGS,
        enabled: { writing: false, time: true, engagement: false },
      },
    });

    render(<MetricsSection />);
    await user.click(screen.getByRole("switch", { name: "Time tracking" }));
    await user.click(screen.getByRole("button", { name: "Delete Time tracking" }));

    await waitFor(() => {
      expect(mockPurgeMetricCategory).toHaveBeenCalledWith("session.");
    });
    expect(mockShutdown).toHaveBeenCalledTimes(1);
  });

  it("renders measuring-since and disables the sync toggle with auth hint when signed out", async () => {
    render(<MetricsSection />);

    expect(await screen.findByText("Measuring since May 23, 2026")).toBeInTheDocument();
    const syncSwitch = screen.getByRole("switch", { name: "Sync metrics" });
    // Sync requires an authenticated PocketBase session; flipping the toggle
    // while signed out would only confuse the user.
    expect(syncSwitch).toBeDisabled();
    expect(screen.getByText("Sign in to sync to enable metrics sharing")).toBeInTheDocument();
  });
});
