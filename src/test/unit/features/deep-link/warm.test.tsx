import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
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

const platformState = vi.hoisted(() => ({ isTauri: true, isDesktop: false }));
vi.mock("@/lib/platform", () => ({
  get IS_TAURI() {
    return platformState.isTauri;
  },
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  get IS_WEB() {
    return !platformState.isTauri;
  },
  get IS_ANDROID() {
    return false;
  },
}));

const tauriMocks = vi.hoisted(() => ({
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn(async () => null as string[] | null),
  show: vi.fn(async () => {}),
  setFocus: vi.fn(async () => {}),
  unminimize: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  get onOpenUrl() {
    return tauriMocks.onOpenUrl;
  },
  get getCurrent() {
    return tauriMocks.getCurrent;
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: tauriMocks.show,
    setFocus: tauriMocks.setFocus,
    unminimize: tauriMocks.unminimize,
  }),
}));

describe("DeepLinkHandler warm push", () => {
  let testDb: DatabaseAdapter;
  beforeEach(async () => {
    vi.resetModules();
    platformState.isTauri = true;
    platformState.isDesktop = false;
    testDb = await createTestDatabase();
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO notes (id, title, content, "order", created_at, updated_at) VALUES ('n1','Note','<p>hi</p>',0,?,?)`,
      [now, now]
    );
    mockGetDatabase.mockResolvedValue(testDb as never);
    tauriMocks.onOpenUrl.mockReset().mockImplementation(async () => async () => {});
    tauriMocks.getCurrent.mockReset().mockResolvedValue(null);
  });

  it("warm link pushes so Back returns", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    const { DeepLinkHandler } = await import("@/components/DeepLinkHandler");
    const { releaseDeepLinkQueue } = await import("@/features/deep-link/bridge");
    // Ensure gate is released for warm (StartupRedirect would have released)
    releaseDeepLinkQueue();

    function BackTester() {
      const loc = useLocation();
      const nav = useNavigate();
      return (
        <>
          <div data-testid="loc">{loc.pathname}</div>
          <button type="button" onClick={() => nav(-1)}>
            back
          </button>
        </>
      );
    }

    const { getByText, getByTestId } = render(
      <MemoryRouter initialEntries={["/"]}>
        <DeepLinkHandler />
        <BackTester />
      </MemoryRouter>
    );

    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalled());
    await captured(["maibuk://note/n1"]);
    await waitFor(() => expect(getByTestId("loc")).toHaveTextContent("/notes/n1"));
    getByText("back").click();
    await waitFor(() => expect(getByTestId("loc")).toHaveTextContent("/"));
  });

  it("handles one native event exactly once after a StrictMode remount", async () => {
    let captured: (urls: string[]) => void = () => {};
    tauriMocks.onOpenUrl.mockImplementation(async (cb: (urls: string[]) => void) => {
      captured = cb;
      return async () => {};
    });
    const { DeepLinkHandler } = await import("@/components/DeepLinkHandler");
    const { releaseDeepLinkQueue } = await import("@/features/deep-link/bridge");
    releaseDeepLinkQueue();

    function BackTester() {
      const location = useLocation();
      const navigate = useNavigate();
      return (
        <>
          <div data-testid="strict-location">{location.pathname}</div>
          <button type="button" onClick={() => navigate(-1)}>
            strict back
          </button>
        </>
      );
    }

    const { getByText, getByTestId } = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/"]}>
          <DeepLinkHandler />
          <BackTester />
        </MemoryRouter>
      </StrictMode>
    );

    await waitFor(() => expect(tauriMocks.onOpenUrl).toHaveBeenCalledTimes(1));
    await captured(["maibuk://note/n1"]);
    await waitFor(() => expect(getByTestId("strict-location")).toHaveTextContent("/notes/n1"));

    getByText("strict back").click();
    await waitFor(() => expect(getByTestId("strict-location")).toHaveTextContent("/"));
  });
});
