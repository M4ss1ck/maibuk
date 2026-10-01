import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "@/components/settings/SettingsSection";

describe("SettingsSection", () => {
  it("renders the card with a focusable h2 the outline finds, and its description", () => {
    render(
      <SettingsSection sectionId="general" title="General" description="Everyday choices">
        <div>Row one</div>
        <div>Row two</div>
      </SettingsSection>
    );
    const heading = screen.getByRole("heading", { level: 2, name: "General" });
    expect(heading).toHaveAttribute("data-settings-section", "general");
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveClass("text-primary");
    expect(screen.getByText("Everyday choices")).toBeInTheDocument();
    expect(screen.getByText("Row one").parentElement).toHaveClass("divide-y");
  });

  it("keeps a hidden title for screen readers and the outline", () => {
    render(
      <SettingsSection sectionId="about" title="About" titleHidden>
        <div>Banner</div>
      </SettingsSection>
    );
    expect(screen.getByRole("heading", { name: "About" })).toHaveClass("sr-only");
  });

  it("wraps the title in a disclosure and renders no rows while collapsed", async () => {
    const user = userEvent.setup();
    function Collapsible() {
      return (
        <SettingsSection
          sectionId="advanced"
          title="Advanced"
          tone="destructive"
          renderTitle={(heading) => (
            <button type="button" aria-expanded={false}>
              {heading}
            </button>
          )}
        >
          {false}
        </SettingsSection>
      );
    }
    const { container } = render(<Collapsible />);
    const heading = screen.getByRole("heading", { name: "Advanced" });
    expect(heading).toHaveClass("text-destructive");
    expect(heading.closest("button")).not.toBeNull();
    expect(container.querySelector(".divide-y")).toBeNull();
    await user.tab();
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveFocus();
  });

  it("passes section attributes through, such as a Tutorial anchor", () => {
    render(
      <SettingsSection
        sectionId="dictation"
        id="dictation"
        title="Dictation"
        data-tutorial="settings.dictation"
        titleAttributes={{ "data-tutorial": "dictation.overview" }}
      >
        <div>Row</div>
      </SettingsSection>
    );
    const section = document.getElementById("dictation");
    expect(section?.tagName).toBe("SECTION");
    expect(section).toHaveAttribute("data-tutorial", "settings.dictation");
    expect(screen.getByRole("heading", { name: "Dictation" })).toHaveAttribute(
      "data-tutorial",
      "dictation.overview"
    );
  });
});
