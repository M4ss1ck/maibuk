import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODEL_CATALOG } from "@/features/dictation/catalog";
import "@/i18n";

const install = vi.fn(async () => {});
const remove = vi.fn(async () => {});
const cancelInstall = vi.fn();
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({
    install,
    remove,
    cancelInstall,
    stats: { summary: () => ({ lines: 3, medianLatencyMs: 120 }) },
    host: { inputDevice: async () => "USB Mic" },
  }),
}));
vi.mock("@/lib/platform", async (orig) => ({
  ...(await orig<object>()),
  dictationPlatform: () => "web",
}));
const { useDictationStore } = await import("@/features/dictation/store");
const { DictationSection } = await import(
  "@/components/settings/DictationSection"
);

const esFast = MODEL_CATALOG.find(
  (m) => m.languages[0] === "es" && m.tier === "fast",
)!;

beforeEach(() => {
  install.mockClear();
  remove.mockClear();
  useDictationStore.setState({
    support: { supported: true },
    installed: [],
    downloads: {},
    preferredTier: { en: "fast", es: "fast" },
  });
});

describe("DictationSection", () => {
  it("explains when dictation is unsupported", () => {
    useDictationStore.setState({
      support: { supported: false, reason: "not_isolated" },
    });
    render(<DictationSection />);
    expect(screen.getByText(/works in Maibuk for Linux/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  });

  it("claims nothing while the runtime is still reporting support", () => {
    useDictationStore.setState({ support: null });
    const { container } = render(<DictationSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("downloads a model by keyboard", async () => {
    const user = userEvent.setup();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /download/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(install).toHaveBeenCalledWith(esFast);
  });

  it("shows progress and cancels", async () => {
    useDictationStore.setState({
      downloads: { [esFast.id]: { done: 10_000_000, total: 32_316_573 } },
    });
    const user = userEvent.setup();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    expect(within(row).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "31",
    );
    within(row)
      .getByRole("button", { name: /cancel/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(cancelInstall).toHaveBeenCalledWith(esFast.id);
  });

  it("removes an installed model by keyboard", async () => {
    useDictationStore.setState({ installed: [esFast.id] });
    const user = userEvent.setup();
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    within(row)
      .getByRole("button", { name: /remove/i })
      .focus();
    await user.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledWith(esFast.id);
  });

  it("names the microphone when the backend can", async () => {
    render(<DictationSection />);
    expect(await screen.findByText("Microphone: USB Mic")).toBeInTheDocument();
  });

  it("says Spanish models add no punctuation", () => {
    render(<DictationSection />);
    const row = screen.getByRole("group", { name: /Spanish.*Fast/i });
    expect(within(row).getByText(/no punctuation/i)).toBeInTheDocument();
  });
});
