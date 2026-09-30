/**
 * The bridge the session feature talks through: `window.polaris`, unless the
 * fixture preview (`preview/`) has put a stand-in in its place.
 */
import type { PolarisApi } from "../../shared/api.ts";

let standIn: PolarisApi | null = null;

export const polaris = (): PolarisApi => standIn ?? window.polaris;

/** Preview only: answer the feature's requests from fixtures. */
export const standInBridge = (api: PolarisApi) => {
  standIn = api;
};
