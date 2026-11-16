/**
 * Whether a Turn's diff may fall back to the working tree when its `after` checkpoint is
 * missing. The Share gate turns it off for a Teammate unless the Turn is still working.
 */
import { Context } from "effect";

export class WorkingTreeFallback extends Context.Reference<boolean>(
  "polaris/daemon/git/WorkingTreeFallback",
  { defaultValue: () => true }
) {}
