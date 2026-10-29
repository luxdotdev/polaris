/** Styles that read the theme's colours, built once per theme and shared by every caller. */
import { StyleSheet } from "react-native";
import type { MobileColours } from "./appearance.ts";
import { useTheme } from "./ThemeProvider.tsx";

type Styles = Parameters<typeof StyleSheet.create>[0];

/** `const useStyles = themedStyles((c) => ({ … }))` at module scope; `useStyles()` in a component. */
export const themedStyles = <T extends Styles>(
  factory: (colours: MobileColours) => T & Styles
): (() => Readonly<T>) => {
  const built = new WeakMap<MobileColours, Readonly<T>>();

  return () => {
    const { colours } = useTheme();
    const cached = built.get(colours);

    if (cached !== undefined) return cached;
    const styles = StyleSheet.create(factory(colours));

    built.set(colours, styles);

    return styles;
  };
};
