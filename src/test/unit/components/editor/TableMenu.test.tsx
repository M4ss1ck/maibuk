import { render, screen } from "@testing-library/react";
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
});
