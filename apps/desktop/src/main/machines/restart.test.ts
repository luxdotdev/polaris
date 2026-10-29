/**
 * Restart daemon as the renderer sees it: the runner `Machines` picks for a Host, and the
 * outcome each case of the Client's restart becomes. Spawns are scripted; nothing restarts.
 */
import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "@polaris/client";
import { type HostChannel, noLocalShell } from "@polaris/client/access";
import { type SpawnRequest, scriptedChildProcess } from "@polaris/client/process";
import { HostId, HostInfo } from "@polaris/protocol";
import { Effect, SubscriptionRef } from "effect";
import { previewOver, type RestartTarget, restartOver } from "./restart.ts";

const host = (startedAt: string) =>
  new HostInfo({
    hostId: HostId.make("pc"),
    hostname: "pc",
    platform: "windows-x64",
    daemonVersion: "0.5.0",
    homeDir: "C:\\Users\\lucas",
    startedAt,
  });

const status = (patch: Partial<ConnectionStatus>): ConnectionStatus => ({
  state: "needs-attention",
  failure: null,
  attempt: 0,
  since: 0,
  nextAttemptAt: null,
  host: null,
  capabilities: [],
  epoch: 0,
  latencyMs: null,
  lastSeenAt: null,
  ...patch,
});

/** The Client runtime's connection, held in a ref the test moves. */
const connectionAt = (initial: ConnectionStatus) =>
  Effect.map(SubscriptionRef.make(initial), (ref) => ({
    ref,
    connection: {
      status: ref,
      changes: SubscriptionRef.changes(ref),
      session: Effect.die("no session"),
      retryNow: Effect.void,
    } satisfies RestartTarget["connection"],
  }));

const channel = (kind: HostChannel["kind"], home: string | null): HostChannel => ({
  kind,
  describe: kind,
  alias: kind,
  home,
  trusted: kind === "local",
  exec: () => Effect.die("no shell here"),
  ssh: noLocalShell,
  interactiveArgv: Effect.die("no terminal"),
});

describe("restartOver", () => {
  test("this PC restarts through its installed polaris.exe even while its Daemon doesn't answer", async () => {
    const spawned: Array<SpawnRequest> = [];

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { ref, connection } = yield* connectionAt(status({}));

        const processes = scriptedChildProcess((request) => {
          spawned.push(request);
          Effect.runSync(
            SubscriptionRef.set(
              ref,
              status({ state: "connected", host: host("2026-10-29T10:00:00.000Z") })
            )
          );

          return { exit: { code: 0, stdout: '{"ok":true,"action":"install"}' } };
        });

        return yield* restartOver({
          name: "This PC",
          channel: channel("local", "C:\\Users\\lucas"),
          connection,
          windowsShell: false,
          platform: "win32",
          processes,
        });
      })
    );

    expect(spawned.map((r) => r.args)).toEqual([["install", "--restart", "--json"]]);
    expect(result).toMatchObject({
      outcome: "back",
      manager: "task-scheduler",
      startedAt: "2026-10-29T10:00:00.000Z",
    });
  });

  test("a remote Host that isn't connected is refused with the confirm's copy", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const { connection } = yield* connectionAt(status({ state: "offline" }));

        const target: RestartTarget = {
          name: "Mac Studio",
          channel: channel("ssh", null),
          connection,
          windowsShell: false,
          platform: "darwin",
        };

        return { restart: yield* restartOver(target), preview: yield* previewOver(target) };
      })
    );

    expect(result.restart).toEqual({
      outcome: "refused",
      message: "Restarts once Mac Studio is connected",
    });
    expect(result.preview).toEqual({
      available: false,
      unavailableReason: "Restarts once Mac Studio is connected",
      interrupts: null,
    });
  });
});
