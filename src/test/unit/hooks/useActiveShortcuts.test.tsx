import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

import { useActiveShortcuts } from "@/hooks/useActiveShortcuts";
import { useModalStore } from "@/components/ui/modal-store";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function wrapperFor(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
    );
  };
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0 });
});

it("includes the toolbar settings shortcut on a book route", () => {
  const { result } = renderHook(() => useActiveShortcuts(), {
    wrapper: wrapperFor("/book/abc"),
  });

  expect(
    result.current.some((item) => item.id === "editor.toolbarSettings"),
  ).toBe(true);
});

it("excludes the toolbar settings shortcut on a non-book route", () => {
  const { result } = renderHook(() => useActiveShortcuts(), {
    wrapper: wrapperFor("/settings"),
  });

  expect(
    result.current.some((item) => item.id === "editor.toolbarSettings"),
  ).toBe(false);
});

it("includes the localized Ephemeral shortcut between Canvas and Metrics", () => {
  const { result } = renderHook(() => useActiveShortcuts(), {
    wrapper: wrapperFor("/settings"),
  });

  const ids = result.current.map((item) => item.id);
  const canvasIndex = ids.indexOf("global.gotoCanvas");
  const ephemeralIndex = ids.indexOf("global.gotoEphemeral");
  const metricsIndex = ids.indexOf("global.gotoMetrics");
  const ephemeral = result.current[ephemeralIndex];

  expect(ephemeralIndex).toBe(canvasIndex + 1);
  expect(metricsIndex).toBe(ephemeralIndex + 1);
  expect(ephemeral).toMatchObject({
    id: "global.gotoEphemeral",
    label: "shortcuts.gotoEphemeral",
    formatted: { groups: [["G"], ["E"]], isSequence: true },
  });
});

it("returns empty list while any modal is open", () => {
  useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

  const { result } = renderHook(() => useActiveShortcuts(), {
    wrapper: wrapperFor("/book/abc"),
  });

  expect(result.current).toEqual([]);
});

it("returns shortcuts again after all modals close", () => {
  useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

  const { result, rerender } = renderHook(() => useActiveShortcuts(), {
    wrapper: wrapperFor("/book/abc"),
  });

  expect(result.current).toEqual([]);

  act(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });
  rerender();

  expect(result.current.length).toBeGreaterThan(0);
  expect(
    result.current.some((item) => item.id === "editor.toolbarSettings"),
  ).toBe(true);
});
