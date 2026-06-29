import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mock i18n to prevent platform imports from settings store rehydration
vi.mock("../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

import { PathTracker } from "@/components/PathTracker";
import { useSettingsStore } from "@/features/settings/store";

describe("PathTracker", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ lastPath: null });
  });

  it("renders nothing visible", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <PathTracker />
      </MemoryRouter>
    );
    expect(container.innerHTML).toBe("");
  });

  it("saves root path to settings store", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PathTracker />
      </MemoryRouter>
    );
    expect(useSettingsStore.getState().lastPath).toBe("/");
  });

  it("saves /settings path to settings store", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PathTracker />
      </MemoryRouter>
    );
    expect(useSettingsStore.getState().lastPath).toBe("/settings");
  });

  it("saves nested book path to settings store", () => {
    render(
      <MemoryRouter initialEntries={["/book/abc-123"]}>
        <PathTracker />
      </MemoryRouter>
    );
    expect(useSettingsStore.getState().lastPath).toBe("/book/abc-123");
  });

  it("saves book cover path to settings store", () => {
    render(
      <MemoryRouter initialEntries={["/book/abc-123/cover"]}>
        <PathTracker />
      </MemoryRouter>
    );
    expect(useSettingsStore.getState().lastPath).toBe("/book/abc-123/cover");
  });
});
