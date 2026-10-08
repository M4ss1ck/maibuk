import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import "@/i18n";

const toggle = vi.fn(async () => {});
const setLanguage = vi.fn(async () => {});
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    session: { toggle, setLanguage, languageOverride: () => null },
  }),
}));
const { useDictationStore } = await import("@/features/dictation/store");
const { useSettingsRevealStore } = await import("@/features/settings/settings-reveal-store");
const { DictationControl } = await import("@/components/dictation/DictationControl");
const { DictationLiveRegion } = await import("@/components/dictation/DictationLiveRegion");

const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast")!.id;
const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast")!.id;

function renderControl() {
  // The live region lives in the app shell beside the control.
  return render(
    <MemoryRouter initialEntries={["/book/b1"]}>
      <Routes>
        <Route
          path="/book/:bookId"
          element={
            <>
              <DictationControl />
              <DictationLiveRegion />
            </>
          }
        />
        <Route path="/settings" element={<p>settings page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useSettingsRevealStore.getState().clearRow();
  toggle.mockClear();
  setLanguage.mockClear();
  useDictationStore.setState({
    enabled: true,
    support: { supported: true },
    installed: [esFast, enFast],
    announcement: "",
    languageOverride: null,
    snapshot: {
      status: "idle",
      language: null,
      modelId: null,
      level: 0,
      hasTarget: true,
      recording: false,
    },
  });
});

describe("DictationControl", () => {
  it("is not rendered where dictation is unsupported", () => {
    useDictationStore.setState({
      support: { supported: false, reason: "library_missing" },
    });
    renderControl();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("toggles dictation by keyboard", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("toggles dictation with Space on the focused mic button", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.keyboard(" ");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("shows the listening state as pressed with a Stop label", () => {
    useDictationStore.setState({
      snapshot: {
        status: "listening",
        language: "es",
        modelId: esFast,
        level: 0.2,
        hasTarget: true,
        recording: false,
      },
    });
    renderControl();
    expect(screen.getByRole("button", { name: /stop dictation/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("changes language with the arrow keys and restores focus to the picker", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(setLanguage).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(picker).toHaveFocus());
  });

  it("closes the language picker with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(setLanguage).not.toHaveBeenCalled();
    await waitFor(() => expect(picker).toHaveFocus());
  });

  it("with no model installed, the mic leads to Settings → Dictation", async () => {
    useDictationStore.setState({ installed: [] });
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /download a dictation model/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("settings page")).toBeInTheDocument();
    expect(useSettingsRevealStore.getState().pendingRowId).toBe("dictationEnabled");
    expect(toggle).not.toHaveBeenCalled();
  });

  it("the settings button opens Settings on the Dictation section", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("settings page")).toBeInTheDocument();
    // The row request waits for Settings to finish loading before it scrolls,
    // which a bare hash link did not.
    expect(useSettingsRevealStore.getState()).toMatchObject({
      pendingRowId: "dictationEnabled",
      pendingAlign: "section",
    });
  });

  it("announces through a polite live region", () => {
    useDictationStore.setState({ announcement: "Dictation on, Spanish" });
    renderControl();
    expect(screen.getByRole("status")).toHaveTextContent("Dictation on, Spanish");
  });

  it("cycles compact language codes by keyboard and keeps a fixed width", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    expect(picker).toHaveTextContent("auto");

    const widthClass = picker.parentElement?.className ?? "";
    expect(widthClass).toContain("w-20");
    // A comfortable touch target on coarse pointers.
    expect(picker).toHaveClass("w-full", "pointer-coarse:min-h-12");

    await user.keyboard("{Enter}{ArrowDown}{Enter}");
    await waitFor(() => expect(setLanguage).toHaveBeenLastCalledWith("en"));
    const english = screen.getByRole("button", { name: /dictation language/i });
    expect(english).toHaveTextContent("en");
    expect(english).toHaveAccessibleName(/English/);

    await user.keyboard("{Enter}{ArrowDown}{Enter}");
    await waitFor(() => expect(setLanguage).toHaveBeenLastCalledWith("es"));
    expect(screen.getByRole("button", { name: /dictation language/i })).toHaveTextContent("es");

    await user.keyboard("{Enter}{Home}{Enter}");
    await waitFor(() => expect(setLanguage).toHaveBeenLastCalledWith(null));
    const auto = screen.getByRole("button", { name: /dictation language/i });
    expect(auto).toHaveTextContent("auto");
    expect(auto.parentElement?.className).toBe(widthClass);
  });

  it("names the picker options in full while they show codes", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("option", { name: "Auto (Spell Check language)" })).toHaveTextContent(
      "auto"
    );
    expect(screen.getByRole("option", { name: "English" })).toHaveTextContent("en");
    expect(screen.getByRole("option", { name: "Spanish" })).toHaveTextContent("es");
  });

  it("renders nothing when Dictation is off", () => {
    useDictationStore.setState({ enabled: false });
    renderControl();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
