/**
 * Secret Requests (ADR 0089): an agent's `request_secret` opens an approval of kind
 * `secret` on its Turn in flight and waits; `secret.provide` writes the value to a
 * file and answers `Provided`. The value never reaches an event.
 */
import { join } from "node:path";
import {
  ApprovalDecision,
  ApprovalRequest,
  DomainEvent,
  NotFound,
  RequestId,
  SecretRejected,
  type SessionId,
} from "@polaris/protocol";
import {
  Context,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  type Redacted,
  Scope,
  Stream,
} from "effect";
import { polarisHome } from "../paths.ts";
import { type SessionSecretFiles, sessionSecretFiles } from "../secrets/sessionFiles.ts";
import type { ServiceError } from "../services.ts";
import { workingTurn } from "../store/model.ts";
import { EngineRuntime } from "./runtime.ts";
import { SecretOutcome, type SecretRequestInput, TIMED_OUT } from "../secrets/requests.ts";

export { SecretOutcome, type SecretRequestInput } from "../secrets/requests.ts";

const ended = () =>
  new SecretRejected({
    reason: "ended",
    message: "This request has ended, so the secret wasn't saved.",
  });

const outcomeOf = (event: DomainEvent | undefined, file: string): SecretOutcome =>
  Match.value(event).pipe(
    Match.tag("ApprovalResolved", ({ decision }) =>
      ApprovalDecision.match(decision, {
        Provided: (): SecretOutcome => SecretOutcome.Saved({ file }),
        Deny: (): SecretOutcome => SecretOutcome.Declined(),
        Allow: (): SecretOutcome => SecretOutcome.Declined(),
        Answer: (): SecretOutcome => SecretOutcome.Declined(),
      })
    ),
    Match.tag("ApprovalWithdrawn", ({ reason }) =>
      reason === TIMED_OUT ? SecretOutcome.TimedOut() : SecretOutcome.Cancelled({ reason })
    ),
    Match.orElse(() => SecretOutcome.Cancelled({ reason: "The request ended" }))
  );

export class SecretRequests extends Context.Service<
  SecretRequests,
  {
    /** Opens a Secret Request on the session's Turn in flight and waits for its outcome. */
    readonly request: (
      sessionId: SessionId,
      input: SecretRequestInput
    ) => Effect.Effect<SecretOutcome, ServiceError>;
    readonly provide: (
      sessionId: SessionId,
      requestId: RequestId,
      value: Redacted.Redacted<string>,
      resolvedBy: string
    ) => Effect.Effect<void, SecretRejected | NotFound | ServiceError>;
    /** Whether Polaris opened this request (no Harness knows it). */
    readonly owns: (requestId: RequestId) => boolean;
    readonly files: SessionSecretFiles;
  }
>()("polaris/daemon/engine/SecretRequests") {
  static readonly layer = Layer.effect(
    SecretRequests,
    Effect.gen(function* () {
      const rt = yield* EngineRuntime;

      const files = yield* sessionSecretFiles(join(polarisHome(), "secrets", "sessions")).pipe(
        Scope.provide(rt.engineScope)
      );

      return make(rt, files);
    })
  );
}

