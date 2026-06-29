import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../components/editor/Editor", () => ({
  Editor: () => <div data-testid="editor" />,
}));

import { Embed } from "@/pages/Embed";

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Embed />
    </MemoryRouter>
  );
}

describe("Embed theme param", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  it("applies dark class when theme=dark", () => {
    renderAt("/embed?theme=dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when theme=light", () => {
    document.documentElement.classList.add("dark");
    renderAt("/embed?theme=light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to system (no dark in jsdom) when param is missing", () => {
    renderAt("/embed");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("falls back to system when param is unknown", () => {
    renderAt("/embed?theme=banana");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
