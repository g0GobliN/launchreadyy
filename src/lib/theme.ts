import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "lr-theme";

// Dark unless the user has explicitly chosen light. Kept in sync with the
// inline blocking script in __root.tsx, which applies the same rule before
// first paint to avoid a flash.
export function getPreferredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme() {
  // Starts as "dark" to match server-rendered markup (<html class="dark">);
  // the blocking script already applied the real theme, so we just read it
  // back after mount instead of recomputing (which could hydration-mismatch).
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
