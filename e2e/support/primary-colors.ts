import type { Locator } from "@playwright/test";

/** Read a button's rendered colors beside the current primary color tokens. */
export function primaryButtonColors(button: Locator) {
  return button.evaluate((element) => {
    const sample = document.createElement("div");
    sample.style.backgroundColor = "var(--color-primary)";
    sample.style.color = "var(--color-primary-foreground)";
    document.body.append(sample);
    const actual = getComputedStyle(element);
    const expected = getComputedStyle(sample);
    const colors = {
      background: actual.backgroundColor,
      foreground: actual.color,
      primaryBackground: expected.backgroundColor,
      primaryForeground: expected.color,
    };
    sample.remove();
    return colors;
  });
}
