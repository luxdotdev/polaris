import { Context, Effect, Layer, Schema, Stream } from "effect";
import { LanguageError } from "@polaris/protocol";
import { ProjectDiscovery } from "../discovery/index.ts";
import { ExecutionTrustService } from "../trust/index.ts";
import { createLanguageBroker, type BrokerOptions } from "./index.ts";

const brokerError = (cause: unknown) =>
  Schema.is(LanguageError)(cause)
    ? cause
    : new LanguageError({
        reason: "server-failed",
        message: "Language runtime failed",
        retryable: true,
      });

export const languageOperation = <A>(operation: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: brokerError });

function effectBroker(broker: ReturnType<typeof createLanguageBroker>) {
  return {
    acquire: Effect.fn("LanguageBroker.acquire")((...args: Parameters<typeof broker.acquire>) =>
      languageOperation(() => broker.acquire(...args))
    ),
    sync: Effect.fn("LanguageBroker.sync")((...args: Parameters<typeof broker.sync>) =>
      languageOperation(() => broker.sync(...args))
    ),
    acknowledgeBuffer: Effect.fn("LanguageBroker.acknowledgeBuffer")(
      (...args: Parameters<typeof broker.acknowledgeBuffer>) =>
        languageOperation(() => broker.acknowledgeBuffer(...args))
    ),
    readAcknowledgedBuffer: Effect.fn("LanguageBroker.readAcknowledgedBuffer")(
      (...args: Parameters<typeof broker.readAcknowledgedBuffer>) =>
        Effect.try({ try: () => broker.readAcknowledgedBuffer(...args), catch: brokerError })
    ),
    readPreparationDocument: Effect.fn("LanguageBroker.readPreparationDocument")(
      (...args: Parameters<typeof broker.readPreparationDocument>) =>
        Effect.try({ try: () => broker.readPreparationDocument(...args), catch: brokerError })
    ),
    invalidateBufferAcknowledgments: Effect.fn("LanguageBroker.invalidateBufferAcknowledgments")(
      (...args: Parameters<typeof broker.invalidateBufferAcknowledgments>) =>
        Effect.sync(() => broker.invalidateBufferAcknowledgments(...args))
    ),
    request: Effect.fn("LanguageBroker.request")(
      (clientId: string, input: Parameters<typeof broker.request>[1]) =>
        languageOperation((signal) => broker.request(clientId, input, signal))
    ),
    verifyFeatureEdit: Effect.fn("LanguageBroker.verifyFeatureEdit")(
      (...args: Parameters<typeof broker.verifyFeatureEdit>) =>
        languageOperation(() => broker.verifyFeatureEdit(...args))
    ),
    requestRaw: Effect.fn("LanguageBroker.requestRaw")(
      (
        clientId: string,
        requestId: string,
        fence: Parameters<typeof broker.requestRaw>[2],
        method: string,
        params: Parameters<typeof broker.requestRaw>[4],
        deadline: number
      ) =>
        languageOperation((signal) =>
          broker.requestRaw(clientId, requestId, fence, method, params, deadline, signal)
        )
    ),
    cancel: Effect.fn("LanguageBroker.cancel")((...args: Parameters<typeof broker.cancel>) =>
      Effect.try({ try: () => broker.cancel(...args), catch: brokerError })
    ),
    cancelProgress: Effect.fn("LanguageBroker.cancelProgress")(
      (...args: Parameters<typeof broker.cancelProgress>) =>
        languageOperation(() => broker.cancelProgress(...args))
    ),
    release: Effect.fn("LanguageBroker.release")((...args: Parameters<typeof broker.release>) =>
      languageOperation(() => broker.release(...args))
    ),
    restart: Effect.fn("LanguageBroker.restart")((...args: Parameters<typeof broker.restart>) =>
      languageOperation(() => broker.restart(...args))
    ),
    configure: Effect.fn("LanguageBroker.configure")(
      (...args: Parameters<typeof broker.configure>) =>
        languageOperation(() => broker.configure(...args))
    ),
    challengeRecoveryReceipt: Effect.fn("LanguageBroker.challengeRecoveryReceipt")(
      (...args: Parameters<typeof broker.challengeRecoveryReceipt>) =>
        languageOperation(() => broker.challengeRecoveryReceipt(...args))
    ),
    challengeReceipt: Effect.fn("LanguageBroker.challengeReceipt")(
      (...args: Parameters<typeof broker.challengeReceipt>) =>
        languageOperation(() => broker.challengeReceipt(...args))
    ),
    respond: Effect.fn("LanguageBroker.respond")((...args: Parameters<typeof broker.respond>) =>
      languageOperation(() => broker.respond(...args))
    ),
    disconnect: Effect.fn("LanguageBroker.disconnect")((clientId: string) =>
      Effect.sync(() => broker.disconnect(clientId))
    ),
    disconnectAndWait: Effect.fn("LanguageBroker.disconnectAndWait")((clientId: string) =>
      languageOperation(() => broker.disconnectAndWait(clientId))
    ),
    invalidateTrust: Effect.fn("LanguageBroker.invalidateTrust")(
      (...args: Parameters<typeof broker.invalidateTrust>) =>
        Effect.sync(() => broker.invalidateTrust(...args))
    ),
    invalidateConfiguration: Effect.fn("LanguageBroker.invalidateConfiguration")(
      (...args: Parameters<typeof broker.invalidateConfiguration>) =>
        Effect.sync(() => broker.invalidateConfiguration(...args))
    ),
    snapshot: Effect.fn("LanguageBroker.snapshot")((...args: Parameters<typeof broker.snapshot>) =>
      Effect.try({ try: () => broker.snapshot(...args), catch: brokerError })
    ),
    watch: (...args: Parameters<typeof broker.watch>) =>
      Stream.unwrap(
        Effect.try({
          try: () => Stream.fromAsyncIterable(broker.watch(...args), brokerError),
          catch: brokerError,
        })
      ),
    stats: Effect.sync(broker.stats),
  };
}

export class LanguageBroker extends Context.Service<
  LanguageBroker,
  ReturnType<typeof effectBroker>
>()("polaris/languages/LanguageBroker") {
  static layer(options: Omit<BrokerOptions, "discover" | "invalidateDiscovery" | "requireTrust">) {
    return Layer.effect(
      LanguageBroker,
      Effect.gen(function* () {
        const discovery = yield* ProjectDiscovery;
        const trust = yield* ExecutionTrustService;

        const broker = createLanguageBroker({
          ...options,
          discover: (input) => Effect.runPromise(discovery.discover(input)),
          invalidateDiscovery: () => Effect.runSync(discovery.invalidate),
          requireTrust: (checkout) => Effect.runPromise(trust.require(checkout)),
        });

        yield* Effect.addFinalizer(() => Effect.promise(broker.close));

        return LanguageBroker.of(effectBroker(broker));
      })
    );
  }
}
