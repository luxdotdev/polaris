import { Context, Effect, Layer, Schema } from "effect";
import { PredictionContextRequest, PredictionError } from "@polaris/protocol";
import type { HostId, LanguageCheckout } from "@polaris/protocol";
import { ServerRpcs } from "../transport/rpcs.ts";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EventStore } from "../store/EventStore.ts";
import { requestAuthority } from "../languages/composition/authority.ts";
import { LanguageAcquisitionAuthority } from "../languages/composition/acquisitionAuthority.ts";
import { LanguageBroker } from "../languages/runtime/service.ts";
import { ExecutionTrustService, checkoutPath } from "../languages/trust/index.ts";
import { ContextAssembler } from "./assemble.ts";
import { invalidRequest, predictionCheckout } from "./checkout.ts";
import type { LanguageSource } from "./language.ts";

const predictionError = (cause: unknown) =>
  Schema.is(PredictionError)(cause)
    ? cause
    : new PredictionError({ reason: "unavailable", message: "Prediction context is unavailable" });

function makeCore(
  hostId: HostId,
  broker: LanguageBroker["Service"],
  trust: ExecutionTrustService["Service"],
  owners: LanguageAcquisitionAuthority["Service"]
) {
  const assembler = new ContextAssembler();

  const languageSource = Effect.fn("PredictionContext.languageSource")(function* (
    auth: Effect.Success<ReturnType<typeof requestAuthority>>,
    checkout: LanguageCheckout,
    path: string,
    buffer: string
  ) {
    const observed = yield* trust.inspect(checkout);

    if (!observed.trust.trusted || !owners.owns(auth.principal)) return undefined;
    const fenceTrust = owners.trustFence({ hostId, workspaceId: checkout.workspaceId });

    const document = yield* broker.predictionDocument(
      auth.principal.clientId,
      checkout,
      pathToFileURL(path).href,
      buffer
    );

    if (document === undefined) return undefined;
    const deadline = Date.now() + 70;

    const check = Effect.gen(function* () {
      yield* auth.check;
      yield* Effect.try({ try: fenceTrust, catch: predictionError });

      if (!owners.owns(auth.principal))
        return yield* Effect.fail(invalidRequest("Editor connection changed"));
      yield* trust.require(checkout);
    });

    const source: LanguageSource = {
      ...document,
      request: (method, params, signal) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* check;

            const result = yield* broker.requestRaw(
              auth.principal.clientId,
              `prediction-${crypto.randomUUID()}`,
              document.fence,
              method,
              params,
              deadline
            );

            yield* check;

            return result;
          }),
          { signal }
        ),
      current: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* check;

            const current = yield* broker.predictionDocument(
              auth.principal.clientId,
              checkout,
              pathToFileURL(path).href,
              buffer
            );

            return (
              current !== undefined &&
              current.fence.context.generation === document.fence.context.generation &&
              current.fence.requiredSequence === document.fence.requiredSequence
            );
          }).pipe(Effect.catch(() => Effect.succeed(false)))
        ),
    };

    return source;
  });

  const context = Effect.fn("PredictionContext.context")(function* (
    input: PredictionContextRequest
  ) {
    const valid = yield* Schema.decodeUnknownEffect(PredictionContextRequest)(input);

    if (
      valid.cursor > valid.buffer.length ||
      (valid.cursor > 0 &&
        /[\uD800-\uDBFF]/.test(valid.buffer[valid.cursor - 1]!) &&
        /[\uDC00-\uDFFF]/.test(valid.buffer[valid.cursor] ?? ""))
    )
      return yield* Effect.fail(invalidRequest("Cursor is not a UTF-16 character boundary"));
    const auth = yield* requestAuthority(hostId);
    const model = yield* (yield* EventStore).model;
    yield* auth.check;

    const selected = yield* Effect.try({
      try: () => predictionCheckout(model, valid.workspaceId, valid.path),
      catch: predictionError,
    });

    const canonical = yield* auth.checkout(selected.checkout);

    const path = yield* Effect.tryPromise({
      try: () =>
        checkoutPath(
          canonical,
          resolve(canonical.root, relative(selected.checkout.path, selected.absolute))
        ),
      catch: predictionError,
    });

    const source = yield* languageSource(auth, selected.checkout, path, valid.buffer);

    const pieces = yield* Effect.tryPromise({
      try: (signal) =>
        assembler.assemble(auth.principal, canonical.root, path, valid, source, signal),
      catch: predictionError,
    });

    yield* auth.checkout(selected.checkout);
    yield* auth.check;

    if (source !== undefined && !(yield* Effect.promise(source.current)))
      return pieces.filter((piece) => piece.kind !== "definition" && piece.kind !== "diagnostic");

    return pieces;
  }, Effect.mapError(predictionError));

  return { context };
}

export class PredictionContextCore extends Context.Service<
  PredictionContextCore,
  ReturnType<typeof makeCore>
>()("polaris/prediction/Context") {
  static layer(hostId: HostId) {
    return Layer.effect(
      PredictionContextCore,
      Effect.gen(function* () {
        return makeCore(
          hostId,
          yield* LanguageBroker,
          yield* ExecutionTrustService,
          yield* LanguageAcquisitionAuthority
        );
      })
    );
  }
}

export const predictionContextHandlers = (hostId: HostId) =>
  ServerRpcs.toLayerHandler("prediction.context", (input) =>
    Effect.flatMap(PredictionContextCore, (core) => core.context(input))
  ).pipe(Layer.provide(PredictionContextCore.layer(hostId)));
