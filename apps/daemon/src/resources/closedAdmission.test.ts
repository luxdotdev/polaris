import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect, Exit, Scope } from "effect";
import { EventStore } from "../store/EventStore.ts";
import {
  cancelWorkerAdmissionWait,
  hasWorkerAdmission,
  registerWorkerAdmission,
  registerWorkerAdmissionSource,
  withWorkerAdmission,
} from "./workerAdmission.ts";

for (const cleanup of ["input", "finalizer", "cancel"] as const)
  test(`closed admission ${cleanup} cleanup preserves the active fence and removes the ended assignment`, async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* EventStore;
        const parent = yield* Scope.Scope;
        const scope = yield* Scope.fork(parent);
        const sid = SessionId.make("closed-admission");
        let active = true;

        yield* registerWorkerAdmissionSource(store, parent, () => Effect.sync(() => active));

        const admission = yield* registerWorkerAdmission(
          store,
          sid,
          scope,
          Effect.void,
          Effect.succeed(false)
        );

        yield* admission.retire;
        expect(yield* withWorkerAdmission(store, sid, Effect.succeed("ordinary"))).toBeUndefined();
        expect(hasWorkerAdmission(store, sid)).toBe(true);

        active = false;

        if (cleanup === "finalizer") yield* Scope.close(scope, Exit.void);

        if (cleanup === "cancel") yield* cancelWorkerAdmissionWait(store, sid);

        expect(
          yield* withWorkerAdmission(
            store,
            sid,
            Effect.succeed("ordinary"),
            cleanup === "input"
          ).pipe(Effect.timeout(200))
        ).toBe("ordinary");
        expect(hasWorkerAdmission(store, sid)).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(EventStore.layerSqlite(":memory:")))
    );
  });
