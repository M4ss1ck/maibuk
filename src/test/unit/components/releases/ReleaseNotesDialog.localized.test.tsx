// The localized Release Notes read the real i18n instance, so this file cannot
// live beside ReleaseNotesDialog.test.tsx, whose `vi.mock("react-i18next")` is
// hoisted for its whole module. The behavior under test is a language switch,
// which only the real instance can make.

import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { ReleaseNotesDialog } from "@/components/releases/ReleaseNotesDialog";
import { useReleaseStore } from "@/features/releases/store";

function article(dialog: HTMLElement, release: string): HTMLElement {
  const found = within(dialog)
    .getAllByRole("article")
    .find((article) => within(article).getByRole("heading", { level: 3 }).textContent === release);
  if (!found) throw new Error(`Release ${release} is not in the dialog`);
  return found;
}

const SPANISH = /pantalla de inicio usa el tema seleccionado/;
const ENGLISH = /Startup screen uses the selected theme/;

function renderOpenDialog(): HTMLElement {
  useReleaseStore.setState({ newerReleases: [], isNotesOpen: true });
  render(<ReleaseNotesDialog />);
  return screen.getByRole("dialog");
}

beforeEach(async () => {
  useReleaseStore.setState({ newerReleases: [], isNotesOpen: false });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Release Notes dialog in the app language", () => {
  it("renders the Spanish bullets of the bundled Releases", async () => {
    await i18n.changeLanguage("es");
    const dialog = renderOpenDialog();

    const latest = await within(dialog).findByRole("article", { name: /0\.15\.2/ });
    expect(await within(latest).findByText(SPANISH)).toBeInTheDocument();
    expect(within(latest).queryByText(ENGLISH)).not.toBeInTheDocument();

    const previous = article(dialog, "0.15.1");
    expect(
      within(previous).getByText(
        /Muestra un marcador de advertencia y el motivo de los Plugins detenidos/
      )
    ).toBeInTheDocument();
  });

  it("swaps the notes when the app language changes with the dialog open", async () => {
    const dialog = renderOpenDialog();
    expect(await within(article(dialog, "0.15.2")).findByText(ENGLISH)).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("es");
    });

    expect(await within(article(dialog, "0.15.2")).findByText(SPANISH)).toBeInTheDocument();
    expect(within(article(dialog, "0.15.2")).queryByText(ENGLISH)).not.toBeInTheDocument();
  });

  it("renders English for a language with no changelog file", async () => {
    await i18n.changeLanguage("fr-FR");
    const dialog = renderOpenDialog();

    expect(await within(article(dialog, "0.15.2")).findByText(ENGLISH)).toBeInTheDocument();
    expect(within(article(dialog, "0.15.2")).queryByText(SPANISH)).not.toBeInTheDocument();
  });
});
