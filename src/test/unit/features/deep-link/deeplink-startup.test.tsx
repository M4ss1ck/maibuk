import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createTestDatabase } from "../../../support/db-test-context";
import type { DatabaseAdapter } from "@/lib/platform/types";

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("../../../../lib/db", () => ({ getDatabase: mockGetDatabase }));

const deepLinkMocks = vi.hoisted(() => ({
  getDeepLinkBootstrap: vi.fn(async () => null as string[] | null),
  releaseDeepLinkQueue: vi.fn(),
  resolveBatch: vi.fn(async () => null as unknown),
}));

vi.mock("@/features/deep-link", async () => {
  const actual = (await vi.importActual<typeof import("@/features/deep-link")>(
    "@/features/deep-link"
  )) as Record<string, unknown>;
  return {
    ...actual,
    getDeepLinkBootstrap: deepLinkMocks.getDeepLinkBootstrap,
    releaseDeepLinkQueue: deepLinkMocks.releaseDeepLinkQueue,
    resolveBatch: deepLinkMocks.resolveBatch,
  };
});

function LocationDisplay() {
  const l = useLocation();
  return <div data-testid="location">{l.pathname}</div>;
}

describe("StartupRedirect deep-link cold handling", () => {
  let testDb: DatabaseAdapter;
  beforeEach(async () => {
    localStorage.clear();
    testDb = await createTestDatabase();
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('b1','Book','Author',?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('n1','Note','<h1 id="h-1">Sec</h1>',0,?,?)`,
      [now, now]
    );
    mockGetDatabase.mockResolvedValue(testDb as never);
    deepLinkMocks.getDeepLinkBootstrap.mockResolvedValue(null);
    deepLinkMocks.releaseDeepLinkQueue.mockClear();
    deepLinkMocks.resolveBatch.mockResolvedValue(null);
  });

  it("cold valid link replaces and skips saved-path", async () => {
    deepLinkMocks.getDeepLinkBootstrap.mockResolvedValue(["maibuk://note/n1"]);
    deepLinkMocks.resolveBatch.mockResolvedValue({ to: "/notes/n1" } as never);
    const { StartupRedirect } = await import("@/components/StartupRedirect");
    const { useSettingsStore } = await import("@/features/settings/store");
    useSettingsStore.setState({ lastPath: "/settings" } as never);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/notes/n1"));
    expect(deepLinkMocks.releaseDeepLinkQueue).toHaveBeenCalled();
  });

  it("cold malformed does normal restoration and releases", async () => {
    deepLinkMocks.getDeepLinkBootstrap.mockResolvedValue(["maibuk://note/n1/"]);
    deepLinkMocks.resolveBatch.mockResolvedValue(null);
    const { StartupRedirect } = await import("@/components/StartupRedirect");
    const { useSettingsStore } = await import("@/features/settings/store");
    useSettingsStore.setState({ lastPath: "/settings" } as never);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/settings"));
    expect(deepLinkMocks.releaseDeepLinkQueue).toHaveBeenCalled();
  });

  it("cold lookup failure settles gate and does normal startup", async () => {
    deepLinkMocks.getDeepLinkBootstrap.mockResolvedValue(["maibuk://note/n1"]);
    deepLinkMocks.resolveBatch.mockResolvedValue({
      to: null,
      toastKey: "deepLink.genericError",
    } as never);
    const { StartupRedirect } = await import("@/components/StartupRedirect");
    const { useSettingsStore } = await import("@/features/settings/store");
    useSettingsStore.setState({ lastPath: "/settings" } as never);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <div>home</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("home")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/settings"));
    expect(deepLinkMocks.releaseDeepLinkQueue).toHaveBeenCalled();
  });

  it("hanging getDeepLinkBootstrap times out after 3000ms and continues startup", async () => {
    deepLinkMocks.getDeepLinkBootstrap.mockImplementation(
      () => new Promise<string[] | null>(() => {})
    );
    const { StartupRedirect } = await import("@/components/StartupRedirect");
    const { useSettingsStore } = await import("@/features/settings/store");
    useSettingsStore.setState({ lastPath: "/settings" } as never);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <StartupRedirect>
          <div>home</div>
          <LocationDisplay />
        </StartupRedirect>
      </MemoryRouter>
    );
    // Before timeout, still showing LoadingScreen (no home)
    expect(screen.queryByText("home")).not.toBeInTheDocument();
    // Race timeout is 3000ms, wait for startup to continue
    await waitFor(() => expect(screen.getByText("home")).toBeInTheDocument(), { timeout: 5000 });
    expect(deepLinkMocks.releaseDeepLinkQueue).toHaveBeenCalled();
  }, 8000);

  it("releases gate even when already checked (not at root)", async () => {
    deepLinkMocks.getDeepLinkBootstrap.mockResolvedValue(null);
    const { StartupRedirect } = await import("@/components/StartupRedirect");
    const { useSettingsStore } = await import("@/features/settings/store");
    useSettingsStore.setState({ lastPath: "/settings" } as never);
    render(
      <MemoryRouter initialEntries={["/notes/n1"]}>
        <StartupRedirect>
          <div>not-root</div>
        </StartupRedirect>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("not-root")).toBeInTheDocument());
    expect(deepLinkMocks.releaseDeepLinkQueue).toHaveBeenCalled();
  });
});
