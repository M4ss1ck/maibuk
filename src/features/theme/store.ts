import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "maibuk-theme",
    }
  )
);

// Apply theme to document
export function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}

// Hook to sync theme with document
export function useTheme() {
  const { theme, setTheme } = useThemeStore();

  // Apply theme on mount and when it changes
  if (typeof window !== "undefined") {
    applyTheme(theme);
  }

  return { theme, setTheme };
}
