// Metrics (issue #214): the numbers an author reads on a controlled clock, a
// Streak that breaks when a day is skipped, and the keyboard-operable Heatmap
// (issue #214's confirmed gap). The `metricsHistory` seed writes three days of
// events; the spec pins the clock so the aggregates are deterministic.

import type { Page } from "@playwright/test";
import { tabTo } from "../support/keyboard";
import { SEED_BOOK } from "../support/seed/names";
import { seedSettings } from "../support/storage";
import { expect, test } from "../support/test";

test.use({ library: "metricsHistory" });

const metricsMain = (page: Page) => page.getByRole("main", { name: "Main content" });

function card(page: Page, label: string) {
  return metricsMain(page).getByText(label).locator("..");
}

function sectionWithHeading(page: Page, heading: string) {
  return metricsMain(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading }) });
}

async function openMetrics(page: Page) {
  await page.goto("/metrics");
  await expect(page.getByRole("heading", { name: "Metrics", level: 1 })).toBeVisible();
}

test.describe("Metrics collection @wf:metrics-collect", () => {
  test("three written days show totals, WPM, Streak, time of day, and per-book time", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await openMetrics(page);

    await expect(card(page, "Total words")).toContainText("1,200");
    await expect(card(page, "Current streak")).toContainText("3");
    await expect(card(page, "Longest streak")).toContainText("3");
    await expect(card(page, "Days this week")).toContainText("3");
    await expect(card(page, "Days this month")).toContainText("3");

    const wpm = sectionWithHeading(page, "Words per minute");
    await expect(wpm).toContainText("30");
    await expect(wpm).toContainText("1,200");

    const timeOfDay = sectionWithHeading(page, "Time of day");
    await expect(timeOfDay).toContainText("08:00");
    await expect(timeOfDay).toContainText("09:00");
    await expect(timeOfDay).toContainText("14:00");

    const perBook = sectionWithHeading(page, "Per book");
    await expect(perBook).toContainText(SEED_BOOK.title);
    await expect(perBook).toContainText("1,200 words");
    await expect(perBook).toContainText("40m");

    await page.reload();
    await expect(card(page, "Total words")).toContainText("1,200");
    await expect(card(page, "Current streak")).toContainText("3");
  });

  test("with every category disabled the page shows the disabled empty state", async ({ page }) => {
    await seedSettings(page, {
      metrics: {
        enabled: { writing: false, time: false, engagement: false },
        syncMetrics: false,
        streakDailyWordThreshold: 50,
        idleThresholdSec: 30,
      },
    });
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await openMetrics(page);

    await expect(metricsMain(page).getByText(/Metrics collection is disabled/)).toBeVisible();
    await expect(metricsMain(page).getByRole("grid", { name: "Writing heatmap" })).toHaveCount(0);
  });
});

test.describe("Metrics Streak break @wf:metrics-streak-break", () => {
  test("skipping a day resets the current streak while the longest is kept", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await openMetrics(page);
    await expect(card(page, "Current streak")).toContainText("3");
    await expect(card(page, "Longest streak")).toContainText("3");

    // Skip 2026-06-16 entirely; the run no longer reaches today.
    await page.clock.setFixedTime(new Date("2026-06-17T12:00:00Z"));
    await page.reload();

    await expect(card(page, "Current streak")).toContainText("0");
    await expect(card(page, "Longest streak")).toContainText("3");
  });
});

test.describe("Writing heatmap @wf:metrics-heatmap", () => {
  test("one Tab stop; arrows move by day and week; the focused day names its words", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-06-15T12:00:00Z") });
    await openMetrics(page);

    await expect(page.getByRole("grid", { name: "Writing heatmap" })).toBeVisible();
    const cell = (label: string) => page.getByRole("row", { name: label, exact: true });
    const jan1 = cell("2026-01-01: 0 words");

    await tabTo(page, jan1);
    await expect(jan1).toBeFocused();

    // A single tab stop: Tab leaves the grid rather than moving day to day.
    await page.keyboard.press("Tab");
    await expect(jan1).not.toBeFocused();
    await tabTo(page, jan1);
    await expect(jan1).toBeFocused();

    // Left/Right move across weeks (the same day of the next week).
    await page.keyboard.press("ArrowRight");
    await expect(cell("2026-01-08: 0 words")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(jan1).toBeFocused();

    // Up/Down move within the week (the next day of the same week).
    await page.keyboard.press("ArrowDown");
    await expect(cell("2026-01-02: 0 words")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(jan1).toBeFocused();

    // Walk to 2026-06-15 (week 23, day 4): its Tooltip text is its name.
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
    for (let i = 0; i < 23; i++) await page.keyboard.press("ArrowRight");
    await expect(cell("2026-06-15: 500 words")).toBeFocused();
  });

  test("an empty year reads every day as 0 words", async ({ page }) => {
    await page.clock.install({ time: new Date("2027-03-10T12:00:00Z") });
    await openMetrics(page);

    const jan1 = page.getByRole("row", { name: "2027-01-01: 0 words", exact: true });
    await tabTo(page, jan1);
    await expect(jan1).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("row", { name: "2027-01-02: 0 words", exact: true })).toBeFocused();
  });
});
