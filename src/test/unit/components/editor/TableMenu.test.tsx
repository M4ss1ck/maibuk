import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TableMenu } from "@/components/editor/TableMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeEditor(inTable: boolean) {
  const can = {
    addColumnBefore: () => inTable,
    addColumnAfter: () => inTable,
    addRowBefore: () => inTable,
    addRowAfter: () => inTable,
    deleteColumn: () => inTable,
    deleteRow: () => inTable,
    deleteTable: () => inTable,
  };
  return {
    isActive: (name: string) => name === "table" && inTable,
    can: () => can,
    chain: () => ({
      focus: () => ({ insertTable: () => ({ run: () => {} }) }),
    }),
  } as unknown as import("@tiptap/react").Editor;
}

describe("TableMenu", () => {
  it("keeps every control mounted outside a table, with edit actions disabled", () => {
    render(<TableMenu editor={makeEditor(false)} />);
    expect(screen.getByLabelText("editor.insertTable")).toBeEnabled();
    expect(screen.getByLabelText("editor.addColumnBefore")).toBeDisabled();
    expect(screen.getByLabelText("editor.deleteTable")).toBeDisabled();
  });

  it("disables insert and enables edit actions inside a table", () => {
    render(<TableMenu editor={makeEditor(true)} />);
    expect(screen.getByLabelText("editor.insertTable")).toBeDisabled();
    expect(screen.getByLabelText("editor.addColumnBefore")).toBeEnabled();
    expect(screen.getByLabelText("editor.deleteTable")).toBeEnabled();
  });

  it("closes the size picker on Escape and restores focus to the insert button", async () => {
    const user = userEvent.setup();
    render(<TableMenu editor={makeEditor(false)} />);

    const insertButton = screen.getByLabelText("editor.insertTable");
    await user.click(insertButton);
    expect(screen.getByTestId("table-size-5-5")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("table-size-5-5")).not.toBeInTheDocument();
    expect(insertButton).toHaveFocus();
  });

  it("stops Escape propagation so an outer window Escape handler is not invoked", async () => {
    const user = userEvent.setup();
    const outerEscapeSpy = vi.fn();
    window.addEventListener("keydown", outerEscapeSpy);
    try {
      render(<TableMenu editor={makeEditor(false)} />);

      await user.click(screen.getByLabelText("editor.insertTable"));
      expect(screen.getByTestId("table-size-5-5")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(screen.queryByTestId("table-size-5-5")).not.toBeInTheDocument();
      expect(outerEscapeSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEscapeSpy);
    }
  });
});
