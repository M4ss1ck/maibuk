import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
}));

const translations = {
  en: {
    "settings.light": "Light",
    "settings.dark": "Dark",
    "settings.system": "System",
    "settings.themeDropdown": "Theme: {{theme}}",
  },
  es: {
    "settings.light": "Claro",
    "settings.dark": "Oscuro",
    "settings.system": "Sistema",
    "settings.themeDropdown": "Tema: {{theme}}",
  },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const lang = i18nState.language;
      const raw = (translations as Record<string, Record<string, string>>)[lang]?.[key] ?? key;
      if (options?.theme) return raw.replace("{{theme}}", options.theme);
      return raw;
    },
  }),
}));

import { ThemeToggle } from "@/components/ThemeToggle";
import { useThemeStore } from "@/features/theme/store";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    i18nState.language = "en";
    useThemeStore.setState({ theme: "system" });
    document.documentElement.classList.remove("dark");
  });

  describe("inline variant (default)", () => {
    it("renders three theme buttons with English titles", () => {
      render(<ThemeToggle />);
      expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "System" })).toBeInTheDocument();
    });

    it("renders three theme buttons with Spanish titles", () => {
      i18nState.language = "es";
      render(<ThemeToggle />);
      expect(screen.getByRole("button", { name: "Claro" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Oscuro" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sistema" })).toBeInTheDocument();
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

    it("icon-only buttons have one accessible name and their SVG is hidden", () => {
      const { container } = render(<ThemeToggle />);
      const btn = screen.getByRole("button", { name: "Light" });
      const svg = btn.querySelector("svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");
      expect(svg).not.toHaveAttribute("aria-label");
      const allVisibleLabels = container.querySelectorAll("svg:not([aria-hidden=true])");
      expect(allVisibleLabels).toHaveLength(0);
    });
  });

  describe("dropdown variant", () => {
    it("renders a single toggle button with English interpolated label when closed", () => {
      render(<ThemeToggle variant="dropdown" />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName("Theme: System");
    });

    it("renders a single toggle button with Spanish interpolated label when closed", () => {
      i18nState.language = "es";
      render(<ThemeToggle variant="dropdown" />);
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName("Tema: Sistema");
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
      expect(screen.queryByText("Light")).not.toBeInTheDocument();
    });
  });
});
