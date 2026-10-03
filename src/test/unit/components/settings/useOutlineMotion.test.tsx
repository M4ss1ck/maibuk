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
const present: SettingsSectionId[] = ["appearance", "general", "about"];

interface Call {
  key: string | null;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: FakeAnimation;
}

/** A controllable Web Animations stand-in: `finished` resolves on `finish()`. */
class FakeAnimation {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  private resolve!: () => void;
  readonly finished: Promise<void> = new Promise((resolve) => {
    this.resolve = resolve;
  });
  cancelled = false;

  cancel() {
    this.cancelled = true;
    if (this.oncancel) this.oncancel();
  }

  finish() {
    if (this.onfinish) this.onfinish();
    this.resolve();
  }
}
let calls: Call[];
let reducedMotion: boolean;

/** Runs the animations a change started to their end, as the browser would. */
function finishAnimations(match: (call: Call) => boolean) {
  const finished = calls.filter(match);
  for (const call of finished) call.animation.finish();
  return finished;
}

// jsdom has no layout: an entry spans ROW_HEIGHT px, and an animation is a
// record of what was asked for.
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
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ) {
    const animation = new FakeAnimation();
    calls.push({ key: this.dataset.key ?? null, keyframes, options, animation });
    return animation as unknown as Animation;
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
const rowsOf = (section: string) =>
  screen.queryAllByRole("row").filter((row) => row.dataset.key?.startsWith(`row:${section}:`));
const rowKeysOf = (section: string) => rowsOf(section).map((row) => row.dataset.key);
const collapseCalls = () => calls.filter((call) => call.options.duration === 90);
const expandCalls = () => calls.filter((call) => call.options.duration === 130);
const rowExpands = (section: string) =>
  expandCalls().filter((call) => call.key?.startsWith(`row:${section}:`));

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

  it("A to B collapses A's rows, and only once they finish does B expand", async () => {
    const { moveTo } = renderOutline("appearance");
    const aRows = rowKeysOf("appearance");
    expect(aRows.length).toBeGreaterThan(0);

    await act(async () => moveTo("general"));

    // Appearance's rows collapse to nothing; General's do not exist yet.
    const collapsing = collapseCalls();
    expect(collapsing.map((call) => call.key)).toEqual(aRows);
    expect(collapsing[0].keyframes[0].height).toBe(`${ROW_HEIGHT}px`);
    expect(collapsing.at(-1)!.keyframes.at(-1)?.height).toBe("0px");
    expect(collapsing.every((call) => call.keyframes[0].opacity === 1)).toBe(true);
    expect(collapsing.every((call) => call.keyframes.at(-1)?.opacity === 0)).toBe(true);
    expect(rowsOf("general")).toEqual([]);
    expect(rowExpands("general")).toEqual([]);

    // The collapse finishes: React swaps the rows and General's grow in.
    await act(async () => finishAnimations((call) => call.options.duration === 90));

    expect(rowKeysOf("appearance")).toEqual([]);
    const bRows = rowKeysOf("general");
    expect(bRows.length).toBeGreaterThan(0);
    // Exactly one grow per General row, and the phase's own rows only.
    const expanding = rowExpands("general");
    expect(expanding.map((call) => call.key)).toEqual(bRows);
    expect(expanding[0].keyframes[0].height).toBe("0px");
    expect(expanding.at(-1)!.keyframes.at(-1)?.height).toBe(`${ROW_HEIGHT}px`);
    expect(expanding.every((call) => call.keyframes[0].opacity === 0)).toBe(true);
    expect(expanding.every((call) => call.keyframes.at(-1)?.opacity === 1)).toBe(true);
  });

  it("a change while A collapses cancels it, shows C at once, and never shows B", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));

    const collapsing = collapseCalls();
    expect(collapsing.length).toBeGreaterThan(0);

    const beforeInterrupt = calls.length;
    await act(async () => moveTo("about"));

    // Every collapse was cancelled, C's rows render in place, and B never did.
    expect(collapsing.every((call) => call.animation.cancelled)).toBe(true);
    expect(rowsOf("general")).toEqual([]);
    const cRows = rowKeysOf("about");
    expect(cRows.length).toBeGreaterThan(0);
    // Nothing animated C's rows in: the snap renders them at full size.
    const after = calls.slice(beforeInterrupt);
    for (const key of cRows) {
      expect(after.filter((call) => call.key === key).length).toBe(0);
    }

    // A late finish from the cancelled collapse changes nothing.
    const settled = calls.length;
    await act(async () => finishAnimations(() => true));
    expect(calls.length).toBe(settled);
  });

  it("a change while B expands cancels it and shows C with no animation", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    await act(async () => finishAnimations((call) => call.options.duration === 90));

    const expanding = rowExpands("general");
    expect(expanding.length).toBeGreaterThan(0);

    const beforeInterrupt = calls.length;
    await act(async () => moveTo("about"));

    expect(expanding.every((call) => call.animation.cancelled)).toBe(true);
    const cRows = rowKeysOf("about");
    expect(cRows.length).toBeGreaterThan(0);
    expect(rowsOf("general")).toEqual([]);
    // Nothing animated C's rows: the snap renders them where they land.
    const after = calls.slice(beforeInterrupt);
    for (const key of cRows) {
      expect(after.filter((call) => call.key === key).length).toBe(0);
    }
  });

  it("reduced motion changes the outline without animating it", async () => {
    reducedMotion = true;
    const { container, moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    expect(calls).toEqual([]);
    expect(rowsOf("general").length).toBeGreaterThan(0);
    expect(rowsOf("appearance")).toEqual([]);
    // The marker sits beside General's header, where it belongs.
    expect(marker(container).style.transform).toBe(`translateY(${ROW_HEIGHT}px)`);
  });

  it("search results replace the entries without motion", async () => {
    const user = userEvent.setup();
    renderOutline("appearance");
    await user.type(screen.getByRole("searchbox"), "a");
    // Let the search's own frame pass: it must not have started anything.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
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
  // layout effect; without watching the DOM they would paint before growing.
  it("rows the tree adds outside an outline render animate in", async () => {
    renderOutline("appearance");
    const tree = screen.getByRole("treegrid");
    const row = document.createElement("div");
    row.setAttribute("role", "row");
    // General is not the shown section, so no transition owns this row.
    row.dataset.key = "row:general:late";
    await act(async () => {
      tree.append(row);
      await Promise.resolve();
    });
    const call = calls.find((entry) => entry.key === "row:general:late");
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
      await act(async () => moveTo("about"));
      const aboutTop = screen
        .getAllByRole("row")
        .findIndex((row) => row.getAttribute("data-key") === "section:about");
      const bottom = (aboutTop + 1) * ROW_HEIGHT;
      expect(scrollTo).toHaveBeenCalledWith({
        top: bottom - ROW_HEIGHT * 2 + 8,
        behavior: "smooth",
      });
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTo;
    }
  });
});


