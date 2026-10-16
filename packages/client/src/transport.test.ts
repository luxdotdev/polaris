import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SpawnOptions as NodeSpawnOptions, spawn } from "node:child_process";
import { Effect } from "effect";
import { connectorFor, HostTarget } from "./HostConnection.ts";
import { nodeChildProcess } from "./process/index.ts";
import { encodeJsonFrame } from "@polaris/protocol";
import { isFrameStart, spawnTransport } from "./transport.ts";

const identity = { name: "test", version: "0.0.0", deviceLabel: "test", capabilities: [] };

describe("the ssh connector", () => {
  test("a missing configured ssh binary is ssh missing, not a missing command", async () => {
    const controlDir = mkdtempSync(join(tmpdir(), "polaris-ssh-"));

    try {
      const failure = await Effect.runPromise(
        Effect.scoped(
          connectorFor({
            key: "studio",
            name: "studio",
            target: HostTarget.Ssh({ alias: "studio" }),
            identity,
            ssh: { sshBinary: join(controlDir, "usr", "bin", "ssh.exe"), controlDir },
          })
        ).pipe(Effect.flip)
      );

      expect(failure.reason).toBe("ssh-missing");
    } finally {
      rmSync(controlDir, { recursive: true, force: true });
    }
  });
});

describe("spawnTransport", () => {
  test("hides the child's console window on Windows", async () => {
    const seen: Array<NodeSpawnOptions> = [];

    // SAFETY: records the options and delegates; the overload set is wider than this call.
    const recording = ((
      command: string,
      args: ReadonlyArray<string>,
      options: NodeSpawnOptions
    ) => {
      seen.push(options);

      return spawn(command, args, options);
    }) as typeof spawn;

    await Effect.runPromise(
      Effect.scoped(
        spawnTransport(["true"], { processes: nodeChildProcess(recording), killAfterMs: 10 })
      )
    );
    expect(seen.map((options) => options.windowsHide)).toEqual([true]);
  });
});

describe("isFrameStart", () => {
  test("a Daemon's first frame is the wire; wsl.exe's message, in either encoding, is text", () => {
    const message = "There is no distribution with the supplied name.\r\n";

    expect(isFrameStart(encodeJsonFrame('{"_tag":"Response"}'))).toBe(true);
    expect(isFrameStart(Buffer.from(message, "utf8"))).toBe(false);
    expect(isFrameStart(Buffer.from(message, "utf16le"))).toBe(false);
  });
});
