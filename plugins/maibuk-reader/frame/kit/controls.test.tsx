/** @jsxImportSource preact */
/**
 * The Reader Frame's kit (#943 unit 2): the Icon inventory and the six basic
 * controls, driven through a real Preact tree in jsdom. Every keyboard path is
 * a real `user-event` press and every assertion is the behavior a reader sees
 * (focus, checked state, value), never an attached handler or an attribute
 * standing in for operability.
 */

import { configure, getConfig, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentChild } from "preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Chip, Icon, ICON_NAMES, IconButton, Segmented, Slider, Switch } from "./index";

const containers: HTMLElement[] = [];
const nativeWidth = window.innerWidth;
const baseConfig = getConfig();

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
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

beforeEach(() => {
  setWidth(nativeWidth);
  // The fake-timer tooltip tests would otherwise stall on Testing Library's
  // React act wrapper, which drains through a real `setTimeout(0)` and cannot
  // see Vitest's clock. Preact's `act` already flushes every commit here.
  configure({ asyncWrapper: async (callback) => callback() });
});

afterEach(async () => {
  await act(() => {
    for (const container of containers.splice(0)) {
      render(null, container);
      container.remove();
    }
  });
  vi.useRealTimers();
  configure({ asyncWrapper: baseConfig.asyncWrapper });
  setWidth(nativeWidth);
});

