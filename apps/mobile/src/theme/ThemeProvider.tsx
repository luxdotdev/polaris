/**
 * The app's theme and motion: read from the store before the first render (no Midnight→Moonlit
 * flash), kept on change, and iOS Reduce Motion followed live for the "system" preference.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AccessibilityInfo } from "react-native";
import {
  type Appearance,
  type AppearanceStore,
  defaultAppearance,
  loadAppearance,
  type MobileColours,
  type MotionPreference,
  resolveReducedMotion,
  saveAppearance,
  type ThemeName,
  themes,
} from "./appearance.ts";
import { useDevAppearanceLinks } from "./devLinks.ts";
import { fileAppearanceStore } from "./store.ts";

interface ThemeContext {
  readonly appearance: Appearance;
  readonly reducedMotion: boolean;
  readonly update: (change: Partial<Appearance>) => void;
}

const Context = createContext<ThemeContext>({
  appearance: defaultAppearance,
  reducedMotion: false,
  update: () => undefined,
});

/** iOS Reduce Motion, with its change listener. */
const useSystemReduceMotion = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let live = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);

    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return enabled;
};

export const ThemeProvider = ({
  children,
  store = fileAppearanceStore,
}: {
  readonly children: ReactNode;
  readonly store?: AppearanceStore;
}) => {
  const [appearance, setAppearance] = useState(() => loadAppearance(store));
  const systemReduceMotion = useSystemReduceMotion();

  const update = useCallback(
    (change: Partial<Appearance>) =>
      setAppearance((current) => {
        const next = { ...current, ...change };

        // Best effort: the choice holds for this launch either way.
        void saveAppearance(store, next).catch(() => undefined);

        return next;
      }),
    [store]
  );

  useDevAppearanceLinks(update);

  const value = useMemo<ThemeContext>(
    () => ({
      appearance,
      reducedMotion: resolveReducedMotion(appearance.motion, systemReduceMotion),
      update,
    }),
    [appearance, systemReduceMotion, update]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
};

export interface Theme {
  readonly name: ThemeName;
  readonly colours: MobileColours;
  readonly setTheme: (name: ThemeName) => void;
}

export const useTheme = (): Theme => {
  const { appearance, update } = useContext(Context);

  return {
    name: appearance.theme,
    colours: themes[appearance.theme],
    setTheme: (theme) => update({ theme }),
  };
};

export interface MotionSetting {
  readonly motion: MotionPreference;
  readonly setMotion: (motion: MotionPreference) => void;
}

export const useMotionPreference = (): MotionSetting => {
  const { appearance, update } = useContext(Context);

  return { motion: appearance.motion, setMotion: (motion) => update({ motion }) };
};

/** True when the preference is "reduced", or "system" with iOS Reduce Motion on. */
export const useReducedMotion = (): boolean => useContext(Context).reducedMotion;
