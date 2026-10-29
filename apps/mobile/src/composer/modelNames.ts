/**
 * The Models each Host's Harness last listed, kept for the app's life: a session started from a new
 * session names its Model on the chip at once, before the thread's own ask returns.
 */
import type { HarnessKind, Model } from "@polaris/protocol";

const known = new Map<string, ReadonlyArray<Model>>();

const keyOf = (hostId: string, harness: HarnessKind) => `${hostId}\u0000${harness}`;

export const rememberModels = (
  hostId: string,
  harness: HarnessKind,
  models: ReadonlyArray<Model>
): void => {
  if (models.length > 0) known.set(keyOf(hostId, harness), models);
};

/** The Models the Host just listed, else the ones it listed last; empty when it never said. */
export const modelsFor = (
  hostId: string,
  harness: HarnessKind,
  fetched: ReadonlyArray<Model>
): ReadonlyArray<Model> =>
  fetched.length > 0 ? fetched : (known.get(keyOf(hostId, harness)) ?? []);
