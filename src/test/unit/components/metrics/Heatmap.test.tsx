import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({ "metrics.heatmap": "Writing heatmap", "common.words": "words" })[key] ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { Heatmap } = await import("@/components/metrics/Heatmap");

const YEAR = new Date().getFullYear();
const CELL = 20;

/**
 * jsdom has no layout, so every cell reports a zero rectangle and React Aria's
 * spatial Up/Down navigation finds nothing. Give each row a rectangle from the
 * grid coordinates the component placed it at, so the real keyboard delegate
 * runs against a real geometry.
 */
function stubCellRects() {
  for (const row of screen.getAllByRole("row")) {
    const element = row as HTMLElement;
    const column = Number(element.style.gridColumn);
    const line = Number(element.style.gridRow);
    const rect = {
      x: column * CELL,
      y: line * CELL,
      top: line * CELL,
      left: column * CELL,
      right: column * CELL + CELL,
      bottom: line * CELL + CELL,
      width: CELL,
      height: CELL,
      toJSON: () => ({}),
    } as DOMRect;
    element.getBoundingClientRect = () => rect;
  }
}

const day = (date: string, words: number) =>
  screen.getByRole("row", { name: `${date}: ${words} words` });

describe("Heatmap keyboard navigation", () => {
  it("exposes each day's date and word count in one focusable grid", () => {
    render(
      <Heatmap
        isLoading={false}
        aggregate={{ days: [{ date: `${YEAR}-01-01`, words: 5, events: 1 }] }}
      />
    );

    expect(screen.getByRole("grid", { name: "Writing heatmap" })).toBeInTheDocument();
    expect(day(`${YEAR}-01-01`, 5)).toBeInTheDocument();
  });

  it("moves focus between days with the arrow keys and names the focused day", async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <Heatmap
        isLoading={false}
        aggregate={{
          days: [
            { date: `${YEAR}-01-01`, words: 5, events: 1 },
            { date: `${YEAR}-01-08`, words: 9, events: 1 },
          ],
        }}
      />
    );
    stubCellRects();

    const first = day(`${YEAR}-01-01`, 5);
    first.focus();
    expect(first).toHaveFocus();

    // Left/Right move across weeks (the same weekday of the next week).
    await user.keyboard("{ArrowRight}");
    expect(day(`${YEAR}-01-08`, 9)).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(first).toHaveFocus();

    // Up/Down move within the week (the next day of the same column).
    await user.keyboard("{ArrowDown}");
    expect(day(`${YEAR}-01-02`, 0)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
  }, 20_000);
});
