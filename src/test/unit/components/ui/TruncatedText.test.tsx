import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TruncatedText } from "../../../../components/ui/TruncatedText";

/** Force the next-rendered element to report the given overflow geometry. */
function stubGeometry(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(
    scrollWidth,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    clientWidth,
  );
}

describe("TruncatedText", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets a title tooltip when the text overflows", () => {
    stubGeometry(200, 100);
    render(<TruncatedText text="A very long chapter name" />);

    expect(screen.getByText("A very long chapter name")).toHaveAttribute(
      "title",
      "A very long chapter name",
    );
  });

  it("omits the title when the text fits", () => {
    stubGeometry(80, 100);
    render(<TruncatedText text="Short" />);

    expect(screen.getByText("Short")).not.toHaveAttribute("title");
  });

  it("renders the requested element", () => {
    stubGeometry(80, 100);
    render(<TruncatedText as="h1" text="Book" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Book");
  });
});
