import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PagePaddingControl } = await import("../../../../components/editor/PagePaddingControl");

describe("PagePaddingControl", () => {
  it("renders the simple slider and value", () => {
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("slider")).toHaveAttribute("max", "96");
    expect(screen.getByText("32px")).toBeInTheDocument();
  });

  it("calls onChange with a number when the simple slider moves", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "64" } });
    expect(onChange).toHaveBeenCalledWith(64);
  });

  it("shows Custom placeholder when sides differ", () => {
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 48, bottom: 32, left: 32 }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText("editor.paddingCustom")).toBeInTheDocument();
  });

  it("expands custom mode and updates a single side", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("editor.customizePadding"));
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(4);
    fireEvent.change(sliders[0], { target: { value: "48" } });
    expect(onChange).toHaveBeenCalledWith({ top: 48 });
  });

  it("calls onChange with the clamped value when the simple input is edited and Enter is pressed", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("32px"));
    const input = screen.getByLabelText("editor.pagePadding px");
    fireEvent.input(input, { target: { value: "64" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(64);
  });

  it("reverts the simple input and does not call onChange when Escape is pressed", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("32px"));
    const input = screen.getByLabelText("editor.pagePadding px");
    fireEvent.input(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("32px")).toBeInTheDocument();
  });

  it("reverts the simple input to the original value when cleared and blurred", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("32px"));
    const input = screen.getByLabelText("editor.pagePadding px");
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("32px")).toBeInTheDocument();
  });

  it("reverts the simple input to the placeholder when custom padding is cleared and blurred", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 48, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("editor.paddingCustom"));
    const input = screen.getByPlaceholderText("editor.paddingCustom");
    fireEvent.input(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("editor.paddingCustom")).toBeInTheDocument();
  });

  it("clamps simple input values above the maximum to the maximum", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("32px"));
    const input = screen.getByLabelText("editor.pagePadding px");
    fireEvent.input(input, { target: { value: "120" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(96);
  });

  it("clamps simple input values below the minimum to the minimum", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("32px"));
    const input = screen.getByLabelText("editor.pagePadding px");
    fireEvent.input(input, { target: { value: "-5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("calls onChange with the clamped side value when a custom side input is edited and Enter is pressed", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText("editor.customizePadding"));
    fireEvent.click(screen.getByLabelText("editor.pagePaddingTop px"));
    const input = screen.getByLabelText("editor.pagePaddingTop px");
    fireEvent.input(input, { target: { value: "56" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ top: 56 });
  });
});
