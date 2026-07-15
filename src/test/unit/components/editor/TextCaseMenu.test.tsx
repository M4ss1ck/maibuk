import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextCaseMenu } from "@/components/editor/TextCaseMenu";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

let editor: Editor | null = null;

function renderMenu(content = "<p>Hello!</p>") {
  editor = new Editor({ extensions: [StarterKit], content });
  editor.commands.selectAll();
  render(<TextCaseMenu editor={editor} />);
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("TextCaseMenu keyboard behavior", () => {
  it.each([
    ["alternating case", "<p>Hello!</p>", 0, "hElLo!"],
    ["sentence case", "<p>hELLO! wORLD</p>", 1, "Hello! World"],
    ["title case", "<p>hELLO wORLD</p>", 2, "Hello World"],
    ["horizontal mirror", "<p>abc!</p>", 3, "!ɔdɒ"],
    ["upside down", "<p>Hello!</p>", 4, "¡ollǝH"],
    ["reverse text", "<p>Hello!</p>", 5, "!olleH"],
    ["leetspeak", "<p>A test</p>", 6, "4 7357"],
  ])("runs %s with the keyboard", async (_name, content, arrowPresses, expected) => {
    const user = userEvent.setup();
    const instance = renderMenu(content);
    const trigger = screen.getByRole("button", { name: "editor.textCase" });

    trigger.focus();
    await user.keyboard("{Enter}");
    const firstItem = await screen.findByRole("menuitem", {
      name: "editor.alternatingCase",
    });
    expect(firstItem).toHaveFocus();

    await user.keyboard(`${"{ArrowDown}".repeat(arrowPresses)}{Enter}`);

    expect(instance.getText()).toBe(expected);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each([
    ["editor.uppercase", "HELLO"],
    ["editor.lowercase", "hello"],
  ])("runs %s from the keyboard", async (label, expected) => {
    const user = userEvent.setup();
    const instance = renderMenu("<p>Hello</p>");
    const button = screen.getByRole("button", { name: label });

    button.focus();
    await user.keyboard("{Enter}");

    expect(instance.getText()).toBe(expected);
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "editor.textCase" });

    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toHaveClass("border-muted");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
