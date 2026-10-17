/**
 * `HostAccess`'s contract against its test Layer: one channel per `HostTarget`, a local
 * channel only for an installed local Host and never on Windows. Nothing spawns, so this
 * runs on the Windows CI leg too.
 */
import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { HostTarget } from "../HostConnection.ts";
import { probeHost } from "../install/remote.ts";
import { SshError, type SshResult } from "../install/Ssh.ts";
import { HostAccess, type HostChannel } from "./index.ts";

const ok = (stdout = ""): SshResult => ({ code: 0, stdout, stderr: "" });

interface Ran {
  readonly target: string;
  readonly command: string;
}

const scripted = (platform: NodeJS.Platform = "darwin") => {
  const ran: Array<Ran> = [];

  const layer = HostAccess.test(
    (target, command) => {
      ran.push({ target: target._tag, command });

      return command === "fail"
        ? Effect.fail(new SshError({ alias: "x", failure: "auth", message: "denied" }))
        : Effect.succeed(ok(`ran on ${target._tag}`));
    },
    { platform, ssh: { sshBinary: platform === "win32" ? "C:\\ssh.exe" : undefined } }
  );

  const channel = (target: HostTarget) =>
    Effect.runPromise(
      HostAccess.use((access) => access.channel(target)).pipe(Effect.provide(layer))
    );

  const refused = (target: HostTarget) =>
    Effect.runPromise(
      HostAccess.use((access) => access.channel(target)).pipe(Effect.flip, Effect.provide(layer))
    );

  return { ran, channel, refused };
};

const run = (channel: HostChannel, command: string) => Effect.runPromise(channel.exec(command));

describe("HostAccess", () => {
  test("an ssh target runs over ssh, asks for approval, and opens ssh in a terminal", async () => {
    const t = scripted();
    const channel = await t.channel(HostTarget.Ssh({ alias: "studio" }));

    expect(channel).toMatchObject({ kind: "ssh", alias: "studio", home: null, trusted: false });
    expect((await run(channel, "uname -s")).stdout).toBe("ran on Ssh");
    expect(await Effect.runPromise(channel.interactiveArgv)).toEqual(["ssh", "--", "studio"]);
    expect(t.ran).toEqual([{ target: "Ssh", command: "uname -s" }]);
  });

  test("the terminal uses the configured or Windows ssh binary", async () => {
    const channel = await scripted("win32").channel(HostTarget.Ssh({ alias: "pi" }));

    expect(await Effect.runPromise(channel.interactiveArgv)).toEqual(["C:\\ssh.exe", "--", "pi"]);
  });

  test("a WSL target runs in the distro and opens a shell there", async () => {
    const t = scripted("win32");
    const channel = await t.channel(HostTarget.Wsl({ distro: "Ubuntu" }));

    expect(channel).toMatchObject({ kind: "wsl", alias: "Ubuntu", trusted: false });
    expect((await run(channel, "true")).stdout).toBe("ran on Wsl");
    expect(await Effect.runPromise(channel.interactiveArgv)).toEqual([
      "wsl.exe",
      "--distribution",
      "Ubuntu",
    ]);
  });

  test("this machine's installed Daemon runs locally, trusted, with no terminal hand-off", async () => {
    const t = scripted();
    const target = HostTarget.Local({ socketPath: "/h/.polaris/daemon.sock", installedHome: "/h" });
    const channel = await t.channel(target);

    expect(channel).toMatchObject({ kind: "local", alias: "local", home: "/h", trusted: true });
    expect((await run(channel, "true")).stdout).toBe("ran on Local");
    const refused = await Effect.runPromise(Effect.flip(channel.interactiveArgv));
    expect(refused.reason).toBe("no-terminal");
  });

  test("a local Host Polaris didn't install has no channel, never an ssh fall-through", async () => {
    const t = scripted();
    const error = await t.refused(HostTarget.Local({ socketPath: "/tmp/dev/daemon.sock" }));

    expect(error._tag).toBe("HostActionUnsupported");
    expect(error.reason).toBe("unmanaged-local");
    expect(t.ran).toEqual([]);
  });

  test("a Windows Client never gets a local channel, installed home or not", async () => {
    const t = scripted("win32");

    const error = await t.refused(
      HostTarget.Local({ socketPath: "C:\\h\\daemon.sock", installedHome: "C:\\h" })
    );

    expect(error.reason).toBe("local-unsupported");
    expect(t.ran).toEqual([]);
  });

  test("a channel's own failure is the SshError it reported", async () => {
    const channel = await scripted().channel(HostTarget.Ssh({ alias: "studio" }));
    const error = await Effect.runPromise(Effect.flip(channel.exec("fail")));

    expect(error.failure).toBe("auth");
  });

  test("the install flow runs on a channel's Ssh layer under its alias", async () => {
    const t = scripted();
    const channel = await t.channel(HostTarget.Wsl({ distro: "Ubuntu" }));

    const probe = await Effect.runPromise(
      probeHost(channel.alias).pipe(Effect.provide(Layer.mergeAll(channel.ssh)), Effect.flip)
    );

    // The scripted answer isn't a probe (POSIX or Windows), so the flow reports it against the distro.
    expect(probe).toMatchObject({ alias: "Ubuntu" });
    expect(new Set(t.ran.map((r) => r.target))).toEqual(new Set(["Wsl"]));
  });
});
