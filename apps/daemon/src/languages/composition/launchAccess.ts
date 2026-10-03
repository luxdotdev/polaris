import type { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import type { LanguageProviderAccess } from "./ports.ts";
import type { ExecutionTrustService } from "../trust/index.ts";
import type { LaunchAdmissionRequest, LaunchSelectionLease } from "../runtime/launchAdmission.ts";
import { denied } from "./authority.ts";

/** Shares the installer's original lease while enforcing captured live acquisition ownership. */
export function guardedLaunchAccess(
  providers: LanguageProviderAccess["Service"],
  owners: LanguageAcquisitionAuthority["Service"],
  trust: ExecutionTrustService["Service"]
) {
  const bindings = new WeakMap<
    LaunchSelectionLease,
    {
      inner: LaunchSelectionLease;
      request: LaunchAdmissionRequest;
    }
  >();

  return {
    async reserveLaunch(request: LaunchAdmissionRequest): Promise<LaunchSelectionLease> {
      const guard = owners.guard(request, trust);
      await guard.validate(request.signal);
      const inner = await providers.reserveLaunch(request);

      const assertCurrent = () => {
        guard.assertCurrent();
        inner.assertCurrent();
      };

      const lease: LaunchSelectionLease = {
        selectionIdentity: inner.selectionIdentity,
        assertCurrent,
        async validate(signal) {
          await guard.validate(signal);
          assertCurrent();
          await inner.validate(signal);
          await guard.validate(signal);
          assertCurrent();
        },
        async release() {
          await inner.release();
          bindings.delete(lease);
        },
      };

      bindings.set(lease, { inner, request });

      try {
        await lease.validate(request.signal);

        return lease;
      } catch (cause) {
        await lease.release();
        throw cause;
      }
    },
    async resolveLaunch(
      facts: LaunchAdmissionRequest["facts"],
      lease: LaunchSelectionLease,
      request: LaunchAdmissionRequest
    ) {
      const binding = bindings.get(lease);

      if (binding === undefined || binding.request !== request || facts !== request.facts)
        throw denied();
      await lease.validate(request.signal);
      const launch = await providers.resolveLaunch(facts, binding.inner, request);
      await lease.validate(request.signal);
      lease.assertCurrent();

      return launch;
    },
  };
}
