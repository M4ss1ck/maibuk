import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PluginPage } from "@/pages/PluginPage";

vi.mock("@/hooks/usePluginSurface", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePluginSurface")>();
  return {
    ...mod,
    useInstalledPluginLifecycle: () => null,
    usePluginLifecycleRevision: () => 0,
    usePluginSurface: () => undefined,
  };
});

describe("PluginPage while the lifecycle is still launching", () => {
  it("shows a loading state, not 'not installed'", () => {
    render(
      <MemoryRouter initialEntries={["/plugin/sample/report"]}>
        <Routes>
          <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading").textContent).not.toMatch(/not installed|no está instalado/i);
    expect(screen.getByText(/loading|Cargando/i)).toBeInTheDocument();
  });
});
