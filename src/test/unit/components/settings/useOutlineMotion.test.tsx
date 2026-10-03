import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsSectionId } from "@/components/settings/SettingsSection";
import type { OutlineSelection } from "@/features/settings/outline";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { SettingsOutline } = await import("@/components/settings/SettingsOutline");
const { OUTLINE_PHASE_MS, OUTLINE_REVERSAL_MIN_MS } = await import(
  "@/components/settings/useOutlineMotion"
);

const ROW_HEIGHT = 20;
const present: SettingsSectionId[] = ["appearance", "general", "about"];

interface Call {
  key: string | null;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  animation: FakeAnimation;
}

/**
 * A controllable Web Animations stand-in. A height animation is painted on its
 * element while it runs, as the browser does, so the height the hook reads back
 * is the height on screen and a reversal can only start from what is really
 * there. `finish()` ends it leaving what its fill keeps, `cancel()` takes the
 * painted value away, and `settle()` resolves `finished` whenever the test says
 * so, which is how a promise from a fold the phase has already left arrives.
 */
class FakeAnimation {
  onfinish: (() => void) | null = null;
  oncancel: (() => void) | null = null;
  private resolve!: () => void;
  readonly finished: Promise<void> = new Promise((resolve) => {
    this.resolve = resolve;
  });
  cancelled = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly keyframes: Keyframe[],
    private readonly fill: FillMode
  ) {
    this.paint(this.keyframes[0]);
  }

  private paint(keyframe: Keyframe | undefined) {
    const height = keyframe?.height;
    this.element.style.height = typeof height === "string" ? height : "";
  }

  /** Puts the row where a running animation is a moment into its own. */
  seek(height: number) {
    this.element.style.height = `${height}px`;
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    // Cancelling drops the animation's effect, so the row falls back to its own
    // height: what the fold that follows is measured against.
    this.element.style.height = "";
    if (this.oncancel) this.oncancel();
  }

  finish() {
    if (this.cancelled) return;
    // A forwards fill keeps its last value painted; a backwards one does not.
    this.paint(this.fill === "forwards" ? this.keyframes.at(-1) : undefined);
    if (this.onfinish) this.onfinish();
    this.resolve();
  }

  /** `finished` resolving without the animation having ended. */
  settle() {
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

// jsdom has no layout: a row spans ROW_HEIGHT px unless an animation is painting
// it at some other height, and an animation is a record of what was asked for.
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
    get(this: HTMLElement) {
      const painted = Number.parseFloat(this.style.height);
      return Number.isFinite(painted) ? painted : ROW_HEIGHT;
    },
  });
  HTMLElement.prototype.animate = function (
    this: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions
  ) {
    const animation = new FakeAnimation(this, keyframes, options.fill ?? "none");
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

/** Every height animation started on one section's rows, oldest first. */
const resizes = (section: string) =>
  calls.filter((call) => call.key?.startsWith(`row:${section}:`));
const lastResize = (section: string) => resizes(section).at(-1);
const heights = (call: Call | undefined) =>
  call?.keyframes.map((keyframe) => String(keyframe.height));
const foldedAway = (call: Call) => heights(call)?.at(-1) === "0px";

// The rows of one section move as a single edge: every row is given its own
// height keyframes, but they all describe the same edge sweeping the stack, so
// at any offset the rows above the edge are full, the ones below it are
// nothing, and at most one row is cut. A per-row curve would cut several labels
// at once and show stacked slivers of text.
const heightAt = (call: Call, offset: number) => {
  const keyframe = call.keyframes.find((frame) => frame.offset === offset) ?? call.keyframes[0];
  return Number.parseFloat(String(keyframe.height));
};
const startHeight = (call: Call | undefined) => heights(call)?.[0];
const endHeight = (call: Call | undefined) => heights(call)?.at(-1);
/** How many rows are cut (strictly between full and nothing) at one offset. */
const cutAt = (calls: readonly Call[], offset: number, natural = ROW_HEIGHT) =>
  calls.filter((call) => {
    const height = heightAt(call, offset);
    return height > 0 && height < natural;
  }).length;

// The entries are a stack of boxes that share their edges, so the motion is the
// space they occupy and nothing else: a keyframe that scaled a row would stretch
// its label, one that set a transform would draw it over its neighbour, and one
// that faded it would leave a hole where the rows should be. The offset only
// places a keyframe in its own timeline.
const onlyHeight = (call: Call) =>
  call.keyframes.every((keyframe) =>
    Object.keys(keyframe).every((property) => property === "height" || property === "offset")
  );
const fullPhase = (call: Call) => call.options.duration === OUTLINE_PHASE_MS;

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

  it("A to B folds A's rows away, then grows B's from nothing", async () => {
    const { moveTo } = renderOutline("appearance");
    const aRows = rowKeysOf("appearance");
    expect(aRows.length).toBeGreaterThan(0);

    await act(async () => moveTo("general"));

    // Appearance's rows give back the space they have and General's do not exist
    // yet: the outline never holds two sections' rows at once.
    const folding = resizes("appearance");
    expect(folding.map((call) => call.key)).toEqual(aRows);
    expect(startHeight(folding[0])).toBe(`${ROW_HEIGHT}px`);
    expect(heights(folding[0])?.at(-1)).toBe("0px");
    expect(folding.every(fullPhase)).toBe(true);
    expect(folding.every(onlyHeight)).toBe(true);
    expect(folding.every((call) => call.options.fill === "forwards")).toBe(true);
    expect(rowsOf("general")).toEqual([]);
    expect(resizes("general")).toEqual([]);

    // The fold finishes: React swaps the rows and General's grow into the space
    // it left, over a phase of the same slow length.
    await act(async () => finishAnimations(foldedAway));

    expect(rowKeysOf("appearance")).toEqual([]);
    const bRows = rowKeysOf("general");
    expect(bRows.length).toBeGreaterThan(0);
    const growing = resizes("general");
    expect(growing.map((call) => call.key)).toEqual(bRows);
    expect(startHeight(growing[0])).toBe("0px");
    expect(endHeight(growing[0])).toBe(`${ROW_HEIGHT}px`);
    expect(growing.every(fullPhase)).toBe(true);
    expect(growing.every(onlyHeight)).toBe(true);
    expect(growing.every((call) => call.options.fill === "backwards")).toBe(true);
  });

  // The rows curve with the direction they travel. A fold that eased out would
  // still be creeping over its last pixel on the frame the marker has already
  // arrived; a grow that eased in would hang there waiting to be let go. The
  // curve is baked into the edge, so each row's own easing is linear.
  it("a fold accelerates and the grow that follows decelerates", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));

    const folding = resizes("appearance");
    expect(folding.length).toBeGreaterThan(0);
    expect(folding.every((call) => call.options.easing === "linear")).toBe(true);

    await act(async () => finishAnimations(foldedAway));

    const growing = resizes("general");
    expect(growing.length).toBeGreaterThan(0);
    expect(growing.every((call) => call.options.easing === "linear")).toBe(true);
  });

  // A target that arrives mid-phase is intercepted, not started over: the fold
  // already running keeps the space it has taken and the outline arrives at the
  // newest target. Snapping to it is the jump this motion exists to remove.
  it("a new target while A folds retargets the fold instead of restarting it", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    const folding = resizes("appearance");
    expect(folding.length).toBeGreaterThan(0);
    const before = calls.length;

    await act(async () => moveTo("about"));

    // The fold is untouched: not cancelled, not restarted, nothing beside it.
    expect(folding.every((call) => !call.animation.cancelled)).toBe(true);
    expect(calls.length).toBe(before);
    // Neither of the targets on its way has appeared.
    expect(rowsOf("general")).toEqual([]);
    expect(rowsOf("about")).toEqual([]);

    // The fold ends where it was already going: at the newest target.
    await act(async () => finishAnimations(foldedAway));
    expect(rowKeysOf("general")).toEqual([]);
    const aboutRows = rowKeysOf("about");
    expect(aboutRows.length).toBeGreaterThan(0);
    expect(startHeight(lastResize("about"))).toBe("0px");
    expect(endHeight(lastResize("about"))).toBe(`${ROW_HEIGHT}px`);
  });

  // The point of sweeping one edge over the section instead of resizing every
  // row on its own: at no offset are two rows cut at once, so the section never
  // shows stacked slivers of two half-clipped labels.
  it("a fold cuts at most one of the section's rows at any offset", async () => {
    const { moveTo } = renderOutline("appearance");
    const fourRows = rowKeysOf("appearance");
    expect(fourRows).toHaveLength(4);

    await act(async () => moveTo("general"));

    const folding = resizes("appearance");
    expect(folding.map((call) => call.key)).toEqual(fourRows);
    // The edge really sweeps: at every offset at most one row is between full
    // and nothing, and at some offset exactly one is.
    for (let i = 0; i < folding[0].keyframes.length; i++) {
      const offset = folding[0].keyframes[i].offset ?? 0;
      expect(cutAt(folding, offset)).toBeLessThanOrEqual(1);
    }
    const anyCut = folding[0].keyframes.some(
      (frame) => cutAt(folding, frame.offset ?? 0) === 1
    );
    expect(anyCut).toBe(true);
  });

  // A reversal mid-fold restarts every row from the space it paints at, so the
  // edge picks up where it left off instead of jumping.
  it("a reversal mid-fold starts every row at the height it painted at", async () => {
    const { moveTo } = renderOutline("appearance");
    const aRows = rowKeysOf("appearance");
    await act(async () => moveTo("general"));
    const folding = resizes("appearance");

    // Mid-fold: the edge has taken part of the section away. Paint each row at
    // the height its own keyframes hold at the halfway offset, so the sum is the
    // space the section occupies now.
    const middle = Math.floor(folding[0].keyframes.length / 2);
    let paintedSum = 0;
    for (const call of folding) {
      const height = Number.parseFloat(String(call.keyframes[middle].height));
      call.animation.seek(height);
      paintedSum += height;
    }

    await act(async () => moveTo("appearance"));

    const reversing = resizes("appearance").slice(folding.length);
    expect(reversing.map((call) => call.key)).toEqual(aRows);
    // Each reversal starts where that row painted, and the starting heights sum
    // to the space the section occupied: the edge never jumps.
    const starts = reversing.map((call) =>
      Number.parseFloat(String(call.keyframes[0].height))
    );
    expect(starts.reduce((total, height) => total + height, 0)).toBeCloseTo(paintedSum, 6);
    expect(reversing.every(onlyHeight)).toBe(true);
    expect(folding.every((call) => call.animation.cancelled)).toBe(true);
  });

  it("returning to the shown section while it folds grows it back where it paints", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    const folding = resizes("appearance");
    const aRows = rowKeysOf("appearance");

    // Half way through the fold, which is all the author sees when they scroll
    // back before it ends. Each row paints half a row: the edge sits at the
    // middle of the stack, so the top two rows are full and the bottom two are
    // nothing.
    for (const call of folding) call.animation.seek(ROW_HEIGHT / 2);
    const before = calls.length;

    await act(async () => moveTo("appearance"));

    const reversing = resizes("appearance").slice(folding.length);
    expect(reversing.map((call) => call.key)).toEqual(aRows);
    // The reversal starts where the edge paints: the rows above it are full,
    // the rows below it are nothing, and the starting heights sum to the space
    // the section occupied. Never from nothing, never a snap to full.
    expect(reversing.map((call) => startHeight(call))).toEqual([
      `${ROW_HEIGHT}px`,
      `${ROW_HEIGHT}px`,
      "0px",
      "0px",
    ]);
    expect(
      reversing.reduce((total, call) => total + Number.parseFloat(startHeight(call) ?? "0"), 0)
    ).toBeCloseTo(2 * ROW_HEIGHT, 6);
    expect(reversing[0].keyframes.at(-1)!.height).toBe(`${ROW_HEIGHT}px`);
    expect(reversing.every(onlyHeight)).toBe(true);
    // Half the distance, half the time: a reversal with little left to travel
    // arrives instead of crawling over the last pixels.
    expect(reversing[0].options.duration).toBeLessThan(OUTLINE_PHASE_MS);
    expect(folding.every((call) => call.animation.cancelled)).toBe(true);
    expect(rowsOf("general")).toEqual([]);
    // Only those rows moved: there is no longer any section to arrive at.
    expect(calls.length).toBe(before + aRows.length);

    await act(async () => finishAnimations((call) => heights(call)?.at(-1) === `${ROW_HEIGHT}px`));
    expect(rowKeysOf("appearance")).toEqual(aRows);
  });

  it("a new target while B grows folds B back from where it paints", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    await act(async () => finishAnimations(foldedAway));
    const growing = resizes("general");
    expect(growing.length).toBeGreaterThan(0);

    // Part way through the grow, the newest target arrives.
    const half = ROW_HEIGHT / 2;
    for (const call of growing) call.animation.seek(half);

    await act(async () => moveTo("about"));

    // The same rows, folding from the space they paint at: neither the natural
    // height they were growing to nor nothing. Each paints half a row, so the
    // edge sits mid-stack and the fold starts with the rows above it full.
    const folding = resizes("general").slice(growing.length);
    expect(folding.map((call) => call.key)).toEqual(growing.map((call) => call.key));
    expect(folding.every(onlyHeight)).toBe(true);
    expect(folding.every((call) => call.options.fill === "forwards")).toBe(true);
    expect(folding[0].keyframes.at(-1)!.height).toBe("0px");
    // The edge never jumps: the fold starts at the space the grow had reached.
    const bRows = growing.length;
    const starts = folding.map((call) => Number.parseFloat(startHeight(call) ?? "0"));
    expect(starts.reduce((total, height) => total + height, 0)).toBeCloseTo(
      (bRows * half),
      6
    );
    // About's rows are still not on screen: this fold has to end first.
    expect(rowsOf("about")).toEqual([]);

    await act(async () =>
      finishAnimations((call) => call.key?.startsWith("row:general:") === true)
    );
    expect(rowKeysOf("general")).toEqual([]);
    expect(rowKeysOf("about").length).toBeGreaterThan(0);
  });

  // A fold with less than a pixel left is over before it starts: there is
  // nothing to watch, so it takes none of the reversal's floor either. The row
  // still has to stay clipped to nothing until React removes it, or the cancelled
  // animation hands it back its natural height and it pops back for a frame.
  it("a fold of a row painting under a pixel clips it at once instead of waiting", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    await act(async () => finishAnimations(foldedAway));
    const growing = resizes("general");
    expect(growing.length).toBeGreaterThan(0);

    // The grow has all but arrived: the section paints a fraction of a pixel in
    // total, spread across its rows.
    const sliver = 0.5 / growing.length;
    for (const call of growing) call.animation.seek(sliver);
    const before = calls.length;

    await act(async () => moveTo("about"));

    const folding = resizes("general").slice(growing.length);
    expect(folding.map((call) => call.key)).toEqual(growing.map((call) => call.key));
    for (const call of folding) {
      expect(heights(call)).toEqual(["0px", "0px"]);
      expect(call.options.duration).toBe(0);
      expect(call.options.duration).toBeLessThan(OUTLINE_REVERSAL_MIN_MS);
      // A forwards clip, not a cancelled grow's fall back to the natural height.
      expect(call.options.fill).toBe("forwards");
    }
    expect(calls.length).toBe(before + folding.length);
    expect(growing.every((call) => call.animation.cancelled)).toBe(true);
    expect(rowsOf("general").map((row) => row.style.height)).toEqual(folding.map(() => "0px"));

    // The phase is over the moment that clip is, and the outline has arrived.
    await act(async () => finishAnimations(foldedAway));
    expect(rowKeysOf("general")).toEqual([]);
    expect(rowKeysOf("about").length).toBeGreaterThan(0);
  });

  // A fold the phase has already left keeps its promise. Resolving it late must
  // not advance the fold that took its place.
  it("a late finish from a superseded fold cannot advance the fold that replaced it", async () => {
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    const superseded = resizes("appearance");
    expect(superseded.length).toBeGreaterThan(0);

    // Back to the shown section, then on to the next one again: the first fold
    // is cancelled and the phase that owned it is long gone.
    await act(async () => moveTo("appearance"));
    await act(async () =>
      finishAnimations((call) => call.key?.startsWith("row:appearance:") === true)
    );
    const beforeFold = calls.length;
    await act(async () => moveTo("general"));
    const folding = calls.slice(beforeFold);
    expect(folding.map((call) => call.key)).toEqual(rowKeysOf("appearance"));
    const foldingKeys = folding.map((call) => call.key);
    expect(rowKeysOf("general")).toEqual([]);
    const before = calls.length;

    // The cancelled fold's promise resolves after all of that.
    await act(async () => {
      for (const call of superseded) call.animation.settle();
      await Promise.resolve();
    });

    // Appearance is still folding away: the stale finish advanced nothing.
    expect(calls.slice(beforeFold).map((call) => call.key)).toEqual(foldingKeys);
    expect(calls.length).toBe(before);
    expect(rowKeysOf("general")).toEqual([]);
    expect(rowKeysOf("appearance").length).toBeGreaterThan(0);
  });

  it("a search typed mid-fold stops the motion at once", async () => {
    const user = userEvent.setup();
    const { moveTo } = renderOutline("appearance");
    await act(async () => moveTo("general"));
    const folding = resizes("appearance");
    expect(folding.length).toBeGreaterThan(0);

    await user.type(screen.getByRole("searchbox"), "a");

    // Everything the fold was doing is gone, and the matches are not animated.
    expect(folding.every((call) => call.animation.cancelled)).toBe(true);
    expect(calls.slice(folding.length)).toEqual([]);
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

  it("opening another section from the keyboard grows its rows in", async () => {
    const user = userEvent.setup();
    renderOutline("appearance");
    await user.tab();
    await user.tab();
    const general = screen.getByRole("row", { name: "settings.general" });
    while (document.activeElement !== general) await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowRight}");
    const growing = resizes("general");
    expect(growing.length).toBeGreaterThan(0);
    expect(startHeight(growing[0])).toBe("0px");
    expect(endHeight(growing[0])).toBe(`${ROW_HEIGHT}px`);
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
    expect(startHeight(calls.at(-1))).toBe("0px");
    expect(endHeight(calls.at(-1))).toBe(`${ROW_HEIGHT}px`);
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
