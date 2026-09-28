/**
 * The install flow against a fake ssh that runs each remote command in a
 * local `sh` with HOME pointed at a temporary "Host". The remote shell
 * scripts (probe, upload, SHA check) therefore run for real; the uploaded
 * `polaris` is a small shell stand-in for the Daemon's install/upgrade.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { type DaemonBuild, loadBuilds, platformFromUname } from "./builds.ts";
import { ensureDaemon, parseProbe } from "./remote.ts";
import { classifySshFailure, Ssh, SshError } from "./Ssh.ts";

const uname = (flag: string) => Bun.spawnSync(["uname", flag]).stdout.toString().trim();
const platform = platformFromUname(uname("-s"), uname("-m"))!;

let host: string;
let dist: string;
const commands: Array<string> = [];

/** Runs `command` like sshd would, with the fake Host's HOME. */
const localSsh = (options: { corruptUploads?: boolean; unreachable?: boolean } = {}) =>
  Layer.succeed(
    Ssh,
    Ssh.of({
      exec: (alias, command, execOptions) =>
        Effect.gen(function* () {
          commands.push(command);
          if (options.unreachable) {
            return yield* new SshError({
              alias,
              failure: "unreachable",
              message: "ssh: connect to host h port 22: Connection refused",
            });
          }
          const stdin = execOptions?.stdinFile ? readFileSync(execOptions.stdinFile) : undefined;
          const bytes =
            stdin && options.corruptUploads ? Buffer.concat([stdin, Buffer.from("!")]) : stdin;
          const proc = Bun.spawnSync(["sh", "-c", command], {
            env: { PATH: process.env.PATH, HOME: host },
            stdin: bytes ?? "ignore",
          });
          return {
            code: proc.exitCode ?? 1,
            stdout: proc.stdout.toString(),
            stderr: proc.stderr.toString(),
          };
        }),
    })
  );

/** A stand-in `polaris` that installs itself and upgrades like the real one. */
const fakePolaris = (version: string) => `#!/bin/sh
case "$1" in
  version) echo "polaris ${version} ${platform}" ;;
  install)
    dir="$HOME/.polaris/bin/${version}"; mkdir -p "$dir"
    cp "$0" "$dir/polaris"; cp "$(dirname "$0")/libnative.so" "$dir/"
    ln -sfn "${version}" "$HOME/.polaris/bin/current"
    echo '{"ok":true,"action":"install","version":"${version}"}' ;;
  upgrade)
    new=$("$2" version | cut -d' ' -f2); dir="$HOME/.polaris/bin/$new"; mkdir -p "$dir"
    cp "$2" "$dir/polaris"; ln -sfn "$new" "$HOME/.polaris/bin/current"
    echo "{\\"ok\\":true,\\"action\\":\\"handoff\\",\\"version\\":\\"$new\\"}" ;;
esac
`;

const sha = (content: string) => createHash("sha256").update(content).digest("hex");

/** Write a dist directory like scripts/build-daemon.ts does, for this machine's platform. */
const writeDist = (version: string): ReadonlyArray<DaemonBuild> => {
  const binary = fakePolaris(version);
  const native = `native library ${version}`;
  mkdirSync(join(dist, platform), { recursive: true });
  writeFileSync(join(dist, platform, "polaris"), binary);
  chmodSync(join(dist, platform, "polaris"), 0o755);
  writeFileSync(join(dist, platform, "libnative.so"), native);
  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify({
      version,
      commit: "test",
      platforms: {
        [platform]: {
          target: "x",
          binary: "polaris",
          sha256: sha(binary),
          files: {
            polaris: { sha256: sha(binary), size: binary.length },
            "libnative.so": { sha256: sha(native), size: native.length },
          },
        },
      },
    })
  );
  return loadBuilds(dist);
};

beforeEach(() => {
  host = mkdtempSync(join(tmpdir(), "polaris-host-"));
  dist = mkdtempSync(join(tmpdir(), "polaris-dist-"));
  commands.length = 0;
});
afterEach(() => {
  rmSync(host, { recursive: true, force: true });
  rmSync(dist, { recursive: true, force: true });
});

const current = () => readlinkSync(join(host, ".polaris", "bin", "current"));

