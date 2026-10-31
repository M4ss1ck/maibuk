import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebLibraryGate } from "@/components/library/WebLibraryGate";
import "@/i18n";

/**
 * The three web Library states the author can meet (ADR 0035). Playwright can
 * preview neither a private window nor a failed move, so the in-memory notice
 * and the migration-failed notices are proven here and by the locked screen's
 * E2E row.
 */

describe("WebLibraryGate", () => {
  it("never opens the app in a tab another tab's Library owns", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "locked" });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    expect(
      await screen.findByRole("heading", { name: "Maibuk is open in another tab" })
    ).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("focuses Try again, and pressing it re-runs the lock check", async () => {
    const user = userEvent.setup();
    const open = vi
      .fn()
      .mockResolvedValueOnce({ kind: "locked" })
      .mockResolvedValueOnce({ kind: "opfs" });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(retry).toHaveFocus());

    await user.keyboard("{Enter}");

    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Maibuk is open in another tab" })
    ).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("stays on the locked screen while the other tab still holds the Library", async () => {
    const user = userEvent.setup();
    const open = vi.fn().mockResolvedValue({ kind: "locked" });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    const retry = await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(retry).toHaveFocus());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("heading", { name: "Maibuk is open in another tab" })
    ).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus());
  });

  it("shows the app with no notice when the Library is on OPFS", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "opfs" });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells the author that a Library the browser cannot keep will not be kept", async () => {
    const open = vi.fn().mockResolvedValue({ kind: "memory" });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Your Library will not be kept");
    expect(notice).toHaveTextContent("is lost when you reload or close this window");
  });

  it("shows the old data with an error when the move failed, and says nothing changed", async () => {
    const open = vi.fn().mockResolvedValue({
      kind: "migration-failed",
      error: { code: "migration-failed", message: "importDb failed" },
    });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Your Library could not be moved");
    expect(notice).toHaveTextContent("nothing was changed");
    expect(notice).not.toHaveTextContent("not enough storage space");
  });

  it("gives a full storage quota its own message", async () => {
    const open = vi.fn().mockResolvedValue({
      kind: "migration-failed",
      error: { code: "quota-exceeded", message: "QuotaExceededError" },
    });
    render(
      <WebLibraryGate open={open}>
        <p>the app</p>
      </WebLibraryGate>
    );

    expect(await screen.findByText("the app")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("not enough storage space");
  });
});
