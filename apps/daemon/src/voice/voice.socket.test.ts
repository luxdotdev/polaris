/**
 * `voice.transcribe` over a real socket (ENG-404): an Extension with the voice
 * Grant streams PCM as a blob and gets snapshots back from a fake provider;
 * without the Grant, or without a key, it is refused; the key never comes back.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectRpcWith, socketTransport } from "@polaris/client";
import {
  ExtensionDaemonRpcs,
  type Grant,
  NotGranted,
  VoiceError,
  VoiceSettings,
  VoiceTranscript,
} from "@polaris/protocol";
import { Effect, Exit, Fiber, Layer, Redacted, type Scope, Stream } from "effect";
import type { RpcGroup } from "effect/rpc";
import { shortTemp } from "../platform/testing.ts";
import { startServer } from "../transport/server.ts";
import { HostSecrets, memorySecrets } from "../secrets/index.ts";
import { VoiceProvider } from "./provider.ts";
import { makeVoiceRpcs } from "./VoiceRpcs.ts";
import { NO_KEY_MESSAGE } from "./keys.ts";

const KEY = "0123456789abcdef0123456789abcdef01234567";

/** Says how many bytes it heard after each chunk, then the total as final text, under the key it got. */
const countingProvider = VoiceProvider.of({
  kind: "deepgram",
  transcribe: (key, audio) =>
    Stream.unwrap(
      Effect.sync(() => {
        let heard = 0;

        return audio.pipe(
          Stream.map((chunk) => {
            heard += chunk.byteLength;

            return { text: `${heard} bytes`, isFinal: false };
          }),
          Stream.concat(
            Stream.sync(() => ({
              text: `${heard} bytes for ${Redacted.value(key).slice(0, 4)}`,
              isFinal: true,
            }))
          )
        );
      })
    ),
});

const temporary = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(shortTemp("pl-voice-"))),
  (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true }))
);

const identity = { clientName: "test", clientVersion: "0", deviceLabel: "Test", capabilities: [] };

const pcm = (bytes: number) => new Uint8Array(bytes).fill(1);

const run = <A>(
  body: (helpers: Helpers) => Effect.Effect<A, unknown, Scope.Scope>,
  limit?: number
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* temporary;
        const secrets = memorySecrets();

        const server = yield* startServer({
          root,
          socketPath: join(root, "d.sock"),
          lockPath: join(root, "d.lock"),
          handlers: makeVoiceRpcs(limit).pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(VoiceProvider)(countingProvider),
                Layer.succeed(HostSecrets)(secrets)
              )
            )
          ),
        });

        const connect = () =>
          Effect.flatMap(socketTransport(server.socketPath), (transport) =>
            connectRpcWith(ExtensionDaemonRpcs, transport)
          );

        const desktop = yield* connect();
        yield* desktop.client.hello(identity);

        const extension = (grant: Grant) =>
          Effect.gen(function* () {
            const { token } = yield* desktop.client["extensions.pair"]({ name: "G2", grant });
            const connection = yield* connect();
            yield* connection.client.hello({ ...identity, extensionToken: Redacted.make(token) });

            return connection;
          });

        return yield* body({ desktop, extension });
      })
    )
  );

type Connection = Effect.Success<
  ReturnType<typeof connectRpcWith<RpcGroup.Rpcs<typeof ExtensionDaemonRpcs>>>
>;

interface Helpers {
  readonly desktop: Connection;
  readonly extension: (grant: Grant) => Effect.Effect<Connection, unknown, Scope.Scope>;
}

const transcribe = (
  connection: Connection,
  chunks: ReadonlyArray<Uint8Array>
): Effect.Effect<ReadonlyArray<VoiceTranscript>, unknown> =>
  Effect.gen(function* () {
    const audio = yield* connection.blobs.offer(Stream.fromIterable(chunks));

    return yield* Stream.runCollect(connection.client["voice.transcribe"]({ audio }));
  });

