import {
  LanguageCheckout,
  LanguageError,
  LanguageTrustScope,
  LanguageTrust,
} from "@polaris/protocol";
import type { HostId } from "@polaris/protocol";
import { Schema } from "effect";
import { canonicalCheckout, type CheckoutRegistry, type CanonicalCheckout } from "./checkout.ts";

export { canonicalCheckout, checkoutPath, checkoutKey, within } from "./checkout.ts";

export type { CheckoutRegistry, CheckoutRegistration, CanonicalCheckout } from "./checkout.ts";

export { createFileTrustRepository } from "./repository.ts";

export { ExecutionTrustService } from "./service.ts";

export const TrustRecord = Schema.Struct({
  trust: LanguageTrust,
  canonicalRoot: Schema.String,
});

export type TrustRecord = typeof TrustRecord.Type;

/** Persistence must implement atomic compare-and-set and durably commit before returning. */
export interface TrustRepository {
  read(scope: typeof LanguageTrustScope.Type): Promise<TrustRecord | null>;
  compareAndSet(record: TrustRecord, expectedRevision: number): Promise<boolean>;
}

export const trustScope = (hostId: HostId, checkout: LanguageCheckout) =>
  LanguageCheckout.match<typeof LanguageTrustScope.Type>(checkout, {
    Workspace: ({ workspaceId }) =>
      LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
    Worktree: ({ workspaceId }) => LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
    ReviewCheckout: ({ workspaceId, reviewCheckoutId }) =>
      LanguageTrustScope.cases.ReviewCheckout.make({ hostId, workspaceId, reviewCheckoutId }),
  });

const grantRoot = (checkout: CanonicalCheckout) =>
  LanguageCheckout.match(checkout.checkout, {
    Workspace: () => checkout.workspaceRoot,
    Worktree: () => checkout.workspaceRoot,
    ReviewCheckout: () => checkout.root,
  });

/** Transport authorization is injected; a caller cannot grant trust just by knowing an ID. */
export function createExecutionTrust(options: {
  hostId: HostId;
  registry: CheckoutRegistry;
  repository: TrustRepository;
  authorizeGrant: (scope: typeof LanguageTrustScope.Type) => Promise<void>;
}) {
  async function inspect(input: LanguageCheckout) {
    const canonical = await canonicalCheckout(options.registry, input);
    const scope = trustScope(options.hostId, canonical.checkout);
    const stored = await options.repository.read(scope);
    const record = stored === null ? null : Schema.decodeUnknownSync(TrustRecord)(stored);

    if (record !== null && trustScopeKey(record.trust.scope) !== trustScopeKey(scope)) {
      throw new LanguageError({
        reason: "awaiting-trust",
        message: "Stored trust scope does not match checkout",
        retryable: false,
      });
    }

    const trust = LanguageTrust.make({
      scope,
      revision: record?.trust.revision ?? 0,
      trusted: record?.trust.trusted === true && record.canonicalRoot === grantRoot(canonical),
    });

    return { canonical, trust };
  }

  async function set(input: LanguageCheckout, trusted: boolean, expectedRevision: number) {
    const current = await inspect(input);
    await options.authorizeGrant(current.trust.scope);

    const record = TrustRecord.make({
      canonicalRoot: grantRoot(current.canonical),
      trust: LanguageTrust.make({
        scope: current.trust.scope,
        trusted,
        revision: expectedRevision + 1,
      }),
    });

    if (
      current.trust.revision !== expectedRevision ||
      !(await options.repository.compareAndSet(record, expectedRevision))
    ) {
      throw new LanguageError({
        reason: "conflict",
        message: "Trust revision changed",
        retryable: true,
      });
    }

    return record.trust;
  }

  async function require(input: LanguageCheckout) {
    const current = await inspect(input);

    if (!current.trust.trusted) {
      throw new LanguageError({
        reason: "awaiting-trust",
        message: "Checkout execution requires trust",
        retryable: false,
      });
    }

    return current.canonical;
  }

  /** Recheck at the invocation boundary, including formatter/config/plugin/build execution. */
  async function execute<A>(
    input: LanguageCheckout,
    invoke: (checkout: CanonicalCheckout) => Promise<A>
  ) {
    return invoke(await require(input));
  }

  return { inspect, set, require, execute };
}

export type ExecutionTrust = ReturnType<typeof createExecutionTrust>;

export const trustScopeKey = (scope: typeof LanguageTrustScope.Type) =>
  JSON.stringify(
    LanguageTrustScope.match(scope, {
      Workspace: ({ hostId, workspaceId }) => [hostId, workspaceId, "workspace"],
      ReviewCheckout: ({ hostId, workspaceId, reviewCheckoutId }) => [
        hostId,
        workspaceId,
        "review",
        reviewCheckoutId,
      ],
    })
  );
