import type { SessionId } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import type { ConstellationAttachment } from "../../harness/constellation/attachment.ts";
import type { ConstellationCommands } from "../../mcp/tools.ts";

interface AttachmentOptions {
  readonly constellations: ReadonlyArray<ConstellationAttachment>;
  readonly environment: Readonly<Record<string, string>>;
}

export interface ConstellationHarnessDelegate {
  readonly install: (origin: string, commands: ConstellationCommands) => Effect.Effect<void>;
  readonly open: (id: SessionId) => Effect.Effect<AttachmentOptions>;
}

export interface ConstellationHarnessService extends ConstellationHarnessDelegate {
  readonly activate: (delegate: ConstellationHarnessDelegate) => Effect.Effect<void>;
}

const proxy = (): ConstellationHarnessService => {
  let delegate: ConstellationHarnessDelegate = {
    install: () => Effect.void,
    open: () => Effect.succeed({ constellations: [], environment: {} }),
  };

  return {
    activate: (implementation) =>
      Effect.sync(() => {
        delegate = implementation;
      }),
    install: (origin, commands) => Effect.suspend(() => delegate.install(origin, commands)),
    open: (id) => Effect.suspend(() => delegate.open(id)),
  };
};

/** Stable per-Daemon proxy captured before the heavy composition is loaded. */
export class ConstellationHarness extends Context.Reference<ConstellationHarnessService>(
  "polaris/constellation/Harness",
  { defaultValue: proxy }
) {
  static readonly layer = Layer.sync(ConstellationHarness, proxy);
}
