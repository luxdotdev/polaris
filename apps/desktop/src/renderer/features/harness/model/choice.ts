/** What the new-session page's Harness choice holds. */
import type { HarnessKind } from "@polaris/protocol";

/** A catalogue Harness, or "Fork a turn". */
export type HarnessChoice =
  | { readonly kind: "harness"; readonly harness: HarnessKind }
  | { readonly kind: "fork" };
