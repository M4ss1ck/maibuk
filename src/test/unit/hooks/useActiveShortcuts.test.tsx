import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";

import { useActiveShortcuts } from "@/hooks/useActiveShortcuts";

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
