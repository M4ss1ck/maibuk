/** @jsxImportSource preact */
/**
 * The Reader Frame's Cover and ProgressCard (#943 unit 4), driven through a
 * real Preact tree in jsdom. Cover geometry and tone are the artboard's exact
 * values, and every ProgressCard action is a real `user-event` key press.
 * Stylesheet contracts (the two-part shadow, the image fade, the floating
 * position) are read from `kit.css`, because a token is the contract there.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configure, getConfig, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentChild } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cover, ProgressCard } from "./index";

const containers: HTMLElement[] = [];
const baseConfig = getConfig();

const kitCss = readFileSync(join(__dirname, "..", "..", "assets", "ui", "kit.css"), "utf8");
const coverSource = readFileSync(join(__dirname, "cover.tsx"), "utf8");

interface Rule {
  selectors: string[];
  body: string;
}

const rules: Rule[] = [];
for (const match of kitCss.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selectors = match[1]
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector !== "");
  rules.push({ selectors, body: match[2] });
}

function rule(selector: string): string {
  const found = rules.filter((candidate) => candidate.selectors.includes(selector)).at(-1);
  if (!found) throw new Error(`kit.css has no rule for ${selector}`);
  return found.body.replace(/\s+/g, " ").trim();
}

async function mount(node: ComponentChild): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  await act(() => {
    render(node, container);
  });
  return container;
}

/** Runs an interaction inside `act` so Preact commits before the assertion. */
async function press(action: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await action();
  });
}

function coverOf(title: string): HTMLElement {
  const element = screen.getByText(title).closest(".kit-cover");
  if (!(element instanceof HTMLElement)) throw new Error(`no cover around ${title}`);
  return element;
}

function generatedOf(cover: HTMLElement): HTMLElement {
  const element = cover.querySelector(".kit-cover__generated");
  if (!(element instanceof HTMLElement)) throw new Error("no generated cover");
  return element;
}

beforeEach(() => {
  configure({ asyncWrapper: async (callback) => callback() });
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  configure({ asyncWrapper: baseConfig.asyncWrapper });
});

