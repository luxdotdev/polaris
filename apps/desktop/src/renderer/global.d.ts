import type * as P from "@polaris/protocol";
import type { PolarisApi } from "../shared/api.ts";

declare global {
  interface Window {
    /** Exposed by the preload script (src/preload/index.ts). */
    readonly polaris: PolarisApi;
    /** Read-only measurements for the smoke test and benchmarks (routes/switchTimer.ts). */
    __polaris?: { readonly switchTimes: () => ReadonlyArray<number> };
    /** A Trust change through the renderer, for acceptance (features/editor/trust). */
    __polarisTrust?: {
      readonly change: (
        target: {
          readonly hostKey: string;
          readonly checkout: P.LanguageCheckout;
          readonly path: string;
        },
        action: typeof P.LanguageTrustAction.Type,
        expectedRevision: number
      ) => Promise<void>;
    };
  }
}
