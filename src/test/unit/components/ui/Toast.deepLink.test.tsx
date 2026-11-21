import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastViewport, toast, forceToastError } from "@/components/ui/Toast";

describe("Toast deep-link focus-mode bypass", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Clear any existing toasts by rendering and checking
  });

  it("forceToastError is visible while .focus-mode exists, normal toast is not", async () => {
    const focusDiv = document.createElement("div");
    focusDiv.className = "focus-mode";
    document.body.appendChild(focusDiv);

    render(<ToastViewport />);

    toast.error("should be blocked");
    // Normal toast should not appear while focus-mode active
    expect(screen.queryByText("should be blocked")).not.toBeInTheDocument();

    forceToastError("deep link error");
    await screen.findByText("deep link error");

    document.body.removeChild(focusDiv);
  });

  it("normal toast works without focus-mode", async () => {
    render(<ToastViewport />);
    toast.error("normal error");
    await screen.findByText("normal error");
  });
});
