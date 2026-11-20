import { expect, test } from "bun:test";
import { ClientSettingsRpcs, SessionId, type SettingValue } from "@polaris/protocol";
import { Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { ClientSettings, ClientSettingsRpcHandlers } from "./index.ts";

const theme = (value: string): SettingValue => ({
  key: "theme",
  description: "Appearance",
  type: { type: "string", enum: ["system", "dark", "light"] },
  default: "system",
  value,
  overridden: value !== "system",
});

const services = ClientSettingsRpcHandlers.pipe(Layer.provideMerge(ClientSettings.layer));

const run = <A, E>(
  body: Effect.Effect<A, E, Layer.Success<typeof services> | import("effect").Scope.Scope>
) => Effect.runPromise(Effect.scoped(body.pipe(Effect.provide(services))));

const desktop = Effect.fnUntraced(function* (
  id: number,
  sessionId: string | null,
  active: boolean = true
) {
  const relay = yield* ClientSettings;
  const ready = yield* Deferred.make<void>();
  const received: string[] = [];

  const fiber = yield* relay
    .connect(id, {
      settings: [theme("system")],
      sessionId: sessionId === null ? null : SessionId.make(sessionId),
      active,
    })
    .pipe(
      Stream.runForEach((request) =>
        request === null
          ? Effect.asVoid(Deferred.succeed(ready, undefined))
          : Effect.gen(function* () {
              received.push(request.key);
              yield* relay.complete(id, request.requestId, null, [
                theme(Schema.decodeUnknownSync(Schema.String)(request.value)),
              ]);
            })
      ),
      Effect.forkChild
    );

  yield* Deferred.await(ready);

  return { received, fiber };
});

test("a set targets the Client showing the requesting session before the most recently active Client", () =>
  run(
    Effect.gen(function* () {
      const first = yield* desktop(1, "caller");
      const recent = yield* desktop(2, "other");
      const rpc = yield* RpcTest.makeClient(ClientSettingsRpcs);

      const result = yield* rpc["clientSettings.set"]({
        key: "theme",
        value: "dark",
        sessionId: SessionId.make("caller"),
      });

      expect(result.value).toBe("dark");
      expect(first.received).toEqual(["theme"]);
      expect(recent.received).toEqual([]);
      expect(
        (yield* rpc["clientSettings.get"]({ key: "theme", sessionId: SessionId.make("other") }))
          .value
      ).toBe("system");
    })
  ));

test("without a visible session the latest active Client is used, and activity updates the target", () =>
  run(
    Effect.gen(function* () {
      const first = yield* desktop(1, null);
      const recent = yield* desktop(2, null);
      const inactive = yield* desktop(3, null, false);
      const rpc = yield* RpcTest.makeClient(ClientSettingsRpcs);
      yield* rpc["clientSettings.set"]({ key: "theme", value: "light" });
      const relay = yield* ClientSettings;
      yield* relay.publish(1, { settings: [theme("system")], sessionId: null, active: true });
      yield* rpc["clientSettings.set"]({ key: "theme", value: "dark" });
      expect(first.received).toEqual(["theme"]);
      expect(recent.received).toEqual(["theme"]);
      expect(inactive.received).toEqual([]);
    })
  ));

test("no connected Client fails immediately; a later connection receives no queued change", () =>
  run(
    Effect.gen(function* () {
      const rpc = yield* RpcTest.makeClient(ClientSettingsRpcs);
      expect(
        (yield* Effect.flip(rpc["clientSettings.set"]({ key: "theme", value: "dark" }))).message
      ).toBe("no Client connected");
      const client = yield* desktop(1, null);
      expect((yield* rpc["clientSettings.get"]({ key: "theme" })).value).toBe("system");
      expect(client.received).toEqual([]);
      yield* Fiber.interrupt(client.fiber);
      expect((yield* Effect.flip(rpc["clientSettings.list"]({}))).message).toBe(
        "no Client connected"
      );
    })
  ));

test("disconnect fails a pending set and another connection cannot complete it", () =>
  run(
    Effect.gen(function* () {
      const relay = yield* ClientSettings;
      const ready = yield* Deferred.make<void>();
      const received = yield* Deferred.make<string>();

      const client = yield* relay
        .connect(1, { settings: [theme("system")], sessionId: null, active: true })
        .pipe(
          Stream.runForEach((request) =>
            request === null
              ? Effect.asVoid(Deferred.succeed(ready, undefined))
              : Effect.asVoid(Deferred.succeed(received, request.requestId))
          ),
          Effect.forkChild
        );

      yield* Deferred.await(ready);
      const setter = yield* relay.set("theme", "dark").pipe(Effect.flip, Effect.forkChild);
      const requestId = yield* Deferred.await(received);
      expect(
        (yield* Effect.flip(relay.complete(2, requestId, null, [theme("dark")]))).message
      ).toBe("Unknown Client Settings request");
      yield* Fiber.interrupt(client);
      expect((yield* Fiber.join(setter)).message).toBe("Client disconnected");
    })
  ));
