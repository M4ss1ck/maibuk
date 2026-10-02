import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsSectionId } from "@/components/settings/SettingsSection";
import type { OutlineSelection } from "@/features/settings/outline";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { SettingsOutline } = await import("@/components/settings/SettingsOutline");

const ROW_HEIGHT = 20;
const present: SettingsSectionId[] = ["appearance", "general", "editor"];

interface Call {
  key: string | null;
  ghost: boolean;
  keyframes: Keyframe[];
}
let calls: Call[];
let reducedMotion: boolean;

// jsdom has no layout: an entry's top is its place in the tree, and an
// animation is a record of what was asked for.
beforeEach(() => {
  calls = [];
  reducedMotion = false;
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      const rows = [...document.querySelectorAll('[role="row"][data-key]')];
      const index = rows.indexOf(this);
      return index < 0 ? 0 : index * ROW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => ROW_HEIGHT,
  });
  HTMLElement.prototype.animate = function (this: HTMLElement, keyframes: Keyframe[]) {
    calls.push({
      key: this.dataset.key ?? null,
      ghost: this.closest("[aria-hidden]") !== null,
      keyframes,
    });
    return { cancel() {}, onfinish: null } as unknown as Animation;
  } as HTMLElement["animate"];
  HTMLElement.prototype.getAnimations = () => [];
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("reduce") && reducedMotion,
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  delete (HTMLElement.prototype as Partial<HTMLElement>).getAnimations;
});

const select = (section: string): OutlineSelection => ({ section, row: null });
const marker = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-outline-marker]")!;
const translateOf = (call: Call | undefined) => call?.keyframes[0].transform;

function renderOutline(section: string) {
  const onJump = vi.fn();
  const view = render(
    <SettingsOutline present={present} selection={select(section)} onJump={onJump} />
  );
  return {
    ...view,
    moveTo: (next: string) =>
      view.rerender(<SettingsOutline present={present} selection={select(next)} onJump={onJump} />),
  };
}

describe("Settings outline motion", () => {
  it("the first render places the marker without animating anything", () => {
    const { container } = renderOutline("appearance");
    expect(calls).toEqual([]);
    expect(marker(container).style.transform).toBe("translateY(0px)");
    expect(marker(container).style.opacity).toBe("1");
  });

  it("a new current section slides the kept entries, fades its rows in, and fades the old rows out", async () => {
    const { container, moveTo } = renderOutline("appearance");
    const appearanceRows = screen.getAllByRole("row").length - present.length;
    expect(appearanceRows).toBeGreaterThan(0);

    await act(async () => moveTo("general"));

    // General moved up past the Appearance rows that closed.
    const general = calls.find((call) => call.key === "section:general");
    expect(translateOf(general)).toBe(`translateY(${appearanceRows * ROW_HEIGHT}px)`);
    // General's rows are new: they fade in where they land.
    const entering = calls.filter((call) => call.key?.startsWith("row:general:"));
    expect(entering.length).toBeGreaterThan(0);
    expect(entering.every((call) => call.keyframes[0].opacity === 0)).toBe(true);
    // Each closed Appearance row leaves a hidden ghost that fades out.
    const ghosts = calls.filter((call) => call.ghost);
    expect(ghosts).toHaveLength(appearanceRows);
    expect(ghosts.every((call) => call.keyframes.at(-1)?.opacity === 0)).toBe(true);
    // The marker slides to General's new place.
    expect(marker(container).style.transform).toBe(`translateY(${ROW_HEIGHT}px)`);
  });

  it("ghosts stay out of the accessibility tree", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    const names = screen.getAllByRole("row").map((row) => row.getAttribute("data-key"));
    expect(names.some((key) => key?.startsWith("row:appearance:"))).toBe(false);
    expect(names.every((key) => key !== null)).toBe(true);
  });

  it("reduced motion changes the outline without animating it", async () => {
    reducedMotion = true;
    const { container, moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    expect(calls).toEqual([]);
    expect(marker(container).style.transform).toBe(`translateY(${ROW_HEIGHT}px)`);
  });

  it("search results replace the entries without motion", async () => {
    const user = userEvent.setup();
    renderOutline("appearance");
    await user.type(screen.getByRole("searchbox"), "a");
    expect(calls).toEqual([]);
  });

  it("opening another section from the keyboard animates its rows in", async () => {
    const user = userEvent.setup();
    renderOutline("appearance");
    await user.tab();
    await user.tab();
    const general = screen.getByRole("row", { name: "settings.general" });
    while (document.activeElement !== general) await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    expect(calls.some((call) => call.key?.startsWith("row:general:"))).toBe(true);
  });

  // React Aria's Tree commits rows in renders of its own, after the outline's
  // layout effect; without watching the DOM they would paint before fading.
  it("rows the tree adds outside an outline render still fade in", async () => {
    renderOutline("appearance");
    const tree = screen.getByRole("treegrid");
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    row.dataset.key = "row:appearance:late";
    await act(async () => {
      tree.append(row);
      await Promise.resolve();
    });
    const call = calls.find((entry) => entry.key === "row:appearance:late");
    expect(call?.keyframes[0].opacity).toBe(0);
    row.remove();
  });

  it("glides the outline to keep a current entry below its fold in view", async () => {
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => ROW_HEIGHT * 2,
    });
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as HTMLElement["scrollTo"];
    try {
      const { moveTo } = renderOutline("appearance");
      scrollTo.mockClear();
      await act(async () => moveTo("editor"));
      const editorTop = screen
        .getAllByRole("row")
        .findIndex((row) => row.getAttribute("data-key") === "section:editor");
      expect(scrollTo).toHaveBeenCalledWith({
        top: (editorTop + 1) * ROW_HEIGHT - ROW_HEIGHT * 2 + 8,
        behavior: "smooth",
      });
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
  });
});