test("an Extension with the voice Grant streams audio and gets snapshots, ending finished", async () => {
  const snapshots = await run(({ desktop, extension }) =>
    Effect.gen(function* () {
      const settings = yield* desktop.client["voice.setKey"]({
        provider: "deepgram",
        key: Redacted.make(` ${KEY}\n`),
      });

      expect(settings).toEqual(
        new VoiceSettings({ provider: "deepgram", keySet: true, store: "file" })
      );
      const glasses = yield* extension(["voice"]);

      return yield* transcribe(glasses, [pcm(3200), pcm(3200), pcm(1600)]);
    })
  );

  expect(snapshots.map((s) => [s.finalText, s.interimText, s.finished])).toEqual([
    ["", "3200 bytes", false],
    ["", "6400 bytes", false],
    ["", "8000 bytes", false],
    ["8000 bytes for 0123", "", false],
    ["8000 bytes for 0123", "", true],
  ]);
});

test("without the voice Grant transcribing is refused, and Extensions never touch the key", async () => {
  const outcomes = await run(({ desktop, extension }) =>
    Effect.gen(function* () {
      yield* desktop.client["voice.setKey"]({ provider: "deepgram", key: Redacted.make(KEY) });
      const reader = yield* extension(["read", "turn"]);
      const glasses = yield* extension(["voice"]);

      return {
        transcribe: yield* Effect.exit(transcribe(reader, [pcm(10)])),
        setKey: yield* Effect.exit(
          glasses.client["voice.setKey"]({ provider: "deepgram", key: null })
        ),
        settings: yield* Effect.exit(glasses.client["voice.settings"]()),
      };
    })
  );

  expect(outcomes.transcribe).toEqual(
    Exit.fail(new NotGranted({ what: "voice.transcribe", needed: "voice" }))
  );
  expect(outcomes.setKey).toEqual(
    Exit.fail(new NotGranted({ what: "voice.setKey", needed: null }))
  );
  expect(outcomes.settings).toEqual(
    Exit.fail(new NotGranted({ what: "voice.settings", needed: null }))
  );
});

test("with no key set, transcribing fails saying how to set one", async () => {
  const outcome = await run(({ extension }) =>
    Effect.gen(function* () {
      const glasses = yield* extension(["voice"]);

      return yield* Effect.exit(transcribe(glasses, [pcm(10)]));
    })
  );

  expect(outcome).toEqual(Exit.fail(new VoiceError({ reason: "no-key", message: NO_KEY_MESSAGE })));
});

test("settings say whether a key is set, never the key; a malformed key is refused unrepeated", async () => {
  const result = await run(({ desktop }) =>
    Effect.gen(function* () {
      const before = yield* desktop.client["voice.settings"]();

      const bad = yield* Effect.exit(
        desktop.client["voice.setKey"]({ provider: "deepgram", key: Redacted.make("Token sk-x y") })
      );

      yield* desktop.client["voice.setKey"]({ provider: "deepgram", key: Redacted.make(KEY) });
      const set = yield* desktop.client["voice.settings"]();
      const cleared = yield* desktop.client["voice.setKey"]({ provider: "deepgram", key: null });

      return { before, bad, set, cleared };
    })
  );

  expect([result.before.keySet, result.set.keySet, result.cleared.keySet]).toEqual([
    false,
    true,
    false,
  ]);
  expect(JSON.stringify(result.set)).not.toContain(KEY);
  expect(Exit.isFailure(result.bad)).toBe(true);
  expect(JSON.stringify(result.bad)).toContain("invalid-key");
  expect(JSON.stringify(result.bad)).not.toContain("sk-x");
});

test("the Host runs a bounded number of transcriptions at once and frees a slot when one ends", async () => {
  const outcomes = await run(
    ({ desktop, extension }) =>
      Effect.gen(function* () {
        yield* desktop.client["voice.setKey"]({ provider: "deepgram", key: Redacted.make(KEY) });
        const glasses = yield* extension(["voice"]);
        const endless = yield* glasses.blobs.offer(Stream.never);

        const first = yield* glasses.client["voice.transcribe"]({ audio: endless }).pipe(
          Stream.runDrain,
          Effect.forkScoped
        );

        yield* Effect.sleep("100 millis");
        const second = yield* Effect.exit(transcribe(glasses, [pcm(10)]));
        yield* Fiber.interrupt(first);
        yield* Effect.sleep("100 millis");
        const third = yield* transcribe(glasses, [pcm(10)]);

        return { second, third: third.at(-1) };
      }),
    1
  );

  expect(outcomes.second).toEqual(
    Exit.fail(
      new VoiceError({
        reason: "busy",
        message: "This Host runs at most 1 transcription at once; end one first.",
      })
    )
  );
  expect(outcomes.third?.finished).toBe(true);
});
