import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings.light": "Light",
        "settings.dark": "Dark",
        "settings.system": "System",
      };
      return map[key] ?? key;
    },
  }),
}));

import { ThemeToggle } from "@/components/ThemeToggle";
import { useThemeStore } from "@/features/theme/store";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: "system" });
    document.documentElement.classList.remove("dark");
  });

  describe("inline variant (default)", () => {
    it("renders three theme buttons with titles", () => {
      render(<ThemeToggle />);
      expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
    });

    it("switches theme to dark on click", async () => {
      const user = userEvent.setup();
      render(<ThemeToggle />);
      await user.click(screen.getByRole("button", { name: "Dark" }));
      expect(useThemeStore.getState().theme).toBe("dark");
    });

    it("switches theme to light on click", async () => {
      const user = userEvent.setup();
      useThemeStore.setState({ theme: "dark" });
      render(<ThemeToggle />);
      await user.click(screen.getByRole("button", { name: "Light" }));
      expect(useThemeStore.getState().theme).toBe("light");
    });
  });

  describe("dropdown variant", () => {
    it("renders a single toggle button when closed", () => {
      render(<ThemeToggle variant="dropdown" />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
    });

    it("opens dropdown menu on click", async () => {
      const user = userEvent.setup();
      render(<ThemeToggle variant="dropdown" />);
      await user.click(screen.getByRole("button"));
      expect(screen.getByText("Light")).toBeInTheDocument();
      expect(screen.getByText("Dark")).toBeInTheDocument();
      expect(screen.getByText("System")).toBeInTheDocument();
    });

    it("selects theme and closes dropdown", async () => {
      const user = userEvent.setup();
      render(<ThemeToggle variant="dropdown" />);
      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText("Dark"));
      expect(useThemeStore.getState().theme).toBe("dark");
      // Dropdown should be closed — menu items hidden
      expect(screen.queryByText("Light")).not.toBeInTheDocument();
    });
  });
});
