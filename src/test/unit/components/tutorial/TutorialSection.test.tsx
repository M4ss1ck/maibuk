import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialSection } from "@/components/settings/TutorialSection";
import i18n from "@/i18n";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

vi.mock("@/features/tutorial/controller", () => ({ requestTutorial: vi.fn() }));

afterEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});

describe("Tutorial section localization", () => {
  it("updates every section name and step count when the language changes", async () => {
    await i18n.changeLanguage("en");
    render(<TutorialSection />);
    for (const name of Object.values(en.tutorial.sections)) {
      expect(screen.getByRole("option", { name: new RegExp(`^${name} ·`) })).toBeVisible();
    }

    await act(() => i18n.changeLanguage("es"));
    for (const name of Object.values(es.tutorial.sections)) {
      expect(screen.getByRole("option", { name: new RegExp(`^${name} ·`) })).toHaveTextContent(
        /\d+ pasos/
      );
    }

    await act(() => i18n.changeLanguage("en"));
    for (const name of Object.values(en.tutorial.sections)) {
      expect(screen.getByRole("option", { name: new RegExp(`^${name} ·`) })).toHaveTextContent(
        /\d+ steps/
      );
    }
  });
});
