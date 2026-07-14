import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import fs from "node:fs";
import path from "node:path";

const { i18nState } = vi.hoisted(() => ({ i18nState: { language: "en" } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const m: Record<string, string> = {
      "books.title": "My Books", "notes.title": "Notes", "canvas.title": "Canvas",
      "metrics.title": "Metrics", "settings.title": "Settings", "cover.title": "Cover Designer",
    };
    return { t: (k: string) => m[k] ?? k, i18n: { language: i18nState.language, resolvedLanguage: i18nState.language } };
  },
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { RouteAnnouncer } from "@/components/RouteAnnouncer";

function getRegion() {
  const regions = screen.getAllByRole("status");
  return regions.find((el) => el.hasAttribute("aria-live"))!;
}

// ── behavioral tests ────────────────────────────────────────────────

describe("RouteAnnouncer", () => {
  beforeEach(() => { i18nState.language = "en"; });

  it("renders a polite atomic live region", () => {
    render(<MemoryRouter><RouteAnnouncer /></MemoryRouter>);
    expect(getRegion()).toHaveAttribute("aria-live", "polite");
    expect(getRegion()).toHaveAttribute("aria-atomic", "true");
  });

  it("announces initial heading from data-route-heading", async () => {
    render(
      <MemoryRouter>
        <RouteAnnouncer />
        <Routes>
          <Route path="/" element={<h1 data-route-heading>My Books</h1>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getRegion().textContent).toBe("My Books"));
  });

  it("announces after Link click navigation", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteAnnouncer />
        <Link to="/settings">Go</Link>
        <Routes>
          <Route path="/" element={<h1 data-route-heading>My Books</h1>} />
          <Route path="/settings" element={<h1 data-route-heading>Settings</h1>} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(getRegion().textContent).toBe("My Books"));
    await user.click(screen.getByText("Go"));
    await waitFor(() => expect(getRegion().textContent).toBe("Settings"));
  });

  it("announces after programmatic useNavigate", async () => {
    const user = userEvent.setup();

    function Nav() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/metrics")}>Nav</button>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteAnnouncer />
        <Nav />
        <Routes>
          <Route path="/" element={<h1 data-route-heading>My Books</h1>} />
          <Route path="/metrics" element={<h1 data-route-heading>Metrics</h1>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(getRegion().textContent).toBe("My Books"));
    await user.click(screen.getByText("Nav"));
    await waitFor(() => expect(getRegion().textContent).toBe("Metrics"));
  });

  it("preserves focus on a focused button across route transition", async () => {
    const user = userEvent.setup();

    function Nav() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/settings")}>Nav</button>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteAnnouncer />
        <Nav />
        <Routes>
          <Route path="/" element={<h1 data-route-heading>My Books</h1>} />
          <Route path="/settings" element={<h1 data-route-heading>Settings</h1>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(getRegion().textContent).toBe("My Books"));

    const btn = screen.getByText("Nav");
    btn.focus();
    expect(btn).toHaveFocus();

    await user.click(btn);
    await waitFor(() => expect(getRegion().textContent).toBe("Settings"));
    expect(btn).toHaveFocus();
  });

  it("waits for async heading via MutationObserver then announces without moving focus", async () => {
    const user = userEvent.setup();

    function LateHeading({ heading }: { heading: string }) {
      const [show, setShow] = useState(false);
      useEffect(() => {
        const id = setTimeout(() => setShow(true), 60);
        return () => clearTimeout(id);
      }, [heading]);
      return show ? <h1 data-route-heading>{heading}</h1> : null;
    }

    function Nav() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate("/late")}>Go</button>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteAnnouncer />
        <Nav />
        <Routes>
          <Route path="/" element={<h1 data-route-heading>My Books</h1>} />
          <Route path="/late" element={<LateHeading heading="Late Heading" />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(getRegion().textContent).toBe("My Books"));

    const btn = screen.getByText("Go");
    btn.focus();
    expect(btn).toHaveFocus();

    await user.click(btn);

    await waitFor(() => expect(getRegion().textContent).toBe("Late Heading"));
    expect(btn).toHaveFocus();
  });
});

// ── production source structural contract tests ─────────────────────
// Read actual *.tsx files and assert heading/landmark patterns.
// These fail if a developer removes the required markers from production code.

const SRC = path.resolve(__dirname, "../../");

function source(...segments: string[]) {
  return fs.readFileSync(path.join(SRC, ...segments), "utf-8");
}
function assertH1Route(s: string) { expect(s).toMatch(/<h1\b[^>]*data-route-heading/); }
function assertNoMain(s: string) { expect(s).not.toMatch(/<main\b/); }
function assertHasMain(s: string) { expect(s).toMatch(/<main\b/); }

describe("Production source structural contracts", () => {
  it("Layout routes: Settings.tsx has h1 data-route-heading, no main", () => {
    const s = source("pages", "Settings.tsx");
    assertH1Route(s);
    assertNoMain(s);
  });
  it("Layout routes: NotesGallery.tsx has h1 data-route-heading, no main", () => {
    const s = source("pages", "NotesGallery.tsx");
    assertH1Route(s);
    assertNoMain(s);
  });
  it("Layout routes: CanvasGallery.tsx has h1 data-route-heading, no main", () => {
    const s = source("pages", "CanvasGallery.tsx");
    assertH1Route(s);
    assertNoMain(s);
  });
  it("Layout routes: Metrics.tsx has h1 data-route-heading, no main", () => {
    const s = source("pages", "Metrics.tsx");
    assertH1Route(s);
    assertNoMain(s);
  });
  it("Full-page: Canvas.tsx has h1 data-route-heading and its own main", () => {
    const s = source("pages", "Canvas.tsx");
    assertH1Route(s);
    assertHasMain(s);
  });
  it("Full-page: CoverDesigner.tsx has h1 data-route-heading and its own main", () => {
    const s = source("pages", "CoverDesigner.tsx");
    assertH1Route(s);
    assertHasMain(s);
  });
  it("Full-page: Notes and NoteEditor own one main and the route heading", () => {
    assertHasMain(source("pages", "Notes.tsx"));
    assertH1Route(source("components", "notes", "NoteEditor.tsx"));
  });
  it("Full-page: BookEditor.tsx has a route heading marker and its own main", () => {
    const s = source("pages", "BookEditor.tsx");
    expect(s).toMatch(/data-route-heading/);
    assertHasMain(s);
  });
  it("Layout.tsx has main but brand text is not inside h1", () => {
    const s = source("components", "Layout.tsx");
    assertHasMain(s);
    expect(s).not.toMatch(/<h1\b[^>]*>\s*\{t\("app\.title"\)\}/);
  });
});
