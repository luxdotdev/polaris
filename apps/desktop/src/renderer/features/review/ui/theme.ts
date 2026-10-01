/** Light or dark as the app shows it now: the theme setting, or macOS for "system". */
import { useSyncExternalStore } from "react";
import { useApp } from "../../../shell/hooks.ts";

const query = () => matchMedia("(prefers-color-scheme: dark)");

const subscribe = (onChange: () => void) => {
  const media = query();

  media.addEventListener("change", onChange);

  return () => media.removeEventListener("change", onChange);
};

export const useThemeType = (): "light" | "dark" => {
  const theme = useApp((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribe, () => query().matches);

  if (theme === "system") return systemDark ? "dark" : "light";

  return theme;
};
