import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasteCleanupSection } from "@/components/settings/PasteCleanupSection";
import { useSettingsStore } from "@/features/settings/store";
import { PASTE_CLEANUP_PRESETS } from "@/features/settings/types";

vi.mock("../../../../i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

function seedRule() {
  useSettingsStore.setState({
    pasteCleanup: {
      preset: "custom",
      options: { ...PASTE_CLEANUP_PRESETS.keepAll },
      rules: [
        {
          id: "rule-1",
          enabled: true,
          label: "",
          target: "cssClass",
          value: "MsoNormal",
          action: "removeStyle",
        },
      ],
    },
  });
}

describe("PasteCleanupSection — open from HTML view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement scrollIntoView (used to reveal the focused rule).
    Element.prototype.scrollIntoView = vi.fn();
    seedRule();
  });

  it("opens the rules editor and focuses the targeted rule's value when navigated with state", async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/settings",
            state: { openPasteCleanupRules: true, focusPasteRuleId: "rule-1" },
          },
        ]}
      >
        <PasteCleanupSection />
      </MemoryRouter>
    );

    const valueInput = await waitFor(() => screen.getByDisplayValue("MsoNormal"));
    expect(valueInput).toBeInTheDocument();
    expect(valueInput.tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(valueInput);
  });

  it("keeps focus in the name field while typing after opening", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/settings",
            state: { openPasteCleanupRules: true, focusPasteRuleId: "rule-1" },
          },
        ]}
      >
        <PasteCleanupSection />
      </MemoryRouter>
    );

    await waitFor(() => screen.getByDisplayValue("MsoNormal"));
    const nameInput = screen.getByLabelText("settings.pasteCleanup.rules.label");
    await user.click(nameInput);
    await user.keyboard("Hi");

    expect(document.activeElement).toBe(nameInput);
    expect(nameInput).toHaveValue("Hi");
  });

  it("navigates back to the editor when opened from the HTML source view", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/settings",
            state: {
              openPasteCleanupRules: true,
              focusPasteRuleId: "rule-1",
              returnToEditorPath: "/book/book-1",
            },
          },
        ]}
      >
        <Routes>
          <Route path="/settings" element={<PasteCleanupSection />} />
          <Route path="/book/:bookId" element={<p>Book editor</p>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => screen.getByDisplayValue("MsoNormal"));
    await user.click(screen.getByText("settings.pasteCleanup.rules.backToEditor"));

    expect(screen.getByText("Book editor")).toBeInTheDocument();
  });

  it("does not open the rules editor without navigation state", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PasteCleanupSection />
      </MemoryRouter>
    );

    expect(screen.queryByDisplayValue("MsoNormal")).not.toBeInTheDocument();
  });

  it("uses container variants for its preset and markdown rows", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PasteCleanupSection />
      </MemoryRouter>
    );

    const presetRow = screen.getByText("settings.pasteCleanup.preset.label").closest(".py-2");
    expect(presetRow).not.toBeNull();
    expect(presetRow).toHaveClass("flex-col", "@lg:flex-row", "@lg:items-center");
    expect(presetRow).not.toHaveClass("sm:flex-row");

    const promptRow = screen.getByRole("switch").closest(".py-2");
    expect(promptRow).not.toBeNull();
    expect(promptRow).toHaveClass("flex-col", "@lg:flex-row");
    expect(promptRow).not.toHaveClass("sm:flex-row");
  });

  it("uses a container variant for the strip properties grid", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <PasteCleanupSection />
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: "settings.pasteCleanup.advanced" }));

    // The property text renders twice per row: the visible label and the
    // switch's sr-only label. Both live in the same row, so either resolves
    // to the same grid.
    const grid = screen
      .getAllByText("settings.pasteCleanup.property.background-color")[0]
      .closest(".grid");
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass("grid-cols-1", "@lg:grid-cols-2");
    expect(grid).not.toHaveClass("sm:grid-cols-2");
  });
});
