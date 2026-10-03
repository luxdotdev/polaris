import type { HostId } from "@polaris/protocol";
import { Effect, Layer, Stream } from "effect";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { LanguageInstallCore } from "./install.ts";
import { LanguageCore } from "./core.ts";

export { LanguageCore } from "./core.ts";

export {
  LanguageProviderAccess,
  LanguageTrustGrantAuthority,
  LanguageConnectionLifetime,
  languageBrokerLayer,
} from "./ports.ts";

export { requestAuthority } from "./authority.ts";

/** Core, owned installer demands and verified preparation; mutation receipts and capabilities stay separate. */
export const languageCoreHandlers = (hostId: HostId) =>
  Layer.mergeAll(
    ServerRpcs.toLayerHandler("languages.install", (input) =>
      Effect.flatMap(LanguageInstallCore, (core) => core.start(input))
    ),
    ServerRpcs.toLayerHandler("languages.install.cancel", ({ jobId }) =>
      Effect.flatMap(LanguageInstallCore, (core) => core.cancel(jobId))
    ),
    ServerRpcs.toLayerHandler("languages.install.watch", ({ jobId }) =>
      Stream.unwrap(Effect.map(LanguageInstallCore, (core) => core.watch(jobId)))
    ),
    ServerRpcs.toLayerHandler("languages.catalog", () =>
      Effect.flatMap(LanguageCore, (core) => core.catalog)
    ),
    ServerRpcs.toLayerHandler("languages.availability", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.availability(input))
    ),
    ServerRpcs.toLayerHandler("languages.discover", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.discover(input))
    ),
    ServerRpcs.toLayerHandler("languages.trust.get", ({ scope }) =>
      Effect.flatMap(LanguageCore, (core) => core.trustGet(scope))
    ),
    ServerRpcs.toLayerHandler("languages.trust.set", ({ scope, trusted, expectedRevision }) =>
      Effect.flatMap(LanguageCore, (core) => core.trustSet(scope, trusted, expectedRevision))
    ),
    ServerRpcs.toLayerHandler("languages.context.acquire", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.acquire(input))
    ),
    ServerRpcs.toLayerHandler("languages.context.release", ({ context, interestId }) =>
      Effect.flatMap(LanguageCore, (core) => core.release(context, interestId))
    ),
    ServerRpcs.toLayerHandler("languages.context.restart", ({ context }) =>
      Effect.flatMap(LanguageCore, (core) => core.restart(context))
    ),
    ServerRpcs.toLayerHandler("languages.context.configure", ({ context, settings }) =>
      Effect.flatMap(LanguageCore, (core) => core.configure(context, settings))
    ),
    ServerRpcs.toLayerHandler("languages.document.sync", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.sync(input))
    ),
    ServerRpcs.toLayerHandler("languages.document.acknowledge", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.acknowledge(input))
    ),
    ServerRpcs.toLayerHandler("languages.request", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.request(input))
    ),
    ServerRpcs.toLayerHandler("languages.edit.prepare", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.prepare(input))
    ),
    ServerRpcs.toLayerHandler("languages.cancel", ({ context, requestId }) =>
      Effect.flatMap(LanguageCore, (core) => core.cancel(context, requestId))
    ),
    ServerRpcs.toLayerHandler("languages.progress.cancel", ({ context, token }) =>
      Effect.flatMap(LanguageCore, (core) => core.cancelProgress(context, token))
    ),
    ServerRpcs.toLayerHandler("languages.server.respond", (input) =>
      Effect.flatMap(LanguageCore, (core) => core.respond(input))
    ),
    ServerRpcs.toLayerHandler("languages.context.watch", ({ context }) =>
      Stream.unwrap(Effect.map(LanguageCore, (core) => core.watch(context)))
    )
  ).pipe(Layer.provide(LanguageCore.layer(hostId)));
