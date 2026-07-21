import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Ephemeral } from "@/pages/Ephemeral";
import { useEphemeralStore } from "@/features/ephemeral";

const { mockNavigate, mockCreateNote, mockSetAlwaysOnTop, platformState } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockCreateNote: vi.fn(),
  mockSetAlwaysOnTop: vi.fn(),
  platformState: { isDesktop: false },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("@/features/notes", () => ({
  useNoteStore: { getState: () => ({ createNote: mockCreateNote }) },
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (
    selector: (s: { alwaysOnTop: boolean; setAlwaysOnTop: (v: boolean) => void }) => unknown
  ) => selector({ alwaysOnTop: false, setAlwaysOnTop: mockSetAlwaysOnTop }),
}));

vi.mock("@/lib/platform", () => ({
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  IS_TAURI: true,
  isMac: () => false,
}));

// Stub the heavy TipTap editor with a textarea that mirrors its callbacks.
vi.mock("@/components/editor", () => ({
  Editor: ({
    onUpdate,
    onWordCountChange,
    placeholder,
  }: {
    onUpdate: (html: string) => void;
    onWordCountChange: (n: number) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label="editor"
      placeholder={placeholder}
      onChange={(e) => {
        const value = e.target.value;
        onUpdate(`<p>${value}</p>`);
        onWordCountChange(value.trim() ? value.trim().split(/\s+/).length : 0);
      }}
    />
  ),
}));

describe("Ephemeral page", () => {
  beforeEach(() => {
    useEphemeralStore.getState().reset();
    mockNavigate.mockReset();
    mockCreateNote.mockReset();
    mockSetAlwaysOnTop.mockReset();
    platformState.isDesktop = false;
  });

  it("disables Clear and Create note when empty", () => {
    render(<Ephemeral />);
    expect(screen.getByRole("button", { name: "ephemeral.clear" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ephemeral.createNote" })).toBeDisabled();
  });

  it("updates the word count as the user types", async () => {
    const user = userEvent.setup();
    render(<Ephemeral />);
    await user.type(screen.getByLabelText("editor"), "hello world");
    expect(screen.getByText("2 common.words")).toBeInTheDocument();
  });

  it("creates a note from the buffer and navigates to it", async () => {
    mockCreateNote.mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    render(<Ephemeral />);
    await user.type(screen.getByLabelText("editor"), "keep this");
    await user.click(screen.getByRole("button", { name: "ephemeral.createNote" }));
    expect(mockCreateNote).toHaveBeenCalledWith({ title: "", content: "<p>keep this</p>" });
    expect(mockNavigate).toHaveBeenCalledWith("/notes/note-1");
    expect(useEphemeralStore.getState().content).toBe("");
  });

  it("Clear resets the buffer", async () => {
    const user = userEvent.setup();
    render(<Ephemeral />);
    await user.type(screen.getByLabelText("editor"), "scratch");
    await user.click(screen.getByRole("button", { name: "ephemeral.clear" }));
    expect(useEphemeralStore.getState().content).toBe("");
    expect(useEphemeralStore.getState().wordCount).toBe(0);
  });

  it("focuses Clear by keyboard and activates it with Enter", async () => {
    useEphemeralStore.getState().setContent("<p>scratch</p>");
    useEphemeralStore.getState().setWordCount(1);
    const user = userEvent.setup();
    render(<Ephemeral />);

    const clearButton = screen.getByRole("button", { name: "ephemeral.clear" });
    await user.tab();
    expect(clearButton).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(useEphemeralStore.getState().content).toBe("");
    expect(useEphemeralStore.getState().wordCount).toBe(0);
  });

  it("focuses Create note by keyboard and activates it with Space", async () => {
    useEphemeralStore.getState().setContent("<p>keyboard note</p>");
    useEphemeralStore.getState().setWordCount(2);
    mockCreateNote.mockResolvedValue({ id: "note-2" });
    const user = userEvent.setup();
    render(<Ephemeral />);

    const clearButton = screen.getByRole("button", { name: "ephemeral.clear" });
    const createNoteButton = screen.getByRole("button", { name: "ephemeral.createNote" });
    await user.tab();
    expect(clearButton).toHaveFocus();
    await user.tab();
    expect(createNoteButton).toHaveFocus();
    await user.keyboard(" ");

    expect(mockCreateNote).toHaveBeenCalledWith({
      title: "",
      content: "<p>keyboard note</p>",
    });
    expect(mockNavigate).toHaveBeenCalledWith("/notes/note-2");
    expect(useEphemeralStore.getState().content).toBe("");
    expect(useEphemeralStore.getState().wordCount).toBe(0);
  });

  it("hides the always-on-top pin button on Android (non-desktop)", () => {
    platformState.isDesktop = false;
    render(<Ephemeral />);
    expect(
      screen.queryByRole("button", { name: "settings.alwaysOnTop" })
    ).not.toBeInTheDocument();
  });

  it("toggles always-on-top via keyboard on desktop", async () => {
    platformState.isDesktop = true;
    const user = userEvent.setup();
    render(<Ephemeral />);

    const pinButton = screen.getByRole("button", { name: "settings.alwaysOnTop" });
    pinButton.focus();
    await user.keyboard(" ");

    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
