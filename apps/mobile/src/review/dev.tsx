/**
 * Development routes into Review, read from Metro's environment: the diff bench
 * (`EXPO_PUBLIC_POLARIS_DIFF_BENCH=auto|manual[:lines[:cvd]]`) and one agent session's Review over the
 * dev bridge (`EXPO_PUBLIC_POLARIS_REVIEW=<sessionId>[:<turnId>]`).
 */
import { Predicate } from "effect";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { parseDevBridge } from "../runtime/devBridge.ts";
import { HostsProvider } from "../runtime/hosts.tsx";
import { DiffBench } from "./bench/DiffBench.tsx";
import { ReviewScreen } from "./ReviewScreen.tsx";

const nonEmpty = (value: string) => (value === "" ? null : value);

/** The bench screen when asked for; it runs in release builds too, which it needs to measure. */
const bench = (): ReactElement | null => {
  // Read whole: Expo inlines EXPO_PUBLIC_ variables only where they are named in full.
  const env: unknown = process.env.EXPO_PUBLIC_POLARIS_DIFF_BENCH;
  const value = Predicate.isString(env) ? nonEmpty(env) : null;

  if (value === null) return null;
  const [mode, lines, palette] = value.split(":");

  return (
    <SafeAreaProvider>
      <DiffBench
        mode={mode === "manual" ? "manual" : "auto"}
        lines={Number(lines ?? 2000) || 2000}
        colourblind={palette === "cvd"}
      />
    </SafeAreaProvider>
  );
};

const review = (): ReactElement | null => {
  if (!__DEV__) return null;
  const env: unknown = process.env.EXPO_PUBLIC_POLARIS_REVIEW;
  const bridgeEnv: unknown = process.env.EXPO_PUBLIC_POLARIS_DEV_BRIDGE;
  const value = Predicate.isString(env) ? nonEmpty(env) : null;
  const bridge = Predicate.isString(bridgeEnv) ? parseDevBridge(bridgeEnv) : null;

  if (value === null || bridge === null) return null;
  const [sessionId = "", turnId] = value.split(":");

  return (
    <SafeAreaProvider>
      <HostsProvider>
        <ReviewScreen hostId={bridge.hostId} sessionId={sessionId} turnId={turnId ?? null} />
      </HostsProvider>
    </SafeAreaProvider>
  );
};

export const devReviewRoute = (): ReactElement | null => bench() ?? review();
