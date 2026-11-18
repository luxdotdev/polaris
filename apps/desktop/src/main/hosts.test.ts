import { describe, expect, test } from "bun:test";
import {
  type ConnectionStatus,
  type HostConnection,
  type HostConnectionOptions,
  HostConnector,
  HostRegistry,
  HostTarget,
} from "@polaris/client";
import { RelayAddress } from "@polaris/protocol/relay";
import { Context, Effect, Layer, Redacted, Schema, Stream, SubscriptionRef } from "effect";
import { HostDirectory, type HostEntry, hostEntries, hostKind } from "./hosts.ts";

describe("hostKind", () => {
  test("only the local Host is local; an extra socket Host has no alias but is not it", () => {
    const entries = hostEntries({
      local: {
        socketPath: "/tmp/local.sock",
        installedHome: null,
        benchHarness: false,
        stop: () => Promise.resolve(),
      },
      remotes: [{ alias: "studio" }, { alias: "Ubuntu", kind: "wsl" }],
      extras: [{ key: "bench", label: "Bench", socket: "/tmp/bench.sock" }],
    });

    expect(entries.map((e) => [e.key, e.alias, hostKind(e)])).toEqual([
      ["local", null, "local"],
      ["bench", null, "socket"],
      ["studio", "studio", "ssh"],
      ["Ubuntu", "Ubuntu", "wsl"],
    ]);
  });
});

/** A fake of only what the code under test reads. */
// SAFETY: the directory reads only `changes` and `status` of a connection that never changes.
const only = <T>(part: Partial<T>): T => part as T;

describe("a Teammate's Host", () => {
  const target = HostTarget.Relay({
    relayUrl: "wss://relay.example/v1",
    hostAddress: Schema.decodeSync(RelayAddress)("AAAAAAAAAAAAAAAAAAAAAA"),
    hostNoiseKey: "k",
  });

  const as = (accountId: string, label = "Mac Studio"): HostEntry => ({
    key: "shared",
    label,
    colour: null,
    alias: null,
    proofHarness: false,
    target,
    remoteCommand: null,
    simulatedLatencyMs: null,
    teammate: {
      accountId,
      accountStatement: Effect.succeed(Redacted.make(`statement-${accountId}`)),
    },
  });

  test("an Account change reconnects it with the new Account's statement; a new name alone does not", async () => {
    const dialled: Array<HostConnectionOptions> = [];

    // A connection that never changes state: only what was dialled matters here.
    const connector = Layer.succeed(HostConnector)(
      HostConnector.of({
        connect: (options) =>
          Effect.gen(function* () {
            dialled.push(options);

            return only<HostConnection>({
              changes: Stream.never,
              status: yield* SubscriptionRef.make(only<ConnectionStatus>({})),
            });
          }),
      })
    );

    const statements = () =>
      Effect.forEach(dialled, (options) =>
        Effect.map(options.identity.accountStatement ?? Effect.succeed(null), (statement) =>
          statement === null ? null : Redacted.value(statement)
        )
      );

    const presented = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const directory = Context.get(
            yield* Layer.build(
              HostDirectory.layer({
                entries: [as("personal")],
                identity: { name: "Polaris", version: "0", deviceLabel: "Mac", capabilities: [] },
              }).pipe(Layer.provideMerge(HostRegistry.layer), Layer.provide(connector))
            ),
            HostDirectory
          );

          yield* directory.add(as("personal", "Studio"));
          const renamed = yield* statements();
          yield* directory.add(as("work"));

          return { renamed, changed: yield* statements() };
        })
      )
    );

    expect(presented.renamed).toEqual(["statement-personal"]);
    expect(presented.changed).toEqual(["statement-personal", "statement-work"]);
  });
});
