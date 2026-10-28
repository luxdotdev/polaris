/**
 * The diff bench as the app's root when Metro's environment asks for it
 * (`EXPO_PUBLIC_POLARIS_DIFF_BENCH=auto|manual[:lines[:cvd]]`); it runs in release builds, which it needs to measure.
 */
import { Predicate } from "effect";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DiffBench } from "./bench/DiffBench.tsx";

/** The bench root component, or null when the bench wasn't asked for. */
export const diffBenchRoot = (): (() => React.JSX.Element) | null => {
  // Read whole: Expo inlines EXPO_PUBLIC_ variables only where they are named in full.
  const env: unknown = process.env.EXPO_PUBLIC_POLARIS_DIFF_BENCH;

  if (!Predicate.isString(env) || env === "") return null;
  const [mode, lines, palette] = env.split(":");

  return () => (
    <SafeAreaProvider>
      <DiffBench
        mode={mode === "manual" ? "manual" : "auto"}
        lines={Number(lines ?? 2000) || 2000}
        colourblind={palette === "cvd"}
      />
    </SafeAreaProvider>
  );
};
