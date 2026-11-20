/** Ephemeral Client registrations: a subscription owns its entry and pending requests. */
import {
  ClientSettingsError,
  ClientSettingsRpcs,
  type ClientSettingsSnapshot,
  type ClientSettingChange,
  type SessionId,
  type SettingValue,
} from "@polaris/protocol";
import { Context, Deferred, Effect, Layer, Queue, Stream } from "effect";

interface Client {
  snapshot: ClientSettingsSnapshot;
  activeAt: number;
  changes: Queue.Queue<ClientSettingChange>;
}

interface Pending {
  client: Client;
  key: string;
  result: Deferred.Deferred<SettingValue, ClientSettingsError>;
}

const failure = (message: string) => new ClientSettingsError({ message });

const make = Effect.sync(() => {
  const clients = new Map<number, Client>();
  const pending = new Map<string, Pending>();
  let activity = 0;

  const target = (sessionId?: SessionId) =>
    Effect.suspend(() => {
      const all = [...clients.values()].sort((a, b) => b.activeAt - a.activeAt);

      const client =
        (sessionId === undefined
          ? undefined
          : all.find((c) => c.snapshot.sessionId === sessionId)) ?? all[0];

      return client === undefined
        ? Effect.fail(failure("no Client connected"))
        : Effect.succeed(client);
    });

  const find = (client: Client, key: string) => {
    const value = client.snapshot.settings.find((s) => s.key === key);

    return value === undefined
      ? Effect.fail(failure(`Unknown Client Setting: ${key}`))
      : Effect.succeed(value);
  };

  const remove = (id: number, client: Client) =>
    Effect.gen(function* () {
      if (clients.get(id) === client) clients.delete(id);

      for (const [requestId, request] of pending) {
        if (request.client !== client) continue;

        pending.delete(requestId);
        yield* Deferred.fail(request.result, failure("Client disconnected"));
      }

      yield* Queue.shutdown(client.changes);
    });

  const connect = (id: number, snapshot: ClientSettingsSnapshot) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const old = clients.get(id);

        if (old !== undefined) yield* remove(id, old);

        const changes = yield* Queue.unbounded<ClientSettingChange>();
        const client: Client = { snapshot, activeAt: snapshot.active ? ++activity : 0, changes };
        clients.set(id, client);
        yield* Effect.addFinalizer(() => remove(id, client));

        return Stream.concat(Stream.make(null), Stream.fromQueue(changes));
      })
    );

  const publish = (id: number, snapshot: ClientSettingsSnapshot) =>
    Effect.suspend(() => {
      const client = clients.get(id);

      if (client === undefined) return Effect.fail(failure("no Client connected"));

      client.snapshot = snapshot;

      if (snapshot.active) client.activeAt = ++activity;

      return Effect.void;
    });

  const list = (sessionId?: SessionId) => Effect.map(target(sessionId), (c) => c.snapshot.settings);

  const get = (key: string, sessionId?: SessionId) =>
    Effect.flatMap(target(sessionId), (c) => find(c, key));

  const set = Effect.fnUntraced(function* (key: string, value: SchemaJson, sessionId?: SessionId) {
    const client = yield* target(sessionId);
    yield* find(client, key);

    if (pending.size >= 64) return yield* failure("Too many Client Settings changes in flight");
    const requestId = crypto.randomUUID();
    const result = yield* Deferred.make<SettingValue, ClientSettingsError>();
    pending.set(requestId, { client, key, result });

    return yield* Effect.gen(function* () {
      yield* Queue.offer(client.changes, { requestId, key, value });

      return yield* Deferred.await(result).pipe(
        Effect.timeoutOrElse({
          duration: "10 seconds",
          orElse: () => Effect.fail(failure("Client did not confirm the change")),
        })
      );
    }).pipe(Effect.ensuring(Effect.sync(() => pending.delete(requestId))));
  });

  const complete = (
    id: number,
    requestId: string,
    error: string | null,
    settings: ReadonlyArray<SettingValue>
  ) =>
    Effect.gen(function* () {
      const request = pending.get(requestId);
      const client = clients.get(id);

      if (request === undefined || client !== request.client)
        return yield* failure("Unknown Client Settings request");
      pending.delete(requestId);

      if (error !== null) {
        yield* Deferred.fail(request.result, failure(error));

        return;
      }

      client.snapshot = { ...client.snapshot, settings };
      yield* Deferred.complete(request.result, find(client, request.key));
    });

  return { connect, publish, complete, list, get, set };
});

type SchemaJson = ClientSettingChange["value"];

export class ClientSettings extends Context.Service<ClientSettings, Effect.Success<typeof make>>()(
  "polaris/daemon/ClientSettings"
) {
  static readonly layer = Layer.effect(ClientSettings, make);
}

export const ClientSettingsRpcHandlers = ClientSettingsRpcs.toLayer(
  Effect.gen(function* () {
    const relay = yield* ClientSettings;

    return {
      "clientSettings.connect": (snapshot, { client }) => relay.connect(client.id, snapshot),
      "clientSettings.publish": (snapshot, { client }) => relay.publish(client.id, snapshot),
      "clientSettings.complete": (input, { client }) =>
        relay.complete(client.id, input.requestId, input.error, input.settings),
      "clientSettings.list": ({ sessionId }) => relay.list(sessionId),
      "clientSettings.describe": ({ key, sessionId }) => relay.get(key, sessionId),
      "clientSettings.get": ({ key, sessionId }) => relay.get(key, sessionId),
      "clientSettings.set": ({ key, value, sessionId }) => relay.set(key, value, sessionId),
    };
  })
);
