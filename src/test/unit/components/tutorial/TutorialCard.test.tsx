import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TutorialCard, type TutorialCardProps } from "@/components/tutorial/TutorialCard";
import "@/i18n";

const step: TutorialCardProps["step"] = {
  id: "settings.sync",
  titleKey: "tutorial.steps.settings.sync.title",
  bodyKey: "tutorial.steps.settings.sync.body",
  image: { src: "/sync.png", altKey: "tutorial.steps.settings.sync.link" },
  link: { href: "https://example.com/download", labelKey: "tutorial.steps.settings.sync.link" },
  terms: [],
};

function renderCard(overrides: Partial<TutorialCardProps> = {}) {
  const props: TutorialCardProps = {
    step,
    sectionName: "Settings",
    stepNumber: 4,
    stepCount: 9,
    canGoBack: true,
    isLast: false,
    onBack: vi.fn(),
    onNext: vi.fn(),
    onSkip: vi.fn(),
    ...overrides,
  };
  render(<TutorialCard {...props} />);
  return props;
}

describe("TutorialCard", () => {
  it("is a dialog named by its title and described by its text, holding focus", () => {
    renderCard();
    const dialog = screen.getByRole("dialog", { name: "Sync" });
    expect(dialog).toHaveAccessibleDescription(/Sync Account signs you in/);
    expect(dialog).toHaveTextContent("Settings");
    expect(dialog).toHaveTextContent("Step 4 of 9");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("shows a step's image and opens its link in a new window", () => {
    renderCard();
    expect(screen.getByRole("img", { name: "Get Maibuk for your other devices" })).toHaveAttribute(
      "src",
      "/sync.png"
    );
    const link = screen.getByRole("link", { name: "Get Maibuk for your other devices" });
    expect(link).toHaveAttribute("href", "https://example.com/download");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("drives Skip, Back and Next from the keyboard, in reading order", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      await user.tab();
      order.push(document.activeElement?.textContent ?? "");
    }
    expect(order).toEqual(["Get Maibuk for your other devices", "Skip", "Back", "Next"]);

    const press = async (name: string, key: string) => {
      screen.getByRole("button", { name }).focus();
      await user.keyboard(key);
    };
    await press("Skip", "{Enter}");
    await press("Back", " ");
    await press("Next", "{Enter}");
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("opens with focus on Next, so Enter and Space walk through the steps", async () => {
    const user = userEvent.setup();
    const props = renderCard();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(props.onNext).toHaveBeenCalledTimes(2);
    expect(props.onBack).not.toHaveBeenCalled();
    expect(props.onSkip).not.toHaveBeenCalled();
  });

  it("opens with focus on Finish on the last step", async () => {
    const user = userEvent.setup();
    const props = renderCard({ isLast: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Finish" }));
    await user.keyboard("{Enter}");
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it("says Finish on the last step and has no Back on the first", () => {
    renderCard({ isLast: true, canGoBack: false });
    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});
