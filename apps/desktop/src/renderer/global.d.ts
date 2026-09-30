import type { PolarisApi } from "../shared/api.ts";

declare global {
  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    readonly polaris: PolarisApi;
    /** Read-only measurements for the smoke test and benchmarks (routes/switchTimer.ts). */
    __polaris?: { readonly switchTimes: () => ReadonlyArray<number> };
  }
}
