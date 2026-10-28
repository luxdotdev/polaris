import "./src/sodium/webCrypto.ts";
import { Predicate } from "effect";
import { registerRootComponent } from "expo";
import { App } from "./src/App.tsx";
import { diffBenchRoot } from "./src/review/dev.tsx";
import { runNativeProbe } from "./src/runtime/nativeProbe.ts";

registerRootComponent(diffBenchRoot() ?? App);

// scripts/simulatorCheck.ts sets this ("1", or a link string to link with); read whole for Expo.
const nativeCheck: unknown = process.env.EXPO_PUBLIC_POLARIS_NATIVE_CHECK;

if (__DEV__ && Predicate.isString(nativeCheck))
  void runNativeProbe(nativeCheck === "1" ? null : nativeCheck);
