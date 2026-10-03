import type { Tool } from "../catalog/model.ts";
import type { ObservationAdmission } from "../install/host.ts";
import { checkAbort, failure } from "../install/validation.ts";
import {
  runtimeProbeAdapter,
  type VersionProbe,
  type VersionCommand,
  type VersionOutput,
} from "./probes.ts";
import { runHostVersion } from "./version-process.ts";

/** Core supplies captured authority and canonical cwd on each demand; construction grants no execution authority. */
export function runtimeObservationAdapter(options: {
  configured: Readonly<Record<string, string>>;
  searchPath: ReadonlyArray<string>;
  versions: Readonly<Record<string, VersionProbe>>;
  connected: () => boolean;
  run?: (command: VersionCommand, signal: AbortSignal) => Promise<VersionOutput>;
}) {
  const probe = runtimeProbeAdapter({ ...options, run: options.run ?? runHostVersion });

  return {
    observe: async (
      tool: Tool,
      phase: "install" | "feature",
      trusted: boolean,
      signal: AbortSignal,
      admission?: ObservationAdmission
    ) => {
      checkAbort(signal);

      if (tool.requirements.length && !admission)
        throw failure(
          "not-ready",
          "Prerequisite observation is unavailable without current request authority",
          true
        );

      if (tool.requirements.length && !trusted)
        throw failure(
          "awaiting-trust",
          "Prerequisite observation requires current Workspace trust",
          true
        );
      await admission?.requireCurrent(signal);
      checkAbort(signal);

      const requirements = tool.requirements.filter(
        (value) => phase === "feature" || value.scope === "server"
      );

      const probes = await probe(requirements, trusted, signal, admission);
      await admission?.requireCurrent(signal);
      checkAbort(signal);

      return { connected: options.connected(), probes };
    },
    dispose: () => probe.dispose(),
  };
}
