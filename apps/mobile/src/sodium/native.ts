/** The `PolarisSodium` native module (modules/polaris-sodium). */
import { requireNativeModule } from "expo";
import type { NativeSodium } from "./shim.ts";

export const native = requireNativeModule<NativeSodium>("PolarisSodium");
