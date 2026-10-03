import type { LanguageConnectionIdentity, LanguageTrustScope } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";
import type { LaunchAdmissionRequest } from "../runtime/launchAdmission.ts";
import type { ExecutionTrustService } from "../trust/index.ts";
import { denied, type RequestAuthority } from "./authority.ts";

interface Owner {
  authority: RequestAuthority;
  sealed: boolean;
}

type AuthorizationRequest = Pick<LaunchAdmissionRequest, "context" | "signal" | "isCurrent">;

/** Captures actual request authority for broker work which outlives its RPC handler. */
function makeAuthority() {
  const owners = new Map<string, Owner>();
  const mutations = new Map<string, { revision: number; pending: number }>();

  const trustKey = (value: { hostId: string; workspaceId: string }) =>
    JSON.stringify([value.hostId, value.workspaceId]);

  const owns = (principal: LanguageConnectionIdentity) => {
    const owner = owners.get(principal.clientId);

    return owner !== undefined && !owner.sealed && owner.authority.principal === principal;
  };

  const current = (request: AuthorizationRequest, captured?: Owner) => {
    const owner = owners.get(request.context.clientId);

    if (
      owner === undefined ||
      (captured !== undefined && owner !== captured) ||
      owner.sealed ||
      owner.authority.lost() ||
      owner.authority.principal.hostId !== request.context.hostId ||
      request.signal.aborted ||
      !request.isCurrent()
    )
      throw denied();

    return owner;
  };

  return {
    owns,
    authority: (request: AuthorizationRequest) => current(request).authority,
    trustFence(scope: { hostId: string; workspaceId: string }) {
      const key = trustKey(scope);
      const revision = mutations.get(key)?.revision ?? 0;

      return () => {
        const mutation = mutations.get(key);

        if ((mutation?.pending ?? 0) > 0 || (mutation?.revision ?? 0) !== revision) throw denied();
      };
    },
    beginTrustChange(scope: typeof LanguageTrustScope.Type) {
      const key = trustKey(scope);
      let mutation = mutations.get(key);

      if (mutation === undefined) {
        if (mutations.size >= 1024) throw denied();
        mutation = { revision: 0, pending: 0 };
        mutations.set(key, mutation);
      }

      if (mutation.revision >= Number.MAX_SAFE_INTEGER) throw denied();
      mutation.revision++;
      mutation.pending++;
      let released = false;

      return () => {
        if (released) return;
        released = true;
        mutation.pending--;
      };
    },
    capture(authority: RequestAuthority) {
      const old = owners.get(authority.principal.clientId);

      if (
        authority.lost() ||
        (old !== undefined && (!owns(authority.principal) || old.authority.lost()))
      )
        throw denied();

      if (old === undefined) {
        if (owners.size >= 512) throw denied();
        owners.set(authority.principal.clientId, { authority, sealed: false });
      }
    },
    seal(principal: LanguageConnectionIdentity) {
      const owner = owners.get(principal.clientId);

      if (owner?.authority.principal === principal) owner.sealed = true;
    },
    settled(principal: LanguageConnectionIdentity) {
      const owner = owners.get(principal.clientId);

      if (owner?.authority.principal === principal && owner.sealed)
        owners.delete(principal.clientId);
    },
    guard(request: AuthorizationRequest, trust: ExecutionTrustService["Service"]) {
      const owner = current(request);

      const key = trustKey({
        hostId: request.context.hostId,
        workspaceId: request.context.checkout.workspaceId,
      });

      const revision = mutations.get(key)?.revision ?? 0;

      const assertCurrent = () => {
        current(request, owner);
        const mutation = mutations.get(key);

        if ((mutation?.pending ?? 0) > 0 || (mutation?.revision ?? 0) !== revision) throw denied();
      };

      const validate = async (signal: AbortSignal) => {
        if (signal.aborted) throw denied();
        assertCurrent();
        await Effect.runPromise(owner.authority.coordinates(request.context), { signal });
        await Effect.runPromise(owner.authority.checkout(request.context.checkout), { signal });
        assertCurrent();
        await Effect.runPromise(trust.require(request.context.checkout), { signal });
        assertCurrent();
        await Effect.runPromise(owner.authority.checkout(request.context.checkout), { signal });

        if (signal.aborted) throw denied();
        assertCurrent();
      };

      return { validate, assertCurrent };
    },
  };
}

export class LanguageAcquisitionAuthority extends Context.Service<
  LanguageAcquisitionAuthority,
  ReturnType<typeof makeAuthority>
>()("polaris/languages/LanguageAcquisitionAuthority") {
  static readonly layer = Layer.sync(LanguageAcquisitionAuthority, makeAuthority);
}
