import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const { toggle } = vi.hoisted(() => ({ toggle: vi.fn(async () => {}) }));
vi.mock("@/features/dictation/runtime", () => ({
  getDictation: async () => ({ session: { toggle }, setNotifier: vi.fn() }),
}));

const { GlobalShortcuts } = await import("@/components/GlobalShortcuts");
const { useBoundShortcutStore } = await import("@/lib/bound-shortcuts");

describe("dictation.toggle", () => {
  it("is bound globally and fires from inside a text field", async () => {
    const user = userEvent.setup();
    const { getByRole } = render(
      <MemoryRouter>
        <GlobalShortcuts />
        <textarea aria-label="writing" />
      </MemoryRouter>,
    );
    await vi.waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["dictation.toggle"],
      ).toBeGreaterThan(0),
    );
    getByRole("textbox").focus();
    await user.keyboard("{Control>}{Shift>} {/Shift}{/Control}");
    await vi.waitFor(() => expect(toggle).toHaveBeenCalledTimes(1));
  });
});
