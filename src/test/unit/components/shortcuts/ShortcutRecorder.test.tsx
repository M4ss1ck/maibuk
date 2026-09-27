import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShortcutRecorder } from "@/components/shortcuts/ShortcutRecorder";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/platform/target", () => ({ IS_WEB: true }));
vi.mock("@/lib/platform/detect", () => ({ isMac: () => false }));

describe("ShortcutRecorder on web", () => {
  it("refuses a browser-reserved key and announces why", async () => {
    const user = userEvent.setup();
    const onRecord = vi.fn();
    const announce = vi.fn();
    render(
      <ShortcutRecorder
        commandLabel="New Book"
        validate={() => null}
        onRecord={onRecord}
        onCancel={vi.fn()}
        announce={announce}
      />
    );

    const input = screen.getByRole("textbox", { name: "shortcutEditor.recorder.label" });
    input.focus();
    await user.keyboard("{Control>}n{/Control}{Enter}");

    expect(onRecord).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("shortcutEditor.recorder.reserved");
    expect(screen.getByText("shortcutEditor.recorder.reserved")).toBeInTheDocument();
    expect(input).toHaveFocus();
  });
});
