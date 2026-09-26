import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PaintControl } from "@/components/cover-editor/panels/PaintControl";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe("PaintControl color selection", () => {
  it("sets a solid color through the shared keyboard picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PaintControl paint={{ type: "solid", color: "#1a1a2e" }} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "cover.paint.color" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#f50{Enter}");
    expect(onChange).toHaveBeenCalledWith({ type: "solid", color: "#FF5500" });
  });
  it("edits one gradient stop without changing the others", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PaintControl
        paint={{
          type: "linear-gradient",
          angle: 90,
          stops: [
            { offset: 0, color: "#111111" },
            { offset: 1, color: "#EEEEEE" },
          ],
        }}
        onChange={onChange}
      />
    );
    const trigger = screen.getAllByRole("button", { name: "cover.paint.stopColor" })[0];
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#f50{Enter}");
    expect(onChange).toHaveBeenCalledWith({
      type: "linear-gradient",
      angle: 90,
      stops: [
        { offset: 0, color: "#FF5500" },
        { offset: 1, color: "#EEEEEE" },
      ],
    });
  });
});
