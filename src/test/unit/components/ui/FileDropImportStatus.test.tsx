import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FileDropImportStatus } from "@/components/ui/FileDropImportStatus";
import i18n from "@/i18n";

describe("FileDropImportStatus", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("announces the localized import status", async () => {
    await i18n.changeLanguage("es");

    render(<FileDropImportStatus />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Importando archivos…");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.parentElement).toHaveClass("sticky", "h-0");
    expect(status).not.toHaveClass("absolute");
  });
});