describe("Icon", () => {
  // The artboard's inventory, in its gallery order, with its exact path data.
  const PATHS = {
    back: "M15 18l-6-6 6-6",
    fwd: "M9 18l6-6-6-6",
    down: "M6 9l6 6 6-6",
    up: "M18 15l-6-6-6 6",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    close: "M6 6l12 12M18 6L6 18",
    check: "M5 12l5 5 9-11",
    import: "M12 3v12M7 10l5 5 5-5M4 20h16",
    export: "M12 15V3M7 8l5-5 5 5M4 14v6h16v-6",
    folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    list: "M9 6h12M9 12h12M9 18h12M4 5h2v2H4zM4 11h2v2H4zM4 17h2v2H4z",
    compact: "M3 5h18M3 10h18M3 15h18M3 20h18",
    sort: "M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3",
    filter: "M3 5h18l-7 8v6l-4 2v-8z",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    moreV: "M12 5h.01M12 12h.01M12 19h.01",
    contents: "M4 6h16M4 12h10M4 18h14",
    bookmark: "M6 3h12v18l-6-4-6 4z",
    highlight: "M15 4l5 5-9 9H6v-5zM4 21h9",
    note: "M4 4h16v12H9l-5 4zM8 8h8M8 12h5",
    lookup: "M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3zM21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z",
    copy: "M9 9h11v11H9zM5 15H4V4h11v1",
    text: "M3 19L8 5l5 14M5 14h6M16 11a3 3 0 0 1 5 2v6M21 15h-3a2 2 0 0 0 0 4h3",
    theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
    code: "M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16",
    stats: "M4 20V11M10 20V5M16 20v-7M21 20H3",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
    collection: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
    fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    tap: "M9 11V5a2 2 0 0 1 4 0v5M13 10a2 2 0 0 1 4 0v2M17 12a2 2 0 0 1 4 0v2a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-2.5-4a1.8 1.8 0 0 1 3-2L9 15",
    alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
    relink:
      "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
    font: "M5 20L11 4h2l6 16M7.5 14h9",
    alignLeft: "M3 6h18M3 10h12M3 14h18M3 18h12",
    justify: "M3 6h18M3 10h18M3 14h18M3 18h18",
    book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
    pen: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
    calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4",
    swap: "M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
    hyphen: "M4 7h9M4 12h6M14 12h3M4 17h9",
    fitWidth: "M18 8l4 4-4 4M2 12h20M6 8l-4 4 4 4",
    fitPage: "M12 2v20M8 18l4 4 4-4M8 6l4-4 4 4",
    continuous: "M5 3h14v7H5zM5 14h14v7H5z",
    fullscreenExit:
      "M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3",
  } as const;

  it("names every inventory icon in artboard order", () => {
    expect(ICON_NAMES).toEqual(Object.keys(PATHS));
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("renders every icon at 20 px with 1.75 stroke and its exact path", async () => {
    const container = await mount(
      <div>
        {ICON_NAMES.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </div>
    );

    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(ICON_NAMES.length);

    ICON_NAMES.forEach((name, index) => {
      const svg = svgs[index];
      expect(svg).toHaveAttribute("width", "20");
      expect(svg).toHaveAttribute("height", "20");
      expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
      expect(svg).toHaveAttribute("stroke-width", "1.75");
      expect(svg).toHaveAttribute("stroke-linecap", "round");
      expect(svg).toHaveAttribute("stroke-linejoin", "round");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).toHaveAttribute("focusable", "false");
      expect(svg.querySelector("path")).toHaveAttribute("d", PATHS[name]);
    });
  });
});

describe("Button", () => {
  it("reaches every variant by Tab and fires it with Enter", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup({ delay: null });
    await mount(
      <div>
        <Button variant="primary" onClick={onClick}>
          Primary
        </Button>
        <Button variant="secondary" onClick={onClick}>
          Secondary
        </Button>
        <Button variant="ghost" onClick={onClick}>
          Ghost
        </Button>
        <Button variant="destructive" onClick={onClick}>
          Destructive
        </Button>
      </div>
    );

    for (const name of ["Primary", "Secondary", "Ghost", "Destructive"]) {
      await press(() => user.tab());
      expect(document.activeElement).toBe(screen.getByRole("button", { name }));
      await press(() => user.keyboard("{Enter}"));
    }

    expect(onClick).toHaveBeenCalledTimes(4);
  });

  it("defaults to type button and never fires while disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup({ delay: null });
    await mount(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toBeDisabled();

    await press(() => user.click(button));
    await press(() => user.keyboard("{Enter}"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("IconButton", () => {
  it("keeps its accessible name and sizes its square target from the layout", async () => {
    setWidth(1024);
    await mount(<IconButton label="Search" icon="search" />);
    const button = screen.getByRole("button", { name: "Search" });
    expect(button.style.width).toBe("40px");
    expect(button.style.height).toBe("40px");

    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(button.style.width).toBe("44px");
    expect(button.style.height).toBe("44px");
  });

  it("forwards an explicit buttonRef to its native button", async () => {
    const ref: { current: HTMLButtonElement | null } = { current: null };
    await mount(<IconButton label="Search" icon="search" buttonRef={ref} />);

    const button = screen.getByRole("button", { name: "Search" });
    expect(ref.current).toBe(button);
    ref.current?.focus();
    expect(document.activeElement).toBe(button);
  });

  it("hides its tooltip wrapper along with the native button", async () => {
    const container = await mount(
      <div>
        <IconButton label="Shown" icon="search" />
        <IconButton label="Hidden" icon="search" hidden />
      </div>
    );

    const wrappers = container.querySelectorAll(".kit-icon-button");
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]).not.toHaveAttribute("hidden");
    expect(wrappers[1]).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Shown" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hidden" })).not.toBeInTheDocument();
  });

  it("shows the tooltip after 500 ms on Wide and hides it on leave", async () => {
    await mount(<IconButton label="Search" icon="search" />);
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const button = screen.getByRole("button", { name: "Search" });

    await press(() => user.hover(button));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Search");

    await press(() => user.unhover(button));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("cancels a pending tooltip when the pointer leaves early", async () => {
    await mount(<IconButton label="Search" icon="search" />);
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const button = screen.getByRole("button", { name: "Search" });

    await press(() => user.hover(button));
    await act(() => {
      vi.advanceTimersByTime(250);
    });
    await press(() => user.unhover(button));
    await act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows no tooltip in Narrow", async () => {
    setWidth(500);
    await mount(<IconButton label="Search" icon="search" />);
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const button = screen.getByRole("button", { name: "Search" });

    await press(() => user.hover(button));
    await act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hides a shown tooltip when the layout becomes Narrow", async () => {
    await mount(<IconButton label="Search" icon="search" />);
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const button = screen.getByRole("button", { name: "Search" });

    await press(() => user.hover(button));
    await act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("cancels a pending tooltip when the layout becomes Narrow", async () => {
    await mount(<IconButton label="Search" icon="search" />);
    vi.useFakeTimers();
    const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
    const button = screen.getByRole("button", { name: "Search" });

    await press(() => user.hover(button));
    await act(() => {
      vi.advanceTimersByTime(100);
    });
    setWidth(500);
    await act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

function SegmentedHarness({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState("single");
  return (
    <div>
      <Segmented
        label="Layout"
        value={value}
        options={[
          { value: "single", label: "Single" },
          { value: "continuous", label: "Continuous" },
          { value: "spread", label: "Spread" },
        ]}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button">After</button>
    </div>
  );
}

describe("Segmented", () => {
  it("is one Tab stop and leaves with the next Tab", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<SegmentedHarness />);

    await press(() => user.tab());
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Single" }));

    await press(() => user.tab());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "After" }));
  });

  it("moves and selects with the arrow keys", async () => {
    const seen: string[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<SegmentedHarness onChange={(value) => seen.push(value)} />);

    await press(() => user.tab());
    await press(() => user.keyboard("{ArrowRight}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Continuous" }));
    expect(screen.getByRole("radio", { name: "Continuous" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await press(() => user.keyboard("{ArrowDown}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Spread" }));

    await press(() => user.keyboard("{ArrowLeft}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Continuous" }));

    await press(() => user.keyboard("{ArrowUp}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Single" }));
    expect(seen).toEqual(["continuous", "spread", "continuous", "single"]);
  });

  it("selects the first and last option with Home and End", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<SegmentedHarness />);

    await press(() => user.tab());
    await press(() => user.keyboard("{End}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Spread" }));
    expect(screen.getByRole("radio", { name: "Spread" })).toHaveAttribute("aria-checked", "true");

    await press(() => user.keyboard("{Home}"));
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Single" }));
    expect(screen.getByRole("radio", { name: "Single" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps exactly one tab stop as the value changes", async () => {
    const user = userEvent.setup({ delay: null });
    const container = await mount(<SegmentedHarness />);

    await press(() => user.tab());
    await press(() => user.keyboard("{ArrowRight}"));

    const stops = container.querySelectorAll('[role="radio"][tabindex="0"]');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName("Continuous");
  });
});

function ToggleChipHarness({ onChange }: { onChange?: (pressed: boolean) => void }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Chip
      pressed={pressed}
      onPressedChange={(next) => {
        setPressed(next);
        onChange?.(next);
      }}
    >
      Filter
    </Chip>
  );
}

describe("Chip", () => {
  it("toggles with Space and Enter in toggle mode", async () => {
    const seen: boolean[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<ToggleChipHarness onChange={(pressed) => seen.push(pressed)} />);

    await press(() => user.tab());
    await press(() => user.keyboard(" "));
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-pressed", "true");

    await press(() => user.keyboard("{Enter}"));
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute("aria-pressed", "false");
    expect(seen).toEqual([true, false]);
  });

  it("removes a removable chip from its own labelled x button", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup({ delay: null });
    const container = await mount(
      <Chip removeLabel="Remove filter" onRemove={onRemove}>
        Filter
      </Chip>
    );

    expect(container.querySelectorAll("button button")).toHaveLength(0);
    expect(screen.getByText("Filter")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter" }).querySelector("svg")
    ).toHaveAttribute("width", "20");

    await press(() => user.tab());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Remove filter" }));
    await press(() => user.keyboard("{Enter}"));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("removes a removable chip with Space too", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup({ delay: null });
    await mount(
      <Chip removeLabel="Remove filter" onRemove={onRemove}>
        Filter
      </Chip>
    );

    await press(() => user.tab());
    await press(() => user.keyboard(" "));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

function SwitchHarness({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label="Hyphenation"
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Switch", () => {
  it("toggles the whole row with Space", async () => {
    const seen: boolean[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<SwitchHarness onChange={(checked) => seen.push(checked)} />);

    const row = screen.getByRole("switch", { name: "Hyphenation" });
    await press(() => user.tab());
    expect(document.activeElement).toBe(row);

    await press(() => user.keyboard(" "));
    expect(row).toHaveAttribute("aria-checked", "true");

    await press(() => user.keyboard(" "));
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(seen).toEqual([true, false]);
  });

  it("toggles when the label side of the row is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<SwitchHarness />);

    const row = screen.getByRole("switch", { name: "Hyphenation" });
    await press(() => user.click(screen.getByText("Hyphenation")));
    expect(row).toHaveAttribute("aria-checked", "true");
  });
});

function SliderHarness({
  initial = 20,
  min = 10,
  max = 30,
  step = 1,
  onChange,
}: {
  initial?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      label="Font size"
      value={value}
      min={min}
      max={max}
      step={step}
      decreaseLabel="Decrease font size"
      increaseLabel="Increase font size"
      formatValue={(size) => `${size} px`}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Slider", () => {
  it("steps with the arrow keys and prints its formatted value", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<SliderHarness />);

    await press(() => user.tab());
    await press(() => user.tab());
    expect(document.activeElement).toBe(screen.getByRole("slider", { name: "Font size" }));

    await press(() => user.keyboard("{ArrowRight}"));
    expect(screen.getByText("21 px")).toBeInTheDocument();

    await press(() => user.keyboard("{ArrowLeft}"));
    expect(screen.getByText("20 px")).toBeInTheDocument();
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup({ delay: null });
    await mount(<SliderHarness />);

    await press(() => user.tab());
    await press(() => user.tab());
    await press(() => user.keyboard("{Home}"));
    expect(screen.getByText("10 px")).toBeInTheDocument();

    await press(() => user.keyboard("{End}"));
    expect(screen.getByText("30 px")).toBeInTheDocument();
  });

  it("steps with the minus and plus buttons", async () => {
    const seen: number[] = [];
    const user = userEvent.setup({ delay: null });
    await mount(<SliderHarness onChange={(value) => seen.push(value)} />);

    await press(() => user.click(screen.getByRole("button", { name: "Increase font size" })));
    expect(screen.getByText("21 px")).toBeInTheDocument();
    await press(() => user.click(screen.getByRole("button", { name: "Increase font size" })));
    expect(screen.getByText("22 px")).toBeInTheDocument();
    await press(() => user.click(screen.getByRole("button", { name: "Decrease font size" })));
    expect(screen.getByText("21 px")).toBeInTheDocument();
    expect(seen).toEqual([21, 22, 21]);
  });

  it("clamps a step at the minimum and maximum", async () => {
    const seen: number[] = [];
    const user = userEvent.setup({ delay: null });
    const atMin = await mount(
      <SliderHarness initial={10} min={10} max={30} onChange={(value) => seen.push(value)} />
    );

    await press(() => user.click(screen.getByRole("button", { name: "Decrease font size" })));
    expect(within(atMin).getByText("10 px")).toBeInTheDocument();
    expect(seen).toEqual([]);

    await act(() => {
      render(null, atMin);
    });
    const atMax = await mount(
      <SliderHarness initial={30} min={10} max={30} onChange={(value) => seen.push(value)} />
    );

    await press(() => user.click(screen.getByRole("button", { name: "Increase font size" })));
    expect(within(atMax).getByText("30 px")).toBeInTheDocument();
    expect(seen).toEqual([]);
  });
});