describe("ensureDaemon", () => {
  test("first contact asks for approval and touches nothing", async () => {
    const builds = writeDist("1.0.0");
    const result = await Effect.runPromise(
      ensureDaemon("h", builds, { trigger: "user", approvedSha256: new Set() }).pipe(
        Effect.provide(localSsh())
      )
    );
    expect(result).toMatchObject({
      _tag: "ApprovalNeeded",
      plan: { platform, version: "1.0.0", sha256: builds[0]!.sha256 },
    });
    expect(commands).toHaveLength(1); // only the probe
  });

  test("installs the approved build, then is up to date", async () => {
    const builds = writeDist("1.0.0");
    const approved = { trigger: "user", approvedSha256: new Set([builds[0]!.sha256]) } as const;
    const result = await Effect.runPromise(
      ensureDaemon("h", builds, approved).pipe(Effect.provide(localSsh()))
    );
    expect(result).toMatchObject({
      _tag: "Ready",
      applied: { _tag: "Installed", version: "1.0.0" },
    });
    expect(current()).toBe("1.0.0");
    expect(readFileSync(join(host, ".polaris/bin/1.0.0/libnative.so"), "utf8")).toBe(
      "native library 1.0.0"
    );
    // The upload directory is cleaned up.
    expect(
      Bun.spawnSync(["ls", join(host, ".polaris")])
        .stdout.toString()
        .trim()
    ).toBe("bin");

    const again = await Effect.runPromise(
      ensureDaemon("h", builds, { trigger: "background", approvedSha256: new Set() }).pipe(
        Effect.provide(localSsh())
      )
    );
    expect(again).toMatchObject({ _tag: "Ready", plan: { _tag: "UpToDate" }, applied: null });
  });

  test("upgrades an installed Daemon with polaris upgrade <path>", async () => {
    const v1 = writeDist("1.0.0");
    await Effect.runPromise(
      ensureDaemon("h", v1, { trigger: "user", approvedSha256: new Set([v1[0]!.sha256]) }).pipe(
        Effect.provide(localSsh())
      )
    );
    const v2 = writeDist("1.1.0");
    commands.length = 0;
    const result = await Effect.runPromise(
      ensureDaemon("h", v2, { trigger: "background", approvedSha256: new Set() }).pipe(
        Effect.provide(localSsh())
      )
    );
    expect(result).toMatchObject({
      _tag: "Ready",
      applied: { _tag: "Upgraded", from: "1.0.0", version: "1.1.0" },
    });
    expect(current()).toBe("1.1.0");
    expect(commands.some((c) => c.includes("current/polaris") && c.includes("upgrade"))).toBe(true);
  });

  test("refuses an upload whose SHA-256 does not match on the Host", async () => {
    const builds = writeDist("1.0.0");
    const error = await Effect.runPromise(
      ensureDaemon("h", builds, {
        trigger: "user",
        approvedSha256: new Set([builds[0]!.sha256]),
      }).pipe(Effect.flip, Effect.provide(localSsh({ corruptUploads: true })))
    );
    expect(error).toMatchObject({ _tag: "RemoteInstallError", step: "upload polaris" });
    expect(error.message).toContain("SHA-256 on the Host");
  });

  test("passes ssh failures through, classified", async () => {
    const error = await Effect.runPromise(
      ensureDaemon("h", writeDist("1.0.0"), { trigger: "user", approvedSha256: new Set() }).pipe(
        Effect.flip,
        Effect.provide(localSsh({ unreachable: true }))
      )
    );
    expect(error).toBeInstanceOf(SshError);
    expect((error as SshError).needsAttention).toBe(false);
  });
});

describe("parsing", () => {
  test("parseProbe reads the probe's key=value lines", () => {
    expect(parseProbe("os=Linux\narch=aarch64\ninstalled=polaris 1.0.0 linux-arm64\n")).toEqual({
      os: "Linux",
      arch: "aarch64",
      installed: { version: "1.0.0", platform: "linux-arm64" },
    });
    expect(parseProbe("os=Darwin\narch=arm64\n")?.installed).toBeNull();
    expect(parseProbe("Welcome to Ubuntu\n")).toBeNull();
  });

  test("parseProbe reads musl and its missing runtime libraries", () => {
    expect(parseProbe("os=Linux\narch=x86_64\nlibc=musl\nmissing=libstdc++.so.6\n")).toEqual({
      os: "Linux",
      arch: "x86_64",
      libc: "musl",
      missingLibraries: ["libstdc++.so.6"],
      installed: null,
    });
    expect(parseProbe("os=Linux\narch=x86_64\nlibc=musl\n")?.missingLibraries).toEqual([]);
  });

  test("classifySshFailure", () => {
    expect(classifySshFailure("Host key verification failed.")).toBe("host-key");
    expect(classifySshFailure("user@h: Permission denied (publickey).")).toBe("auth");
    expect(classifySshFailure("ssh: Could not resolve hostname nope")).toBe("unreachable");
  });
});
