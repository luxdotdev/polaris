import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import type { LanguageExecutable } from "@polaris/protocol";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { LaunchAdmissionRequest, LaunchSelectionLease } from "../runtime/launchAdmission.ts";
import type { createSelectionLedger } from "../install/selection-ledger.ts";
import { failure } from "../install/validation.ts";

/** Explicit configuration launches existing tools without claiming managed artifact approval. */
export const configuredExecutable = (
  facts: DiscoveryFacts
): typeof LanguageExecutable.Type | undefined =>
  facts.effectiveSettings.settings.executableOverrides?.[facts.providerId] ??
  facts.effectiveSettings.settings.customServers?.find((server) => server.id === facts.providerId)
    ?.launch;

export function configuredLaunchAdapters(ledger: ReturnType<typeof createSelectionLedger>) {
  const leases = new WeakMap<
    LaunchSelectionLease,
    { request: LaunchAdmissionRequest; configuration: typeof LanguageExecutable.Type }
  >();

  const configuration = (request: LaunchAdmissionRequest) => {
    const launch = configuredExecutable(request.facts);

    if (launch === undefined || request.facts.executable === null)
      throw failure(
        "missing-prerequisite",
        "Configure an existing Host executable for this provider"
      );

    if (request.signal.aborted || !request.isCurrent())
      throw failure("cancelled", "Configured provider generation is no longer current");

    return launch;
  };

  return {
    async reserveLaunch(request: LaunchAdmissionRequest): Promise<LaunchSelectionLease> {
      const launch = configuration(request);
      const executable = request.facts.executable;

      if (executable === null)
        throw failure("missing-prerequisite", "Configured executable is unavailable");
      const captured = await stat(executable);

      const identity =
        "sha256:" +
        createHash("sha256")
          .update(
            JSON.stringify([
              executable,
              captured.dev,
              captured.ino,
              captured.size,
              captured.mtimeMs,
              captured.ctimeMs,
              launch.argv,
              launch.environment,
              request.context.configurationFingerprint,
            ])
          )
          .digest("hex");

      const reservation = await ledger.reserveLaunch(
        `configured:${request.context.clientId}:${request.context.contextId}`,
        identity,
        request.signal
      );

      const lease: LaunchSelectionLease = {
        selectionIdentity: identity,
        assertCurrent: () => {
          configuration(request);
          reservation.assertCurrent();
        },
        validate: async (signal) => {
          if (signal.aborted)
            throw failure("cancelled", "Configured provider launch was cancelled");
          lease.assertCurrent();
          const current = await stat(executable);
          const canonical = await realpath(executable);
          await access(executable, constants.X_OK);
          lease.assertCurrent();

          if (
            !current.isFile() ||
            canonical !== executable ||
            current.dev !== captured.dev ||
            current.ino !== captured.ino ||
            current.size !== captured.size ||
            current.mtimeMs !== captured.mtimeMs ||
            current.ctimeMs !== captured.ctimeMs
          )
            throw failure("conflict", "Configured executable changed before launch", true);
          await reservation.validate(signal);
        },
        release: async () => {
          leases.delete(lease);
          await reservation.release();
        },
      };

      leases.set(lease, { request, configuration: launch });

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
    ) {
      const binding = leases.get(lease);

      if (binding?.request !== request || facts !== request.facts)
        throw failure("not-owner", "Configured launch does not own this request");
      await lease.validate(request.signal);
      const executable = facts.executable;

      if (executable === null)
        throw failure("missing-prerequisite", "Configured executable is unavailable");

      return {
        executable,
        args: binding.configuration.argv,
        cwd: facts.projectRoot,
        environment: binding.configuration.environment,
      };
    },
  };
}
