import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { FullPageScreen } from "@/components/FullPageScreen";

describe("FullPageScreen", () => {
  it("reserves every device safe-area inset around the routed page", () => {
    render(
      <MemoryRouter initialEntries={["/book/1"]}>
        <Routes>
          <Route element={<FullPageScreen />}>
            <Route path="book/:bookId" element={<div>editor</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId("full-page-screen")).toHaveClass(
      "pt-[env(safe-area-inset-top)]",
      "pb-[env(safe-area-inset-bottom)]",
      "pl-[env(safe-area-inset-left)]",
      "pr-[env(safe-area-inset-right)]"
    );
    expect(screen.getByText("editor")).toBeInTheDocument();
  });
});

// The bottom bars of the full-page editors are only tappable on Android if the
// pages size themselves against FullPageScreen's padded box. A page root using
// h-dvh is viewport-tall and pushes its own bottom bar back under the
// navigation bar, so guard against the class reappearing.
describe("full-page editor roots", () => {
  const pages = [
    "src/pages/BookEditor.tsx",
    "src/pages/Notes.tsx",
    "src/pages/Canvas.tsx",
    "src/pages/CoverDesigner.tsx",
    "src/pages/Ephemeral.tsx",
  ];

  it.each(pages)("%s sizes against its layout wrapper, not the viewport", (page) => {
    expect(readFileSync(page, "utf8")).not.toContain("h-dvh");
  });
});

describe("Layout main content", () => {
  it("reserves the bottom safe-area inset for pages rendered in the sidebar shell", () => {
    const source = readFileSync("src/components/Layout.tsx", "utf8");
    expect(source).toContain("pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]");
  });
});
