import {
  LanguageCheckout,
  LanguageError,
  LanguageTrustScope,
  LanguageTrust,
} from "@polaris/protocol";
import type { HostId } from "@polaris/protocol";
import { Match, Schema } from "effect";
import { canonicalCheckout, type CheckoutRegistry, type CanonicalCheckout } from "./checkout.ts";

export {
  canonicalCheckout,
  checkoutDocumentPath,
  checkoutPath,
  checkoutKey,
  within,
} from "./checkout.ts";

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
      decision:
        record === null || record.canonicalRoot !== grantRoot(canonical)
          ? "undecided"
          : (record.trust.decision ?? (record.trust.trusted ? "trusted" : "declined")),
      typescriptProvider: record?.trust.typescriptProvider ?? "project",
    });

    return { canonical, trust };
  }

  async function change(
    input: LanguageCheckout,
    action: typeof import("@polaris/protocol").LanguageTrustAction.Type,
    expectedRevision: number
  ) {
    const current = await inspect(input);
    await options.authorizeGrant(current.trust.scope);

    const decision = Match.value(action).pipe(
      Match.when("trust", () => "trusted" as const),
      Match.when(
        (value) => value === "decline" || value === "revoke",
        () => "declined" as const
      ),
      Match.when("ask-again", () => "undecided" as const),
      Match.orElse(() => current.trust.decision ?? "undecided")
    );

    const typescriptProvider = Match.value(action).pipe(
      Match.when("use-bundled", () => "bundled" as const),
      Match.when("use-project", () => "project" as const),
      Match.orElse(() => current.trust.typescriptProvider ?? "project")
    );

    const record = TrustRecord.make({
      canonicalRoot: grantRoot(current.canonical),
      trust: LanguageTrust.make({
        scope: current.trust.scope,
        trusted: decision === "trusted",
        decision,
        typescriptProvider,
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

  const set = (input: LanguageCheckout, trusted: boolean, expectedRevision: number) =>
    change(input, trusted ? "trust" : "decline", expectedRevision);

  const asked = new Map<string, number>();

  function claimAsk(trust: typeof LanguageTrust.Type) {
    if (trust.decision !== "undecided") return false;
    const key = trustScopeKey(trust.scope);

    if (asked.get(key) === trust.revision) return false;

    if (asked.size >= 1024) asked.delete(asked.keys().next().value!);
    asked.set(key, trust.revision);

    return true;
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

  return { inspect, set, change, claimAsk, require, execute };
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
