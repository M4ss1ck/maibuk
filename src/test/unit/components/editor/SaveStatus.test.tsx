import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SaveStatus } from "@/components/editor/SaveStatus";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("SaveStatus", () => {
  it("shows a save button when idle and calls onSave when clicked", () => {
    const onSave = vi.fn();
    render(<SaveStatus status="idle" onSave={onSave} />);

    const button = screen.getByRole("button");
    fireEvent.click(button);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("disables the save button when disabled", () => {
    render(<SaveStatus status="idle" onSave={vi.fn()} disabled />);

    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows the saving indicator and no button while saving", () => {
    render(<SaveStatus status="saving" onSave={vi.fn()} />);

    expect(screen.getByText("editor.saving")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the saved indicator when saved", () => {
    render(<SaveStatus status="saved" onSave={vi.fn()} />);

    expect(screen.getByText("editor.saved")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
