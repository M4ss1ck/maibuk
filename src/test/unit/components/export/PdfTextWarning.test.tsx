import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePdfTextWarning } from "@/components/export/PdfTextWarning";

// The guard before a PDF export whose text the built-in fonts cannot render
// (issue #706): clean text runs at once, unsupported text warns first and runs
// only from Continue, and every dismissal leaves it unrun.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "common.close": "Close",
        "export.pdfTextWarning.title": "Some text may be unreadable in this PDF",
        "export.pdfTextWarning.body":
          "The PDF's built-in fonts can't show some characters in this text, so they would come out garbled. EPUB and Markdown exports keep them readable.",
        "export.pdfTextWarning.continue": "Export PDF anyway",
        "export.pdfTextWarning.cancel": "Cancel",
      };
      return translations[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const POLISH = "Zażółć gęślą jaźń";

function Harness({ text, run }: { text: string; run: () => void }) {
  const { guardPdfText, pdfTextWarning } = usePdfTextWarning();
  return (
    <>
      <button type="button" onClick={() => guardPdfText(text, run)}>
        Export PDF
      </button>
      {pdfTextWarning}
    </>
  );
}

async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let i = 0; i < 10 && document.activeElement !== target; i++) {
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

describe("usePdfTextWarning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs at once for English text and shows no warning", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text="The tide came in" run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("runs at once for Spanish text and shows no warning", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text="¡Hola! ¿Qué tal? El niño comió piña." run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns for text the built-in fonts cannot render and runs nothing", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    await user.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });

  it("lands focus in the dialog and runs exactly once from Continue by keyboard", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    await tabTo(user, within(dialog).getByRole("button", { name: "Export PDF anyway" }));
    await user.keyboard("{Enter}");

    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("runs nothing on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("runs nothing on Cancel and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    render(<Harness text={POLISH} run={run} />);

    const trigger = screen.getByRole("button", { name: "Export PDF" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    await tabTo(user, within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(run).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });
});
