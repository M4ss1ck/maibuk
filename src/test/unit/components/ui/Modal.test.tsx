import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
}));

beforeAll(() => {
  if (typeof globalThis.requestAnimationFrame === "undefined") {
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      return setTimeout(cb, 0) as unknown as number;
    };
    globalThis.cancelAnimationFrame = (id: number) => {
      clearTimeout(id);
    };
  }
});

const modalTranslations = {
  en: { "common.close": "Close" },
  es: { "common.close": "Cerrar" },
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const lang = i18nState.language;
      return (modalTranslations as Record<string, Record<string, string>>)[lang]?.[key] ?? key;
    },
    i18n: { language: i18nState.language },
  }),
}));

import { Modal } from "@/components/ui/Modal";
import { useModalStore } from "@/components/ui/modal-store";

describe("Modal modal scope registration", () => {
  beforeEach(() => {
    i18nState.language = "en";
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("registers in the modal store when opened and unregisters on close", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal isOpen={open} onClose={() => setOpen(false)} title="Scope Test">
            <p>Content</p>
          </Modal>
        </div>
      );
    }

    render(<Harness />);
    expect(useModalStore.getState().openCount).toBe(0);

    await user.click(screen.getByTestId("trigger"));

    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().modalIds).toHaveLength(1);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(useModalStore.getState().openCount).toBe(0);
    });
  });

  it("nested modals accumulate and close independently", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [outerOpen, setOuterOpen] = useState(false);
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <div>
          <button type="button" data-testid="outer-trigger" onClick={() => setOuterOpen(true)}>
            Open Outer
          </button>
          <Modal isOpen={outerOpen} onClose={() => setOuterOpen(false)} title="Outer">
            <button type="button" data-testid="inner-trigger" onClick={() => setInnerOpen(true)}>
              Open Inner
            </button>
            <Modal isOpen={innerOpen} onClose={() => setInnerOpen(false)} title="Inner">
              <p>Nested</p>
            </Modal>
          </Modal>
        </div>
      );
    }

    render(<Harness />);

    await user.click(screen.getByTestId("outer-trigger"));
    expect(useModalStore.getState().openCount).toBe(1);

    await user.click(screen.getByTestId("inner-trigger"));
    await waitFor(() => {
      expect(useModalStore.getState().openCount).toBe(2);
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(useModalStore.getState().openCount).toBe(1);
    });

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(useModalStore.getState().openCount).toBe(0);
    });
  });
});

