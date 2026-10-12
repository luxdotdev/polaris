/**
 * The `git.*` IPC inputs owned by the Explorer's git work, spread into
 * `RequestInputs`; their outputs are spread into `RequestOutputs`.
 */
import type { GitStatus } from "@polaris/protocol";
import { Schema } from "effect";
import type { Rpc } from "effect/rpc";

const HostKey = Schema.String.check(Schema.isMinLength(1));

export const GitRequestInputs = {
  /** `ignored` also lists ignored paths, an ignored folder as one entry (the explorer greys them). */
  "git.status": Schema.Struct({
    hostKey: HostKey,
    cwd: Schema.String,
    ignored: Schema.optional(Schema.Boolean),
  }),
};

export interface GitRequestOutputs {
  "git.status": Rpc.Success<typeof GitStatus>;
}
