/** Settings → Appearance's choices (theme and motion), their saved form, and Reduce Motion. */
import { midnight, moonlit, type ThemeColours } from "@polaris/ui/tokens";
import { Option, Schema } from "effect";

export const ThemeName = Schema.Literals(["midnight", "moonlit"]);

export type ThemeName = typeof ThemeName.Type;

/** "system" follows iOS Reduce Motion (MX-G: "Follows Reduce Motion"). */
export const MotionPreference = Schema.Literals(["system", "reduced", "full"]);

export type MotionPreference = typeof MotionPreference.Type;

/** A theme's colours: every key of `@polaris/ui/tokens`' Midnight. */
export type MobileColours = ThemeColours;

export const themes: Readonly<Record<ThemeName, MobileColours>> = { midnight, moonlit };

export interface Appearance {
  readonly theme: ThemeName;
  readonly motion: MotionPreference;
}

/** Midnight, following the system's Reduce Motion. */
export const defaultAppearance: Appearance = { theme: "midnight", motion: "system" };

const decodeAppearance = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      theme: Schema.optionalKey(Schema.Unknown),
      motion: Schema.optionalKey(Schema.Unknown),
    })
  )
);

const isTheme = Schema.is(ThemeName);

const isMotion = Schema.is(MotionPreference);

/** The saved choices; each one unreadable (missing, or a newer build's) falls back on its own. */
export const parseAppearance = (text: string | null): Appearance => {
  const saved = text === null ? Option.none() : decodeAppearance(text);

  return Option.match(saved, {
    onNone: () => defaultAppearance,
    onSome: ({ theme, motion }) => ({
      theme: isTheme(theme) ? theme : defaultAppearance.theme,
      motion: isMotion(motion) ? motion : defaultAppearance.motion,
    }),
  });
};

export const serializeAppearance = (appearance: Appearance): string =>
  JSON.stringify({ theme: appearance.theme, motion: appearance.motion });

/** Where the choices are kept. `read` is synchronous so the first paint has the saved theme. */
export interface AppearanceStore {
  readonly read: () => string | null;
  readonly write: (text: string) => Promise<void>;
}

export const loadAppearance = (store: AppearanceStore): Appearance => {
  try {
    return parseAppearance(store.read());
  } catch {
    return defaultAppearance;
  }
};

export const saveAppearance = (store: AppearanceStore, appearance: Appearance): Promise<void> =>
  store.write(serializeAppearance(appearance));

/** Whether motion is reduced: the preference, or iOS Reduce Motion when it is "system". */
export const resolveReducedMotion = (
  motion: MotionPreference,
  systemReduceMotion: boolean
): boolean => (motion === "system" ? systemReduceMotion : motion === "reduced");

/** The change a development link (`polaris://dev/theme/moonlit`) asks for, or null. */
export const devAppearanceLink = (url: string): Partial<Appearance> | null => {
  const [, kind, value] = /^polaris:\/\/dev\/(theme|motion)\/([a-z]+)$/.exec(url) ?? [];

  if (kind === "theme" && isTheme(value)) return { theme: value };

  return kind === "motion" && isMotion(value) ? { motion: value } : null;
};
