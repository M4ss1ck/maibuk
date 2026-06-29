import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

// Mock i18n to prevent platform imports during settings store rehydration
vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));
vi.mock("../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

import { StartupRedirect } from "@/components/StartupRedirect";
import { useSettingsStore } from "@/features/settings/store";

// Helper component to display the current route for assertions
function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

describe("StartupRedirect", () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetDatabase.mockReset();
    useSettingsStore.setState({
      lastPath: null,
      appFontSize: 16,
      appFont: "sans",
      primaryColor: "#3B82F6",
      autoSave: true,
      alwaysOnTop: false,
      language: "en",
      spellCheckEnabled: true,
      customDictionary: [],
      dictionaryOpenInBrowser: false,
      showInlineFootnotes: true,
      showNotesChapter: false,
      hideKeyboardHints: false,
      defaultExportFormat: "epub",
    });
  });

  it("renders children when no lastPath is set", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <div>app content</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("app content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("redirects to lastPath for non-book routes", async () => {
    useSettingsStore.setState({ lastPath: "/settings" });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/settings");
    });
  });

  it("redirects to book route when book exists in database", async () => {
    useSettingsStore.setState({ lastPath: "/book/abc-123" });
    mockGetDatabase.mockResolvedValue({
      select: vi.fn().mockResolvedValue([{ id: "abc-123" }]),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/book/abc-123");
    });
  });

  it("clears lastPath and stays at root when book is deleted", async () => {
    useSettingsStore.setState({ lastPath: "/book/deleted-id" });
    mockGetDatabase.mockResolvedValue({
      select: vi.fn().mockResolvedValue([]),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <div>home content</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("home content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/");
    expect(useSettingsStore.getState().lastPath).toBeNull();
  });

  it("handles database error gracefully", async () => {
    useSettingsStore.setState({ lastPath: "/book/error-id" });
    mockGetDatabase.mockResolvedValue({
      select: vi.fn().mockRejectedValue(new Error("DB error")),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <div>fallback content</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("fallback content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/");
    expect(useSettingsStore.getState().lastPath).toBeNull();
  });

  it("skips redirect check when already on a non-root path", async () => {
    // When the app opens directly at /settings (not root), checked=true
    // immediately and no redirect logic runs
    useSettingsStore.setState({ lastPath: "/" });

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <StartupRedirect>
          <div>settings content</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("settings content")).toBeInTheDocument();
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/settings");
  });
});
