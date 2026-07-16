import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DictionaryPromptDialog } from "@/components/editor/DictionaryPromptDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderDialog(overrides: Partial<Parameters<typeof DictionaryPromptDialog>[0]> = {}) {
  const props = {
    isOpen: true,
    defaultLanguage: "en" as const,
    openInBrowser: false,
    onOpenInBrowserChange: vi.fn(),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  render(<DictionaryPromptDialog {...props} />);
  return props;
}

describe("DictionaryPromptDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByLabelText("dictionary.wordLabel")).toBeNull();
  });

  it("autofocuses the word input on open", () => {
    renderDialog();
    expect(screen.getByLabelText("dictionary.wordLabel")).toHaveFocus();
  });

  it("disables the submit button when the input is blank", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "dictionary.lookUp" })).toBeDisabled();
  });

  it("keeps submit disabled for whitespace-only input", () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("dictionary.wordLabel"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "dictionary.lookUp" })).toBeDisabled();
  });

  it("submits the trimmed word with the default language and closes", () => {
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("dictionary.wordLabel"), {
      target: { value: "  hello  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "dictionary.lookUp" }));
    expect(props.onSubmit).toHaveBeenCalledWith("hello", "en");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("submits when Enter is pressed in the input", () => {
    const props = renderDialog();
    const input = screen.getByLabelText("dictionary.wordLabel");
    fireEvent.change(input, { target: { value: "hola" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(props.onSubmit).toHaveBeenCalledWith("hola", "en");
  });

  it("seeds the language from defaultLanguage", () => {
    const props = renderDialog({ defaultLanguage: "es" });
    fireEvent.change(screen.getByLabelText("dictionary.wordLabel"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "dictionary.lookUp" }));
    expect(props.onSubmit).toHaveBeenCalledWith("hola", "es");
  });

  it("submits the language chosen in the Select", async () => {
    const user = userEvent.setup();
    const props = renderDialog();
    fireEvent.change(screen.getByLabelText("dictionary.wordLabel"), { target: { value: "hola" } });
    await user.click(screen.getByRole("button", { name: /dictionary.languageLabel/ }));
    await user.click(screen.getByRole("option", { name: "Español" }));
    fireEvent.click(screen.getByRole("button", { name: "dictionary.lookUp" }));
    expect(props.onSubmit).toHaveBeenCalledWith("hola", "es");
  });

  it("toggles the persisted open-in-browser switch", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("switch", { name: "settings.dictionaryOpenInBrowser" }));
    expect(props.onOpenInBrowserChange).toHaveBeenCalledWith(true);
  });
});
