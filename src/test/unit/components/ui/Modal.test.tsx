import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../../../../components/ui/Modal";

describe("Modal", () => {
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

    it("has correct accessible role and label", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Accessible">
          <p>Content</p>
        </Modal>
      );
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute("aria-labelledby", "modal-title");
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

      await user.click(screen.getByLabelText("Close"));

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

      // The backdrop is the div with bg-black/50 class
      const backdrop = document.querySelector(".bg-black\\/50") as HTMLElement;
      expect(backdrop).not.toBeNull();
      await user.click(backdrop);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when Escape key is pressed", () => {
      const onClose = vi.fn();

      render(
        <Modal isOpen={true} onClose={onClose} title="Escape Test">
          <p>Content</p>
        </Modal>
      );

      fireEvent.keyDown(document, { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("body scroll lock", () => {
    it("sets overflow hidden on body when open", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Scroll Lock">
          <p>Content</p>
        </Modal>
      );
      expect(document.body.style.overflow).toBe("hidden");
    });

    it("restores body overflow on unmount", () => {
      const { unmount } = render(
        <Modal isOpen={true} onClose={() => {}} title="Restore">
          <p>Content</p>
        </Modal>
      );
      unmount();
      expect(document.body.style.overflow).toBe("");
    });
  });

  describe("footer", () => {
    it("renders footer when provided", () => {
      render(
        <Modal isOpen={true} onClose={() => {}} title="Footer Test" footer={<button>Save</button>}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText("Save")).toBeInTheDocument();
    });

    it("does not render footer section when not provided", () => {
      const { container } = render(
        <Modal isOpen={true} onClose={() => {}} title="No Footer">
          <p>Content</p>
        </Modal>
      );
      // The footer has border-t border-border bg-muted/30 class
      expect(container.querySelector(".bg-muted\\/30")).toBeNull();
    });
  });

  describe("children", () => {
    it("renders complex children content", () => {
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
  });
});