describe("Cover", () => {
  it("draws the generated cover at 128 px with the artboard geometry and first tone", async () => {
    await mount(<Cover title="Middlemarch" author="George Eliot" format="EPUB" />);

    const cover = coverOf("Middlemarch");
    expect(cover.style.width).toBe("128px");
    expect(cover.style.height).toBe("192px");
    expect(cover.style.opacity).toBe("1");

    const generated = generatedOf(cover);
    expect(generated.style.padding).toBe("12px");
    expect(generated.style.gap).toBe("8px");
    expect(generated.style.background).toBe("var(--cover-tone-1-bg)");
    expect(generated.style.color).toBe("var(--cover-tone-1-ink)");

    expect(screen.getByText("Middlemarch")).toHaveStyle({ fontSize: "19px" });
    expect(screen.getByText("George Eliot")).toHaveStyle({ fontSize: "10px" });

    // The format only belongs to the pending cover.
    expect(screen.queryByText("EPUB")).not.toBeInTheDocument();
  });

  it.each([
    { width: 88, height: 132, pad: "8px", gap: "6px", title: "13px", author: "7px" },
    { width: 128, height: 192, pad: "12px", gap: "8px", title: "19px", author: "10px" },
    { width: 176, height: 264, pad: "16px", gap: "11px", title: "26px", author: "13px" },
    { width: 40, height: 60, pad: "6px", gap: "4px", title: "9px", author: "7px" },
  ])("keeps the 2:3 ratio and the size-derived type at $width px", async ({
    width,
    height,
    pad,
    gap,
    title,
    author,
  }) => {
    await mount(<Cover title={`Cover ${width}`} author="Author" format="EPUB" width={width} />);

    const cover = coverOf(`Cover ${width}`);
    expect(cover.style.width).toBe(`${width}px`);
    expect(cover.style.height).toBe(`${height}px`);

    const generated = generatedOf(cover);
    expect(generated.style.padding).toBe(pad);
    expect(generated.style.gap).toBe(gap);
    expect(screen.getByText(`Cover ${width}`)).toHaveStyle({ fontSize: title });
    expect(screen.getByText("Author")).toHaveStyle({ fontSize: author });
  });

  it("draws each of the eight tone pairs and wraps the tone around", async () => {
    const tones = [
      ["var(--cover-tone-1-bg)", "var(--cover-tone-1-ink)"],
      ["var(--cover-tone-2-bg)", "var(--cover-tone-2-ink)"],
      ["var(--cover-tone-3-bg)", "var(--cover-tone-3-ink)"],
      ["var(--cover-tone-4-bg)", "var(--cover-tone-4-ink)"],
      ["var(--cover-tone-5-bg)", "var(--cover-tone-5-ink)"],
      ["var(--cover-tone-6-bg)", "var(--cover-tone-6-ink)"],
      ["var(--cover-tone-7-bg)", "var(--cover-tone-7-ink)"],
      ["var(--cover-tone-8-bg)", "var(--cover-tone-8-ink)"],
    ];

    await mount(
      <div>
        {tones.map((_, index) => (
          <Cover key={index} title={`Tone ${index}`} author="Author" format="EPUB" tone={index} />
        ))}
        <Cover title="Tone wrapped" author="Author" format="EPUB" tone={8} />
        <Cover title="Tone back" author="Author" format="EPUB" tone={-1} />
      </div>
    );

    tones.forEach(([background, color], index) => {
      const generated = generatedOf(coverOf(`Tone ${index}`));
      expect(generated.style.background).toBe(background);
      expect(generated.style.color).toBe(color);
    });

    const wrapped = generatedOf(coverOf("Tone wrapped"));
    expect(wrapped.style.background).toBe("var(--cover-tone-1-bg)");
    const back = generatedOf(coverOf("Tone back"));
    expect(back.style.background).toBe("var(--cover-tone-8-bg)");
  });

  it("draws a pending cover on the muted dashed surface with the format and title", async () => {
    await mount(<Cover title="Middlemarch" author="George Eliot" format="EPUB" pending />);

    const cover = coverOf("Middlemarch");
    expect(cover.querySelector(".kit-cover__generated")).toBeNull();

    expect(screen.getByText("EPUB")).toBeInTheDocument();
    expect(screen.getByText("Middlemarch")).toHaveStyle({ fontSize: "13px" });

    const pending = cover.querySelector(".kit-cover__pending");
    if (!(pending instanceof HTMLElement)) throw new Error("no pending cover");
    expect(pending.style.padding).toBe("12px");
    expect(rule(".kit-cover__pending")).toContain("background: var(--cover-pending-bg)");
    expect(rule(".kit-cover__pending")).toContain("color: var(--cover-pending-ink)");
    expect(rule(".kit-cover__pending")).toContain("border: 1px dashed var(--cover-pending-border)");
  });

  it("fades a missing cover to 40 percent", async () => {
    await mount(<Cover title="Missing" author="Author" format="EPUB" missing />);
    expect(coverOf("Missing").style.opacity).toBe("0.4");
  });

  it("lays a real image over the generated cover and reveals it when the image fails", async () => {
    const container = await mount(
      <Cover title="Middlemarch" author="George Eliot" format="EPUB" src="/covers/mw.jpg" />
    );

    const image = container.querySelector(".kit-cover__image");
    if (!(image instanceof HTMLImageElement)) throw new Error("no cover image");
    expect(image.getAttribute("src")).toBe("/covers/mw.jpg");
    expect(image.getAttribute("alt")).toBe("");

    // The generated cover is underneath, ready for an error.
    const generated = generatedOf(coverOf("Middlemarch"));
    expect(generated.querySelector(".kit-cover__title")?.textContent).toBe("Middlemarch");

    await act(() => {
      image.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector(".kit-cover__image")).toBeNull();
    expect(coverOf("Middlemarch").querySelector(".kit-cover__generated")).not.toBeNull();
  });

  it("brings the image back when the source changes after an error", async () => {
    const renderCover = (src: string) => (
      <Cover title="One" author="Author" format="EPUB" src={src} />
    );

    const container = await mount(renderCover("/one.jpg"));
    const first = container.querySelector<HTMLImageElement>('img[src="/one.jpg"]');
    if (!first) throw new Error("no first image");
    await act(() => {
      first.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector('img[src="/one.jpg"]')).toBeNull();

    // A fresh source is a new chance to load, not the last failure's state.
    await act(() => {
      render(renderCover("/two.jpg"), container);
    });
    expect(container.querySelector('img[src="/two.jpg"]')).not.toBeNull();

    await act(() => {
      render(renderCover("/one.jpg"), container);
    });
    expect(container.querySelector('img[src="/one.jpg"]')).not.toBeNull();
  });

  it("states its shadow, radius, type and image fade only through tokens", () => {
    expect(rule(".kit-cover")).toContain("box-shadow: var(--cover-shadow)");
    expect(rule(".kit-cover")).toContain("border-radius: var(--radius-cover)");
    expect(rule(".kit-cover__title")).toContain("font-family: var(--type-cover-family)");
    expect(rule(".kit-cover__title")).toContain("font-weight: var(--type-cover-weight)");
    expect(rule(".kit-cover__author")).toContain("text-transform: uppercase");
    expect(rule(".kit-cover__image")).toContain(
      "animation: kit-cover-in var(--motion-duration-cover) var(--motion-ease)"
    );
    expect(rule(".kit-cover__image")).toContain("object-fit: cover");

    for (const source of [coverSource, kitCss]) {
      expect(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")).not.toMatch(
        /#[0-9a-f]{3,8}\b|\brgba?\(/i
      );
    }
  });
});

describe("ProgressCard", () => {
  it("draws the bar, the tabular counts, and a keyboard Cancel", async () => {
    const onCancel = vi.fn();
    const onViewReport = vi.fn();
    const user = userEvent.setup({ delay: null });

    await mount(
      <ProgressCard
        title="Importing books"
        completed={3}
        total={10}
        countText="3 of 10"
        cancelLabel="Cancel"
        viewReportLabel="View report"
        onCancel={onCancel}
        onViewReport={onViewReport}
        complete={false}
      />
    );

    expect(screen.getByText("Importing books")).toBeInTheDocument();
    expect(screen.getByText("3 of 10")).toBeInTheDocument();

    const progress = screen.getByRole("progressbar", { name: "Importing books" });
    expect(progress).toHaveAttribute("value", "3");
    expect(progress).toHaveAttribute("max", "10");

    expect(screen.queryByRole("button", { name: "View report" })).not.toBeInTheDocument();

    await press(() => user.tab());
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await press(() => user.keyboard("{Enter}"));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onViewReport).not.toHaveBeenCalled();
  });

  it("turns the bar and Cancel into a keyboard View report when complete", async () => {
    const onCancel = vi.fn();
    const onViewReport = vi.fn();
    const user = userEvent.setup({ delay: null });

    await mount(
      <ProgressCard
        title="Importing books"
        completed={10}
        total={10}
        countText="10 of 10"
        cancelLabel="Cancel"
        viewReportLabel="View report"
        onCancel={onCancel}
        onViewReport={onViewReport}
        complete
      />
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByText("10 of 10")).toBeInTheDocument();

    const viewReport = screen.getByRole("button", { name: "View report" });
    await press(() => user.tab());
    expect(document.activeElement).toBe(viewReport);

    await press(() => user.keyboard(" "));
    expect(onViewReport).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("floats at the Shelf corner on the import layer", () => {
    const card = rule(".kit-progress-card");
    expect(card).toContain("position: fixed");
    expect(card).toContain("right: var(--space-4)");
    expect(card).toContain("bottom: var(--space-4)");
    expect(card).toContain("z-index: var(--z-import)");
    expect(card).toContain("background: var(--card)");
    expect(rule(".kit-progress-card__count")).toContain(
      "font-variant-numeric: var(--type-numeric)"
    );
  });
});
