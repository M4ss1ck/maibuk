import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSnapshotMetrics,
  mockGetAggregate,
  mockGetDatabase,
  mockSettingsState,
} = vi.hoisted(() => ({
  mockGetSnapshotMetrics: vi.fn(),
  mockGetAggregate: vi.fn(),
  mockGetDatabase: vi.fn(),
  mockSettingsState: {
    metrics: {
      enabled: { writing: true, time: true, engagement: true },
      streakDailyWordThreshold: 50,
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        "metrics.title": "Metrics",
        "metrics.subtitle": "Local writing patterns",
        "metrics.totalWords": "Total words",
        "metrics.currentStreak": "Current streak",
        "metrics.longestStreak": "Longest streak",
        "metrics.daysThisWeek": "Days this week",
        "metrics.daysThisMonth": "Days this month",
        "metrics.heatmap": "Writing heatmap",
        "metrics.wpm": "Words per minute",
        "metrics.timeOfDay": "Time of day",
        "metrics.perWork": "Per work",
        "metrics.timePerWork": "Time per work",
        "metrics.deepestSession": "Deepest session",
        "metrics.editRatio": "Edit ratio",
        "metrics.netWords": "Net words written",
        "metrics.loadingEvents": "Loading writing patterns",
        "metrics.noActivity": "No activity yet",
        "metrics.disabledEmpty": "Metrics collection is disabled.",
        "metrics.engagementDisabled":
          "Engagement tracking is disabled — turn it on in Settings → Metrics.",
        "metrics.wordsCount": `${params?.formattedCount ?? params?.count ?? 0} words`,
        "common.words": "words",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../features/metrics/events-repo", () => ({
  getSnapshotMetrics: mockGetSnapshotMetrics,
}));

vi.mock("../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

vi.mock("../../../lib/metrics/MetricsService", () => ({
  metricsService: {
    getAggregate: mockGetAggregate,
  },
}));

vi.mock("../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
}));

const { Metrics } = await import("../../../pages/Metrics");

describe("Metrics page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsState.metrics.enabled = {
      writing: true,
      time: true,
      engagement: true,
    };
    mockSettingsState.metrics.streakDailyWordThreshold = 50;
    mockGetDatabase.mockResolvedValue({});
    mockGetSnapshotMetrics.mockResolvedValue({
      totalWords: 12345,
      perWork: [
        { workId: "book-1", title: "Novel One", wordCount: 8000 },
        { workId: "book-2", title: "Draft Two", wordCount: 4345 },
      ],
    });
    mockGetAggregate.mockImplementation(() => new Promise(() => {}));
  });

  it("renders snapshot totals while event-derived sections are still loading", async () => {
    render(<Metrics />);

    expect(await screen.findByText("12,345")).toBeInTheDocument();
    expect(screen.getByText("Novel One")).toBeInTheDocument();
    expect(screen.getByText("8,000 words")).toBeInTheDocument();
    expect(screen.getAllByText("Loading writing patterns").length).toBeGreaterThan(0);
  });

  it("renders event-derived aggregate results after the worker-backed calls resolve", async () => {
    mockGetAggregate.mockImplementation((key: string) => {
      if (key === "heatmap:2026") {
        return Promise.resolve({ days: [{ date: "2026-05-23", words: 120, events: 2 }] });
      }
      if (key === "streak:current") {
        return Promise.resolve({
          currentStreak: 2,
          longestStreak: 5,
          daysThisWeek: 3,
          daysThisMonth: 9,
        });
      }
      return Promise.resolve({
        typedWords: 150,
        deletedWords: 25,
        pastedWords: 10,
        netWords: 125,
        editRatio: 0.17,
        activeSec: 600,
        deepestSessionSec: 420,
        wpm: 15,
        timeOfDay: [{ hour: 14, words: 125 }],
        timeByWork: [{ workId: "book-1", activeSec: 600 }],
      });
    });

    render(<Metrics />);

    await waitFor(() => {
      expect(screen.getAllByText("125").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("shows a metrics-off empty state when every collection category is disabled", async () => {
    mockSettingsState.metrics.enabled = {
      writing: false,
      time: false,
      engagement: false,
    };

    render(<Metrics />);

    expect(screen.getByText("Metrics collection is disabled.")).toBeInTheDocument();
    expect(mockGetAggregate).not.toHaveBeenCalled();
  });

  it("replaces the engagement view when engagement tracking is disabled", async () => {
    mockSettingsState.metrics.enabled = {
      writing: true,
      time: true,
      engagement: false,
    };

    render(<Metrics />);

    expect(
      screen.getByText(
        "Engagement tracking is disabled — turn it on in Settings → Metrics.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Edit ratio")).not.toBeInTheDocument();
    expect(mockGetAggregate).toHaveBeenCalled();
  });
});
