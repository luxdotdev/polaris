import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { catalog } from "../catalog/index.ts";
import type { Requirement } from "../catalog/model.ts";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { createHostPrerequisiteProbe } from "../install/hostStateProbes.ts";
import type { createSelectionLedger } from "../install/selection-ledger.ts";
import { failure } from "../install/validation.ts";
import type { Launch } from "../runtime/process.ts";
import type { LaunchAdmissionRequest, LaunchSelectionLease } from "../runtime/launchAdmission.ts";

/** Providers whose server is a Host Prerequisite: found on the Host, never downloaded. */
export const developerProvider = (providerId: string) =>
  catalog.tools.find((tool) => tool.id === providerId)?.distribution === "developer";

const requirements = (providerId: string): readonly Requirement[] =>
  catalog.tools.find((tool) => tool.id === providerId)?.requirements ?? [];

const sameFile = (a: Stats, b: Stats) =>
  a.isFile() &&
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs;

interface Located {
  readonly server: string;
  readonly toolchain: readonly string[];
  /** In order: the server, then its toolchain. */
  readonly stats: readonly Stats[];
}

/** gopls runs Workspace code through `go list`, so the broker requires Trust before this launches. */
export function developerLaunchAdapters(
  ledger: ReturnType<typeof createSelectionLedger>,
  probes: ReturnType<typeof createHostPrerequisiteProbe>
) {
  const leases = new WeakMap<
    LaunchSelectionLease,
    { request: LaunchAdmissionRequest; located: Located }
  >();

  const locate = async (providerId: string, signal: AbortSignal): Promise<Located> => {
    const probe = probes();
    const paths: string[] = [];

    for (const requirement of requirements(providerId).filter((item) => item.required)) {
      const presence = await probe.probe(requirement, signal);

      if (presence.path === null) throw failure("missing-prerequisite", requirement.detail, true);
      paths.push(presence.path);
    }

    const server = paths.find((path) => path.endsWith(`/${providerId}`));

    if (server === undefined)
      throw failure("missing-prerequisite", `${providerId} is not on this Host`, true);

    const toolchain = paths.filter((path) => path !== server);

    return {
      server,
      toolchain,
      stats: await Promise.all([server, ...toolchain].map((path) => stat(path))),
    };
  };

  const unchanged = async (located: Located) => {
    const paths = [located.server, ...located.toolchain];

    for (const [index, path] of paths.entries()) {
      const current = await stat(path);
      await access(path, constants.X_OK);

      if ((await realpath(path)) !== path || !sameFile(current, located.stats[index]!))
        throw failure("conflict", "A Host prerequisite changed before launch", true);
    }
  };

  return {
    async reserveLaunch(request: LaunchAdmissionRequest): Promise<LaunchSelectionLease> {
      if (request.signal.aborted || !request.isCurrent())
        throw failure("cancelled", "Developer provider generation is no longer current");
      const located = await locate(request.facts.providerId, request.signal);

      const identity =
        "sha256:" +
        createHash("sha256")
          .update(
            JSON.stringify([
              located.server,
              located.toolchain,
              located.stats.map((item) => [item.dev, item.ino, item.size, item.mtimeMs]),
              request.context.configurationFingerprint,
            ])
          )
          .digest("hex");

      const reservation = await ledger.reserveLaunch(
        `developer:${request.context.clientId}:${request.context.contextId}`,
        identity,
        request.signal
      );

      const lease: LaunchSelectionLease = {
        selectionIdentity: identity,
        assertCurrent: () => {
          if (!request.isCurrent())
            throw failure("cancelled", "Developer provider generation is no longer current");
          reservation.assertCurrent();
        },
        validate: async (signal) => {
          if (signal.aborted) throw failure("cancelled", "Developer provider launch was cancelled");
          lease.assertCurrent();
          await unchanged(located);
          lease.assertCurrent();
          await reservation.validate(signal);
        },
        release: async () => {
          leases.delete(lease);
          await reservation.release();
        },
      };

      leases.set(lease, { request, located });

      try {
        await lease.validate(request.signal);

        return lease;
      } catch (cause) {
        await lease.release();
        throw cause;
      }
    },
    async resolveLaunch(
      facts: DiscoveryFacts,
      lease: LaunchSelectionLease,
      request: LaunchAdmissionRequest
    ): Promise<Launch> {
      const binding = leases.get(lease);

      if (binding?.request !== request || facts !== request.facts)
        throw failure("not-owner", "Developer launch does not own this request");
      await lease.validate(request.signal);
      const toolchain = binding.located.toolchain.map((path) => dirname(path));

      return {
        executable: binding.located.server,
        args: [],
        cwd: facts.projectRoot,
        environment: {
          PATH: [...new Set([...toolchain, ...(process.env.PATH ?? "").split(":")])]
            .filter((entry) => entry.length > 0)
            .join(":"),
        },
      };
    },
  };
}
