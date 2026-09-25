import { type RefObject, useEffect, useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useRestoreFocus } from "@/hooks/useRestoreFocus";

// React Aria's useModalOverlay makes the page outside the dialog `inert` and
// lifts that in a passive-effect cleanup declared before the restore. jsdom
// has no `inert`, so the dialog below models it with `disabled` (jsdom
// refuses focus to disabled buttons), lifted the same way.
function Harness({ unmountDialog = false }: { unmountDialog?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setIsOpen(false);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setIsOpen(true)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {unmountDialog ? (
        isOpen && <Dialog triggerRef={triggerRef} onClose={close} />
      ) : (
        <Dialog triggerRef={triggerRef} isOpen={isOpen} onClose={close} />
      )}
    </>
  );
}

function Dialog({
  triggerRef,
  isOpen = true,
  onClose,
  getTarget,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  isOpen?: boolean;
  onClose: () => void;
  getTarget?: () => HTMLElement | null;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    if (trigger) trigger.disabled = true;
    return () => {
      if (trigger) trigger.disabled = false;
    };
  }, [isOpen, triggerRef]);
  useRestoreFocus(isOpen, { getTarget });

  if (!isOpen) return null;
  return (
    <div role="dialog" aria-label="Dialog">
      <button type="button" autoFocus onClick={onClose}>
        Close
      </button>
    </div>
  );
}

/**
 * A dialog that opens from one control but whose action belongs to the editor:
 * focus must return to the editor, not the (now unmounted) opener. Models the
 * Word Lookup prompt handing off to the definition dialog in the Book Editor.
 */
function HandoffHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const editorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open
      </button>
      <button ref={editorRef} type="button">
        Editor
      </button>
      <Dialog
        triggerRef={editorRef}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        getTarget={() => editorRef.current}
      />
    </>
  );
}

describe("useRestoreFocus", () => {
  it("restores focus to an explicit target instead of the element that opened the dialog", async () => {
    const user = userEvent.setup();
    render(<HandoffHarness />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Editor" })).toHaveFocus();
  });

  it("returns focus to the trigger once the page outside the dialog is interactive again", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("restores focus when the dialog component itself unmounts", async () => {
    const user = userEvent.setup();
    render(<Harness unmountDialog />);
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.tab();
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    expect(trigger).toHaveFocus();
  });
});
