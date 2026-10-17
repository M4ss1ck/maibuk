import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Puzzle } from "lucide-react";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import type { InlineIcon } from "@/features/plugins/inline-icon";

const highlighterE: InlineIcon = {
  elements: [
    ["path", { d: "M4 20h16" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
};

describe("PluginIcon with inline elements (#531)", () => {
  it("renders the elements in a 24 grid svg with the app icon attributes", () => {
    const { container } = render(<PluginIcon icon={highlighterE} className="h-4 w-4" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("class")).toBe("h-4 w-4");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("2");
    expect(svg?.getAttribute("stroke-linecap")).toBe("round");
    expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M4 20h16");
    expect(svg?.querySelector("circle")?.getAttribute("r")).toBe("3");
  });

  it("drops any tag or attribute the allowlist does not hold, even if it reached the renderer", () => {
    const { container } = render(
      <PluginIcon
        icon={{
          elements: [
            ["script", { d: "x" }],
            ["path", { d: "M0 0", onload: "alert(1)", style: "fill:red" }],
          ],
        }}
      />
    );
    expect(container.querySelector("script")).toBeNull();
    const path = container.querySelector("svg path");
    expect(path?.getAttribute("d")).toBe("M0 0");
    expect(path?.hasAttribute("onload")).toBe(false);
    expect(path?.hasAttribute("style")).toBe(false);
  });

  it("keeps the generic Plugin icon for a relative .svg path", () => {
    const { container } = render(<PluginIcon icon="icons/echo.svg" />);
    const generic = render(<Puzzle />).container;
    expect(container.innerHTML).toBe(generic.innerHTML);
  });
});
