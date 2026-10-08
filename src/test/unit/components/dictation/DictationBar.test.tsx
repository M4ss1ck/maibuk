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
const { DictationBar, DictationBarPreview } = await import("@/components/dictation/DictationBar");
const { DictationLiveRegion } = await import("@/components/dictation/DictationLiveRegion");

const esFast = MODEL_CATALOG.find((m) => m.languages[0] === "es" && m.tier === "fast")!.id;
const enFast = MODEL_CATALOG.find((m) => m.languages[0] === "en" && m.tier === "fast")!.id;

const listeningSnapshot = {
  status: "listening" as const,
  language: "en" as const,
  modelId: enFast,
  level: 0.2,
  hasTarget: true,
  recording: false,
};

function renderControl() {
  // The live region lives in the app shell beside the control.
  return render(
    <MemoryRouter initialEntries={["/book/b1"]}>
      <Routes>
        <Route
          path="/book/:bookId"
          element={
            <>
              <DictationBar />
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
    barSize: "full",
    barCollapsed: false,
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

describe("DictationBar", () => {
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

    const widthClass = picker.closest("[data-bar-part]")?.className ?? "";
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
    expect(auto.closest("[data-bar-part]")?.className).toBe(widthClass);
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

describe("DictationBar collapse", () => {
  it("collapses to the microphone by keyboard and expands back", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    const collapse = screen.getByRole("button", { name: "Collapse dictation bar" });
    expect(collapse).toHaveFocus();
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: /dictation language/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dictation settings" })).toBeNull();
    expect(screen.getByRole("button", { name: /start dictation/i })).toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "Expand dictation bar" });
    // The same button stays focused, so Enter again undoes it.
    expect(expand).toHaveFocus();
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(useDictationStore.getState().barCollapsed).toBe(true);

    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: /dictation language/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collapse dictation bar" })).toHaveFocus();
  });

  it("keeps the microphone working while collapsed", async () => {
    useDictationStore.setState({ barCollapsed: true });
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveBeenCalledTimes(1);
    await user.tab();
    expect(screen.getByRole("button", { name: "Expand dictation bar" })).toHaveFocus();
  });

  it("collapses a Compact bar the same way and keeps it Compact", async () => {
    useDictationStore.setState({ barSize: "compact" });
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(useDictationStore.getState()).toMatchObject({ barSize: "compact", barCollapsed: true });
    expect(screen.queryByRole("button", { name: /dictation language/i })).toBeNull();
  });
});

describe("DictationBar sizes", () => {
  it("Compact keeps every control, with the language as a narrow chip", async () => {
    useDictationStore.setState({ barSize: "compact" });
    const user = userEvent.setup();
    renderControl();
    await user.tab();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveFocus();
    await user.tab();
    const picker = screen.getByRole("button", { name: /dictation language/i });
    expect(picker).toHaveFocus();
    expect(picker).toHaveTextContent("auto");
    await user.keyboard("{Enter}{ArrowDown}{Enter}");
    await waitFor(() => expect(setLanguage).toHaveBeenLastCalledWith("en"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /dictation language/i })).toHaveFocus()
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Dictation settings" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Collapse dictation bar" })).toHaveFocus();
  });

  it("Compact takes less room than Full", () => {
    useDictationStore.setState({ barSize: "compact" });
    const { unmount } = renderControl();
    const compactMic = screen.getByRole("button", { name: /start dictation/i });
    expect(compactMic).toHaveClass("h-8", "w-8", "pointer-coarse:h-12", "pointer-coarse:w-12");
    unmount();

    useDictationStore.setState({ barSize: "full" });
    renderControl();
    expect(screen.getByRole("button", { name: /start dictation/i })).toHaveClass("h-10", "w-10");
  });

  it("Hidden shows nothing while idle", () => {
    useDictationStore.setState({ barSize: "hidden" });
    renderControl();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("Hidden shows only a microphone while listening, which stops the Session", async () => {
    useDictationStore.setState({ barSize: "hidden", snapshot: listeningSnapshot });
    const user = userEvent.setup();
    renderControl();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.tab();
    const mic = screen.getByRole("button", { name: /stop dictation/i });
    expect(mic).toHaveFocus();
    expect(mic).toHaveClass("h-8", "w-8");
    await user.keyboard("{Enter}");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("Hidden ignores a collapse left from another size", () => {
    useDictationStore.setState({
      barSize: "hidden",
      barCollapsed: true,
      snapshot: listeningSnapshot,
    });
    renderControl();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("DictationBarPreview", () => {
  it.each(["compact", "full"] as const)(
    "draws the %s bar with the live bar's parts but takes no focus and no name",
    async (size) => {
      useDictationStore.setState({ barSize: size });
      const live = renderControl();
      const liveParts = [...live.container.querySelectorAll("[data-bar-part]")].map((el) => [
        el.getAttribute("data-bar-part"),
        el.className,
      ]);
      live.unmount();

      const user = userEvent.setup();
      const { container } = render(
        <>
          <button type="button">before</button>
          <DictationBarPreview size={size} />
          <button type="button">after</button>
        </>
      );
      const preview = container.querySelector("[data-dictation-bar-preview]")!;
      expect(preview).toHaveAttribute("aria-hidden", "true");
      expect(preview).not.toHaveClass("fixed");
      // Same parts, same classes: the preview is the bar's real size.
      const previewParts = [...preview.querySelectorAll("[data-bar-part]")].map((el) => [
        el.getAttribute("data-bar-part"),
        el.className,
      ]);
      expect(previewParts).toEqual(liveParts);
      expect(preview.querySelector("button, [tabindex]")).toBeNull();

      await user.tab();
      await user.tab();
      expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    }
  );
});