describe("Modal", () => {
  beforeEach(() => {
    i18nState.language = "en";
  });

  describe("visibility", () => {
    it("renders nothing when isOpen is false", () => {
      const { container } = render(
        <Modal isOpen={false} onClose={() => {}} title="Test">
          <p>Content</p>
        </Modal>
      );
      expect(container.innerHTML).toBe("");
    });

    it("renders modal content when isOpen is true", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="My Modal">
          <p>Hello World</p>
        </Modal>
      );
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });
  });

  describe("title", () => {
    it("renders the title text", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Dialog Title">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText("Dialog Title")).toBeInTheDocument();
    });

    it("has dialog role with accessible label", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Accessible">
          <p>Content</p>
        </Modal>
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-labelledby");
      const labelledby = dialog.getAttribute("aria-labelledby");
      expect(labelledby).toBeTruthy();
      const titleElement = document.getElementById(labelledby!);
      expect(titleElement).toBeInTheDocument();
      expect(titleElement).toHaveTextContent("Accessible");
    });

    it("supports a wide layout for dense tool panels", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Wide" size="wide">
          <p>Content</p>
        </Modal>
      );
      expect(document.querySelector(".sm\\:max-w-5xl")).not.toBeNull();
    });
  });

  describe("close behavior", () => {
    it("calls onClose when close button is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={onClose} title="Close Test">
          <p>Content</p>
        </Modal>
      );

      await user.click(screen.getByRole("button", { name: "Close" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when backdrop is clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={onClose} title="Backdrop Test">
          <p>Content</p>
        </Modal>
      );

      const backdrop = document.querySelector(".bg-black\\/50") as HTMLElement;
      expect(backdrop).not.toBeNull();
      await user.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when Escape key is pressed", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={onClose} title="Escape Test">
          <p>Content</p>
        </Modal>
      );

      await user.keyboard("{Escape}");

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("footer", () => {
    it("renders footer when provided", () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Footer Test"
          footer={<button type="button">Save</button>}
        >
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText("Save")).toBeInTheDocument();
    });

    it("does not render footer section when not provided", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="No Footer">
          <p>Content</p>
        </Modal>
      );
      expect(document.querySelector(".bg-muted\\/30")).toBeNull();
    });
  });

  describe("content", () => {
    it("renders children content", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Complex">
          <div data-testid="form">
            <input placeholder="Name" />
            <textarea placeholder="Description" />
          </div>
        </Modal>
      );
      expect(screen.getByTestId("form")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Name")).toBeInTheDocument();
    });

    it("applies contentClassName", () => {
      render(
        <Modal
          isOpen={true}
          onClose={() => {}}
          title="Custom Class"
          contentClassName="custom-scroll"
        >
          <p>Content</p>
        </Modal>
      );
      expect(document.querySelector(".custom-scroll")).not.toBeNull();
    });
  });

  describe("focus management", () => {
    it("moves focus into dialog when opened, traps Tab/Shift+Tab, excludes background controls, and restores focus to trigger on Escape, close-button, and backdrop dismissal", async () => {
      const user = userEvent.setup();

      function Harness() {
        const [open, setOpen] = useState(false);
        return (
          <div>
            <button
              type="button"
              data-testid="trigger"
              onClick={() => setOpen(true)}
            >
              Open
            </button>
            <button type="button" data-testid="bg">Background</button>
            <Modal
              isOpen={open}
              onClose={() => setOpen(false)}
              title="Focus Modal"
            >
              <button type="button">One</button>
              <button type="button">Two</button>
            </Modal>
          </div>
        );
      }

      render(<Harness />);

      const trigger = screen.getByTestId("trigger");
      const bg = screen.getByTestId("bg");

      // Phase 1 — open via trigger click
      trigger.focus();
      expect(document.activeElement).toBe(trigger);
      await user.click(trigger);

      const closeBtn = screen.getByRole("button", { name: "Close" });
      const one = screen.getByRole("button", { name: "One" });
      const two = screen.getByRole("button", { name: "Two" });
      const dialog = screen.getByRole("dialog");

      // Phase 2 — focus moves into dialog on open
      await waitFor(() => {
        expect(dialog).toContainElement(
          document.activeElement as HTMLElement
        );
      });

      // Phase 3 — forward Tab: Close → One → Two → Close
      closeBtn.focus();
      expect(document.activeElement).toBe(closeBtn);
      await user.tab();
      await waitFor(() => {
        expect(document.activeElement).toBe(one);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      await user.tab();
      await waitFor(() => {
        expect(document.activeElement).toBe(two);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      await user.tab();
      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      // Phase 4 — reverse Shift+Tab: Close → Two → One → Close
      await user.tab({ shift: true });
      await waitFor(() => {
        expect(document.activeElement).toBe(two);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      await user.tab({ shift: true });
      await waitFor(() => {
        expect(document.activeElement).toBe(one);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      await user.tab({ shift: true });
      await waitFor(() => {
        expect(document.activeElement).toBe(closeBtn);
        expect(document.activeElement).not.toBe(bg);
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      });

      // Phase 5 — close via Escape, then verify focus restored to trigger
      await user.keyboard("{Escape}");

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });

      // Phase 6 — re-open, close via close button, verify focus restored
      await user.click(trigger);

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Close" }));

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });

      // Phase 7 — re-open, close via backdrop, verify focus restored
      await user.click(trigger);

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      const backdrop = document.querySelector(".bg-black\\/50") as HTMLElement;
      expect(backdrop).not.toBeNull();
      await user.click(backdrop);

      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });
  });

  describe("close label", () => {
    it("has English localized close button name", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Localized Close">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("has Spanish localized close button name", () => {
      i18nState.language = "es";
      render(
        <Modal isOpen={true} onClose={() => {}} title="Localized Close">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    });
  });
});
