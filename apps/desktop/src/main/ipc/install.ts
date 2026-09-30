/**
 * `install.ensure`: probe a remote Host over SSH and install or upgrade its
 * Daemon from the bundled builds. Installs only with the user's approval of
 * the build's SHA-256; the approval UI comes later (M1 Settings).
 */
import { ensureDaemon, type EnsureResult, loadBuilds, Ssh } from "@polaris/client/install";
import { Effect, Match } from "effect";
import type { InstallView, IpcError } from "../../shared/api.ts";
import { toIpcError } from "../hosts.ts";

export interface EnsureInstalledInput {
  readonly alias: string;
  readonly approvedSha256: string | null;
  /** The directory holding the builds' `manifest.json`; null when this build bundles none. */
  readonly dist: string | null;
}

const view = (
  result: InstallView["result"],
  fields: Partial<Omit<InstallView, "result">> = {}
): InstallView => ({
  result,
  platform: fields.platform ?? null,
  version: fields.version ?? null,
  sha256: fields.sha256 ?? null,
  command: fields.command ?? null,
});

export const installView = (result: EnsureResult): InstallView =>
  Match.value(result).pipe(
    Match.tagsExhaustive({
      Ready: () => view("Ready"),
      ApprovalNeeded: ({ plan }) =>
        view("ApprovalNeeded", {
          platform: plan.platform,
          version: plan.version,
          sha256: plan.sha256,
        }),
      Unavailable: () => view("Unavailable"),
      HostSetupNeeded: ({ plan }) =>
        view("HostSetupNeeded", { platform: plan.platform, command: plan.command }),
    })
  );

export const ensureInstalled = ({
  alias,
  approvedSha256,
  dist,
}: EnsureInstalledInput): Effect.Effect<InstallView, IpcError> => {
  if (dist === null) {
    return Effect.fail({ code: "NoBuilds", message: "this build bundles no Daemon builds" });
  }

  return Effect.try({
    try: () => loadBuilds(dist),
    catch: (cause): IpcError => ({ code: "NoBuilds", message: String(cause) }),
  }).pipe(
    Effect.flatMap((builds) =>
      ensureDaemon(alias, builds, {
        trigger: "user",
        approvedSha256: new Set(approvedSha256 === null ? [] : [approvedSha256]),
      }).pipe(Effect.mapError(toIpcError), Effect.provide(Ssh.layer))
    ),
    Effect.map(installView)
  );
};
