import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DomainEvent, HostId, SessionId } from "@polaris/protocol";
import { Effect, Predicate } from "effect";
import { shortTemp } from "../platform/testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { WORKERS_RESOURCE } from "./model.ts";

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a queued worker request keeps when it joined the queue, live and after a restart", async () => {
  const dir = mkdtempSync(shortTemp("queued-at-"));
  dirs.push(dir);
  const filename = join(dir, "state.sqlite");

  const committedAt = await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* EventStore;

      const result = yield* store.commit({
        commandId: null,
        decide: () =>
          Effect.succeed([
            DomainEvent.cases.ResourceLeaseQueued.make({
              hostId: HostId.make("host"),
              resource: WORKERS_RESOURCE,
              requestId: "r1",
              sessionId: SessionId.make("worker"),
            }),
          ]),
      });

      if (!Predicate.isTagged(result, "Committed")) throw new Error("not committed");
      const occurredAt = result.envelopes[0]!.occurredAt;

      expect((yield* store.model).hostResources?.waiting.get("r1")?.queuedAt).toBe(occurredAt);

      return occurredAt;
    }).pipe(Effect.provide(EventStore.layerSqlite(filename)))
  );

  const reloaded = await Effect.runPromise(
    Effect.gen(function* () {
      return (yield* (yield* EventStore).model).hostResources?.waiting.get("r1")?.queuedAt;
    }).pipe(Effect.provide(EventStore.layerSqlite(filename)))
  );

  expect(reloaded).toBe(committedAt);
});
