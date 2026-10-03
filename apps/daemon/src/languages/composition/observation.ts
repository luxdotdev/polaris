import type { LanguageCheckout } from "@polaris/protocol";
import { realpathSync } from "node:fs";
import { Effect } from "effect";
import type { ObservationAdmission } from "../install/host.ts";
import { within, type ExecutionTrustService } from "../trust/index.ts";
import type { RequestAuthority } from "./authority.ts";
import { denied } from "./authority.ts";
import type { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";

/** One immutable demand identity; different request, project, configuration or trust cuts never share jobs. */
export const observationAdmission = (
  auth: RequestAuthority,
  checkout: LanguageCheckout,
  cwd: string,
  trustRevision: number,
  trust: ExecutionTrustService["Service"],
  owners: LanguageAcquisitionAuthority["Service"]
): ObservationAdmission => {
  const trustCurrent = owners.trustFence({
    hostId: auth.principal.hostId,
    workspaceId: checkout.workspaceId,
  });

  const requireCurrent = async (signal: AbortSignal) => {
    if (signal.aborted || auth.lost()) throw denied();
    trustCurrent();
    const canonical = await Effect.runPromise(auth.checkout(checkout), { signal });
    trustCurrent();
    const observed = await Effect.runPromise(trust.inspect(checkout), { signal });

    if (observed.trust.revision !== trustRevision) throw denied();
    await Effect.runPromise(trust.require(checkout), { signal });
    trustCurrent();
    const latest = await Effect.runPromise(auth.checkout(checkout), { signal });

    if (
      signal.aborted ||
      auth.lost() ||
      canonical.root !== latest.root ||
      canonical.workspaceRoot !== latest.workspaceRoot ||
      !within(latest.root, cwd) ||
      realpathSync(cwd) !== cwd
    )
      throw denied();
    trustCurrent();
  };

  return Object.freeze({ cwd, requireCurrent });
};
