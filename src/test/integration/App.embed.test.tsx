import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockRunDailyBackupOnce } = vi.hoisted(() => ({
  mockRunDailyBackupOnce: vi.fn(),
}));

vi.mock("../../components/Layout", () => ({
  Layout: () => <div>layout-view</div>,
}));

vi.mock("../../pages/Home", () => ({
  Home: () => <div>home-view</div>,
}));

vi.mock("../../pages/BookEditor", () => ({
  BookEditor: () => <div>book-editor-view</div>,
}));

vi.mock("../../pages/CoverDesigner", () => ({
  CoverDesigner: () => <div>cover-designer-view</div>,
}));

vi.mock("../../pages/Settings", () => ({
  Settings: () => <div>settings-view</div>,
}));

vi.mock("../../pages/Embed", () => ({
  Embed: () => <div>embed-view</div>,
}));

vi.mock("../../components/StartupRedirect", () => ({
  StartupRedirect: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="startup-redirect">{children}</div>
  ),
}));

vi.mock("../../components/PathTracker", () => ({
  PathTracker: () => <div data-testid="path-tracker" />,
}));

vi.mock("../../components/GlobalShortcuts", () => ({
  GlobalShortcuts: () => <div data-testid="global-shortcuts" />,
}));

vi.mock("../../components/ui", () => ({
  ToastViewport: () => <div data-testid="toast-viewport" />,
}));

vi.mock("../../features/backup/lifecycle", () => ({
  runDailyBackupOnce: mockRunDailyBackupOnce,
}));

import App from "@/App";

describe("App embed route behavior", () => {
  beforeEach(() => {
    mockRunDailyBackupOnce.mockReset();
  });

  it("keeps startup wrappers on regular routes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId("startup-redirect")).toBeInTheDocument();
    expect(screen.getByTestId("path-tracker")).toBeInTheDocument();
    expect(screen.getByTestId("global-shortcuts")).toBeInTheDocument();
    expect(screen.getByTestId("toast-viewport")).toBeInTheDocument();
  });

  it("removes startup wrappers and side effects on /embed", () => {
    render(
      <MemoryRouter initialEntries={["/embed"]}>
        <App />
      </MemoryRouter>
    );

    expect(screen.queryByTestId("startup-redirect")).not.toBeInTheDocument();
    expect(screen.queryByTestId("path-tracker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("global-shortcuts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(screen.getByText("embed-view")).toBeInTheDocument();
    expect(mockRunDailyBackupOnce).not.toHaveBeenCalled();
  });
});
