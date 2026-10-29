/**
 * Contract stub for the theme (ENG-534, T1 replaces the implementation).
 * Screens code against these names; the stub always answers Midnight.
 */
import { midnight } from "@polaris/ui/tokens";
import { Fragment, createElement, useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";

export type ThemeName = "midnight" | "moonlit";

export type MobileColours = typeof midnight;

export type MotionPreference = "system" | "reduced" | "full";

export interface Theme {
  readonly name: ThemeName;
  readonly colours: MobileColours;
  readonly setTheme: (name: ThemeName) => void;
}

const noop = () => undefined;

export const ThemeProvider = ({ children }: { readonly children: ReactNode }) =>
  createElement(Fragment, null, children);

export const useTheme = (): Theme => ({ name: "midnight", colours: midnight, setTheme: noop });

export interface MotionSetting {
  readonly motion: MotionPreference;
  readonly setMotion: (motion: MotionPreference) => void;
}

export const useMotionPreference = (): MotionSetting => ({ motion: "system", setMotion: noop });

export const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);

    return () => sub.remove();
  }, []);

  return reduced;
};
