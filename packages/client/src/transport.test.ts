import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SpawnOptions as NodeSpawnOptions, spawn } from "node:child_process";
import { Effect, Stream } from "effect";
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

describe.skipIf(process.platform === "win32")("the ssh connector to a Windows Host", () => {
  test("runs the relay and speaks to it in base64 lines, with replies untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-ssh-"));

    try {
      // Stands in for ssh plus the Host's relay: refuses any other remote command,
      // decodes the lines it gets and writes the bytes back raw.
      const relay = join(dir, "relay.ts");
      writeFileSync(
        relay,
        [
          "const command = process.argv.at(-1) ?? '';",
          "if (!command.startsWith('$input | & ([ScriptBlock]::Create(')) process.exit(3);",
          "let rest = '';",
          "for await (const chunk of Bun.stdin.stream()) {",
          "  rest += new TextDecoder().decode(chunk);",
          "  const lines = rest.split('\\n');",
          "  rest = lines.pop() ?? '';",
          "  for (const line of lines) process.stdout.write(Buffer.from(line, 'base64'));",
          "}",
        ].join("\n")
      );
      const ssh = join(dir, "ssh");
      writeFileSync(ssh, `#!/bin/sh\nexec '${process.execPath}' '${relay}' "$@"\n`, {
        mode: 0o755,
      });
      const frame = new Uint8Array(100_000).map((_, i) => (i * 17) % 256);

      const echoed = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const transport = yield* connectorFor({
              key: "pc",
              name: "pc",
              target: HostTarget.Ssh({ alias: "pc", windowsShell: "powershell" }),
              identity,
              ssh: { sshBinary: ssh, controlDir: dir },
            });

            yield* transport.write(frame);
            let got = new Uint8Array(0);

            yield* transport.incoming.pipe(
              Stream.takeUntil((chunk) => {
                got = new Uint8Array([...got, ...chunk]);

                return got.byteLength >= frame.byteLength;
              }),
              Stream.runDrain
            );

            return got;
          })
        )
      );

      expect(Buffer.from(echoed)).toEqual(Buffer.from(frame));
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