const make = (
  rt: EngineRuntime["Service"],
  files: SessionSecretFiles
): SecretRequests["Service"] => {
  /** Open requests and the file each one's value goes to. */
  const open = new Map<RequestId, { readonly sessionId: SessionId; readonly path: string }>();

  const pending = (sessionId: SessionId, requestId: RequestId) =>
    Effect.map(
      rt.store.model,
      (model) => model.sessions.get(sessionId)?.pending.has(requestId) ?? false
    );

  const withdraw = (sessionId: SessionId, requestId: RequestId, reason: string) =>
    rt.signal(sessionId, {
      type: "harness.approvalWithdrawn",
      requestId,
      withdrawnBy: "daemon",
      reason,
    });

  /** How the request closed, read from the log after it opened. */
  const closing = Effect.fnUntraced(function* (
    sessionId: SessionId,
    requestId: RequestId,
    after: number
  ) {
    const model = yield* rt.store.model;

    const events = yield* rt.store.readEvents({
      after,
      upTo: model.sequence ?? after,
      sessionId,
      eventTypes: ["ApprovalResolved", "ApprovalWithdrawn"],
    });

    return events
      .map((envelope) => envelope.event)
      .find(
        (event) =>
          (Predicate.isTagged(event, "ApprovalResolved") ||
            Predicate.isTagged(event, "ApprovalWithdrawn")) &&
          event.requestId === requestId
      );
  });

  const wait = Effect.fnUntraced(function* (
    sessionId: SessionId,
    requestId: RequestId,
    path: string,
    input: SecretRequestInput
  ) {
    const commits = yield* rt.store.subscribe({ sessionId });
    const model = yield* rt.store.model;
    const record = model.sessions.get(sessionId);

    if (record === undefined) return SecretOutcome.NotFound();
    const turn = workingTurn(record);

    if (turn === undefined) return SecretOutcome.NoTurn();
    const openedAt = yield* rt.now;

    const opened = yield* rt.signal(sessionId, {
      type: "harness.approvalRequested",
      request: new ApprovalRequest({
        id: requestId,
        sessionId,
        turnId: turn.id,
        kind: "secret",
        title: input.label,
        detail: input.reason,
        options: [],
        questions: [],
        placeholder: input.placeholder,
        expiresAt: new Date(Date.parse(openedAt) + input.timeoutMs).toISOString(),
        openedAt,
      }),
    });

    if (!Predicate.isTagged(opened, "Committed") || opened.sequence === null)
      return SecretOutcome.NoTurn();
    const after = opened.sequence;

    const answered = yield* commits.pipe(
      Stream.mapEffect(() => Effect.map(pending(sessionId, requestId), (still) => !still)),
      Stream.takeUntil((done) => done),
      Stream.runDrain,
      Effect.timeoutOption(input.timeoutMs)
    );

    if (Option.isNone(answered) && (yield* pending(sessionId, requestId)))
      yield* withdraw(sessionId, requestId, TIMED_OUT);

    return outcomeOf(yield* closing(sessionId, requestId, after), path);
  });

  return {
    files,
    owns: (requestId) => open.has(requestId),
    request: (sessionId, input) =>
      Effect.suspend(() => {
        const requestId = RequestId.make(`secret-${crypto.randomUUID()}`);
        const path = files.reserve(sessionId);
        open.set(requestId, { sessionId, path });

        return Effect.scoped(wait(sessionId, requestId, path, input)).pipe(
          // A call the agent abandons withdraws its request.
          Effect.onInterrupt(() =>
            Effect.ignore(withdraw(sessionId, requestId, "The agent stopped waiting"))
          ),
          Effect.tap((outcome) =>
            Predicate.isTagged(outcome, "Saved") ? Effect.void : files.discard(path)
          ),
          Effect.ensuring(Effect.sync(() => open.delete(requestId)))
        );
      }),
    provide: Effect.fn("SecretRequests.provide")(
      function* (sessionId, requestId, value, resolvedBy) {
        const model = yield* rt.store.model;
        const record = model.sessions.get(sessionId);

        if (record === undefined) return yield* new NotFound({ what: "session", id: sessionId });
        const request = record.pending.get(requestId);

        if (request !== undefined && request.kind !== "secret")
          return yield* new SecretRejected({
            reason: "not-secret",
            message: "This request doesn't take a secret.",
          });
        const target = open.get(requestId);

        if (request === undefined || target === undefined) return yield* ended();

        yield* files.write(sessionId, target.path, value).pipe(
          Effect.mapError(
            (error) =>
              new SecretRejected({
                reason: "storage",
                message: `The Host couldn't save the secret: ${error.message}`,
              })
          )
        );

        const resolved = yield* rt.signal(sessionId, {
          type: "approval.respond",
          requestId,
          decision: ApprovalDecision.cases.Provided.make({}),
          resolvedBy,
        });

        const recorded =
          Predicate.isTagged(resolved, "Committed") &&
          resolved.envelopes.some((envelope) =>
            Predicate.isTagged(envelope.event, "ApprovalResolved")
          );

        // It closed while the file was written: nothing may keep the value.
        if (!recorded) {
          yield* files.discard(target.path);

          return yield* ended();
        }
      }
    ),
  };
};
