/** Main owns persistence; a live connection publishes values and confirms applied relay changes. */
import type { LiveSession } from "@polaris/client";
import {
  type ClientSettingChange,
  type ClientSettingsSnapshot,
  type SessionId,
} from "@polaris/protocol";
import { Deferred, Effect, Stream, SubscriptionRef } from "effect";
import {
  clientSettingsSnapshot,
  clientSettingIsUserOnly,
  decodeClientSetting,
  readClientSetting,
  type ClientSettingsSource,
} from "../shared/clientSettings.ts";
import type { AppEvent } from "../shared/api.ts";

type Json = ClientSettingChange["value"];

interface Undo {
  key: string;
  previous: Json | undefined;
  value: Json;
  hostKey?: string;
}

interface Activity {
  hostKey: string | null;
  sessionId: SessionId | null;
  active: boolean;
}

interface Input {
  get: (hostKey?: string) => ClientSettingsSource;
  apply: (key: string, value: Json | undefined, hostKey?: string) => void;
  publish: (event: AppEvent) => void;
}

export const createClientSettingsBridge = (input: Input) => {
  const changes = Effect.runSync(SubscriptionRef.make(0));
  const undo = new Map<string, Undo>();

  let activity: Activity = {
    hostKey: null,
    sessionId: null,
    active: false,
  };

  const snapshot = (hostKey: string): ClientSettingsSnapshot => ({
    settings: clientSettingsSnapshot(input.get(hostKey)),
    sessionId: activity.hostKey === hostKey ? activity.sessionId : null,
    active: activity.active,
  });

  const changed = () => {
    for (const [id, record] of undo) {
      const current = clientSettingsSnapshot(input.get(record.hostKey)).find(
        (s) => s.key === record.key
      )?.value;

      if (JSON.stringify(current) !== JSON.stringify(record.value)) undo.delete(id);
    }

    Effect.runSync(SubscriptionRef.update(changes, (n) => n + 1));
  };

  const apply = (key: string, value: Json, requestId?: string, hostKey?: string) => {
    if (clientSettingIsUserOnly(key))
      throw new Error(`NotGranted: Only the user can change ${key}.`);
    const decoded = decodeClientSetting(key, value);
    const previous = readClientSetting(input.get(hostKey), key);
    input.apply(key, decoded, hostKey);
    changed();

    if (requestId === undefined) return;
    const previousValue = clientSettingsSnapshot({}).find((s) => s.key === key)?.default ?? null;
    const record: Undo = { key, previous, value: decoded };

    if (hostKey !== undefined) record.hostKey = hostKey;
    undo.set(requestId, record);

    if (undo.size > 64) {
      const oldest = undo.keys().next().value;

      if (oldest !== undefined) undo.delete(oldest);
    }

    input.publish({
      kind: "client-settings-changed",
      requestId,
      key,
      value: decoded,
      previousValue: previous ?? previousValue,
    });
  };

  const restore = (requestId: string) => {
    const record = undo.get(requestId);

    if (record === undefined)
      throw new Error("This setting changed again. Keep its current value.");
    input.apply(record.key, record.previous, record.hostKey);
    undo.delete(requestId);
    changed();
  };

  const watch = (hostKey: string, sessions: Stream.Stream<LiveSession | null>) =>
    sessions.pipe(
      Stream.switchMap((session) =>
        session === null || !session.capabilities.includes("client-settings")
          ? Stream.empty
          : Stream.fromEffectDrain(
              Effect.gen(function* () {
                const ready = yield* Deferred.make<void>();

                const requests = session.client["clientSettings.connect"](snapshot(hostKey)).pipe(
                  Stream.runForEach((request) => {
                    if (request === null) return Effect.asVoid(Deferred.succeed(ready, undefined));

                    return Effect.gen(function* () {
                      const error = yield* Effect.try({
                        try: () => apply(request.key, request.value, request.requestId, hostKey),
                        catch: (e) => String(e),
                      }).pipe(Effect.match({ onFailure: (e) => e, onSuccess: () => null }));

                      yield* session.client["clientSettings.complete"]({
                        requestId: request.requestId,
                        error,
                        settings: clientSettingsSnapshot(input.get(hostKey)),
                      });
                    });
                  })
                );

                const publish = Deferred.await(ready).pipe(
                  Effect.andThen(
                    SubscriptionRef.changes(changes).pipe(
                      Stream.runForEach(() =>
                        session.client["clientSettings.publish"](snapshot(hostKey))
                      )
                    )
                  )
                );

                yield* Effect.all([requests, publish], { concurrency: "unbounded", discard: true });
              }).pipe(Effect.ignore)
            )
      ),
      Stream.runDrain
    );

  return {
    apply,
    undo: restore,
    changed,
    watch,
    activity: (value: typeof activity) => {
      activity = value;
      changed();
    },
  };
};

export type ClientSettingsBridge = ReturnType<typeof createClientSettingsBridge>;
