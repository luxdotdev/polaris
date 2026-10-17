/**
 * `applyPlan` for a Windows Host: stage a private upload directory under
 * `%USERPROFILE%\.polaris`, upload each file as base64 lines and check its SHA-256 there,
 * then `polaris.exe install` or the installed Daemon's `upgrade` (ADR 0060), and clean up.
 */
import { randomBytes } from "node:crypto";
import { Effect, Match } from "effect";
import {
  type ApplyOptions,
  ApplyResult,
  failed,
  RemoteInstallError,
  runPolaris,
} from "../apply.ts";
import type { DaemonBuild } from "../builds.ts";
import type { InstallPlan } from "../plan.ts";
import { Ssh } from "../Ssh.ts";
import type { WindowsShell } from "./powershell.ts";
import {
  cleanUpCommand,
  installCommand,
  stageScript,
  uploadCommand,
  upgradeCommand,
} from "./scripts.ts";
import { encodedCommand } from "./powershell.ts";

const stage = Effect.fn("stageWindows")(function* (alias: string, dir: string) {
  const ssh = yield* Ssh;
  const result = yield* ssh.exec(alias, encodedCommand(stageScript(dir)));

  if (result.code !== 0) return yield* failed(alias, "stage", result);
});

const upload = Effect.fn("uploadWindows")(function* (
  alias: string,
  build: DaemonBuild,
  dir: string,
  shell: WindowsShell,
  progress?: ApplyOptions["progress"]
) {
  const ssh = yield* Ssh;
  const total = build.files.reduce((sum, file) => sum + file.size, 0);
  let sent = 0;
  let reportedAt = 0;
  progress?.({ stage: "uploading", bytes: 0, total });

  for (const file of build.files) {
    const result = yield* ssh.exec(alias, uploadCommand(dir, file, shell), {
      stdinFile: file.path,
      stdinLines: true,
      onStdinBytes: (bytes) => {
        const now = Date.now();

        if (now - reportedAt < 100 && bytes !== file.size) return;
        reportedAt = now;
        progress?.({ stage: "uploading", bytes: sent + bytes, total });
      },
    });

    if (result.code !== 0) return yield* failed(alias, `upload ${file.name}`, result);
    const remoteSha = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";

    if (remoteSha !== file.sha256) {
      return yield* new RemoteInstallError({
        alias,
        step: `upload ${file.name}`,
        message: `SHA-256 on the Host is ${remoteSha || "missing"}, expected ${file.sha256}`,
      });
    }

    sent += file.size;
  }

  progress?.({ stage: "switching", bytes: sent, total });
});

/** The build's files, here: bundled, or downloaded into this machine's cache first. */
const localBuild = (alias: string, build: DaemonBuild, options: ApplyOptions) => {
  if (build.bundled) return Effect.succeed(build);
  const total = build.archive?.size ?? 0;

  if (options.download === undefined) {
    return Effect.fail(
      new RemoteInstallError({
        alias,
        step: "download",
        message: `This app carries no ${build.platform} daemon and cannot download one.`,
      })
    );
  }

  return options.download(build, (bytes) =>
    options.progress?.({ stage: "downloading", via: "client", bytes, total })
  );
};

const cleanUp = (alias: string, dir: string) =>
  Ssh.use((ssh) => ssh.exec(alias, cleanUpCommand(dir))).pipe(Effect.ignore);

/** Carry out an `Install` or `Upgrade` plan on a Windows Host whose sshd runs `shell`. */
export const applyWindowsPlan = Effect.fn("applyWindowsPlan")(function* (
  alias: string,
  plan: Extract<InstallPlan, { _tag: "Install" | "Upgrade" }>,
  shell: WindowsShell,
  options: ApplyOptions = {}
) {
  const dir = `upload-${randomBytes(6).toString("hex")}`;
  const binary = plan.build.files[0]!.name;
  const sha256 = plan.build.sha256;
  const replaceTask = options.replaceTask === true;

  return yield* Effect.gen(function* () {
    const build = yield* localBuild(alias, plan.build, options);
    yield* stage(alias, dir);
    yield* upload(alias, build, dir, shell, options.progress);

    return yield* Match.value(plan).pipe(
      Match.tagsExhaustive({
        Install: () =>
          runPolaris(alias, "install", installCommand(dir, binary, sha256, replaceTask)).pipe(
            Effect.map((report) => ApplyResult.Installed({ version: plan.build.version, report }))
          ),
        Upgrade: (upgrade) =>
          runPolaris(alias, "upgrade", upgradeCommand(dir, binary, sha256, replaceTask)).pipe(
            Effect.map((report) =>
              ApplyResult.Upgraded({ from: upgrade.from, version: plan.build.version, report })
            )
          ),
      })
    );
  }).pipe(Effect.ensuring(cleanUp(alias, dir)));
});
