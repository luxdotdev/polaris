import {
  LanguageCatalog,
  LanguagePreflight,
  LanguageCheckout,
  LanguageContextIdentity,
  LanguageDiscovery,
  LanguageError,
  LanguageTrustScope,
  type HostId,
  type LanguageConnectionIdentity,
  type LanguageEffectiveSettings,
  type LanguageSyncInput,
  type LanguageFeatureRequest,
  type LanguageServerResponse,
  type LanguageRequestFence,
  type LanguageBufferAcknowledgment,
} from "@polaris/protocol";
import { Context, Effect, Layer, Schema, Stream } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { ProposalProvenance } from "../preparation/provenanceService.ts";
import { catalog } from "../catalog/index.ts";
import { ProjectDiscovery } from "../discovery/index.ts";
import { LanguageBroker, type AcquireInput } from "../runtime/index.ts";
import { ExecutionTrustService } from "../trust/index.ts";
import { registeredCheckout } from "../registeredCheckout.ts";
import { denied, requestAuthority, type RequestAuthority } from "./authority.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";
import { prepareFeatureEdit, type PreparationIntent } from "./preparation.ts";
import { configuredExecutable } from "./configuredLaunch.ts";
import { observationAdmission } from "./observation.ts";
import {
  LanguageProviderAccess,
  LanguageTrustGrantAuthority,
  LanguageConnectionLifetime,
} from "./ports.ts";

function makeCore(
  hostId: HostId,
  broker: LanguageBroker["Service"],
  discovery: ProjectDiscovery["Service"],
  trust: ExecutionTrustService["Service"],
  owners: LanguageAcquisitionAuthority["Service"],
  provenance: ProposalProvenance["Service"]
) {
  const disconnects = new WeakMap<LanguageConnectionIdentity, () => Effect.Effect<void>>();

  const disconnect = (principal: LanguageConnectionIdentity) => {
    let callback = disconnects.get(principal);

    if (callback === undefined) {
      callback = () =>
        Effect.gen(function* () {
          yield* provenance.revoke(principal);
          yield* broker.invalidateBufferAcknowledgments(principal);

          if (!owners.owns(principal)) return;
          owners.seal(principal);
          yield* broker.disconnectAndWait(principal.clientId).pipe(Effect.orDie);
          owners.settled(principal);
        });
      disconnects.set(principal, callback);
    }

    return callback;
  };

  const finish = <A, E, R>(
    auth: RequestAuthority,
    checkout: LanguageCheckout,
    operation: Effect.Effect<A, E, R>
  ) =>
    Effect.gen(function* () {
      yield* auth.checkout(checkout);
      const result = yield* operation;
      yield* auth.checkout(checkout);

      return result;
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => (auth.lost() ? disconnect(auth.principal)() : Effect.void))
      )
    );

  const context = (input: LanguageContextIdentity) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(hostId);
      yield* auth.coordinates(input);

      if (!owners.owns(auth.principal)) return yield* Effect.fail(denied());
      yield* auth.checkout(input.checkout);
      yield* broker.snapshot(auth.principal.clientId, input);
      yield* auth.check;

      return auth;
    });

  const scopeCheckout = (auth: RequestAuthority, scope: typeof LanguageTrustScope.Type) =>
    Effect.gen(function* () {
      if (scope.hostId !== auth.principal.hostId) return yield* Effect.fail(denied());
      yield* auth.check;
      const model = yield* (yield* EventStore).model;
      yield* auth.check;
      const workspace = model.workspaces.get(scope.workspaceId);

      if (workspace === undefined) return yield* Effect.fail(denied());

      return yield* Effect.try({
        try: () =>
          registeredCheckout(
            model,
            LanguageTrustScope.match<LanguageCheckout>(scope, {
              Workspace: () =>
                LanguageCheckout.cases.Workspace.make({
                  workspaceId: scope.workspaceId,
                  path: workspace.path,
                }),
              ReviewCheckout: (value) =>
                LanguageCheckout.cases.ReviewCheckout.make({
                  workspaceId: value.workspaceId,
                  reviewCheckoutId: value.reviewCheckoutId,
                  path: model.reviewCheckouts.get(value.reviewCheckoutId)?.path ?? workspace.path,
                }),
            })
          ).checkout,
        catch: () => denied(),
      });
    });

  const catalogRead = Effect.gen(function* () {
    const auth = yield* requestAuthority(hostId);
    const result = Schema.decodeUnknownSync(LanguageCatalog)(catalog);
    yield* auth.check;

    return result;
  });

  const discover = (input: {
    checkout: LanguageCheckout;
    path: string;
    documentLanguageId: string;
    settings: typeof LanguageEffectiveSettings.Type;
  }) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(hostId);
      const canonical = yield* auth.checkout(input.checkout);
      const observed = yield* trust.inspect(input.checkout);
      yield* auth.check;
      const providers = yield* LanguageProviderAccess;

      const ids =
        input.settings.settings.providers ??
        catalog.integrations
          .filter((item) => item.languageIds.includes(input.documentLanguageId))
          .flatMap((item) => item.providers.map((provider) => provider.id));

      const facts = [];
      let projectRoot = canonical.root;

      for (const providerId of [...new Set(ids)].slice(0, 32)) {
        const provider = catalog.integrations
          .flatMap((item) => item.providers)
          .find((item) => item.id === providerId);

        if (provider === undefined)
          return yield* Effect.fail(
            new LanguageError({
              reason: "method-not-found",
              message: "Provider is not in the accepted catalog",
              retryable: false,
            })
          );

        const found = yield* finish(
          auth,
          input.checkout,
          discovery.discover({ ...input, providerId })
        );

        projectRoot = found.projectRoot;

        const state =
          configuredExecutable(found) !== undefined
            ? {
                preflight: observed.trust.trusted
                  ? LanguagePreflight.cases.Eligible.make({ artifactId: null })
                  : LanguagePreflight.cases.Blocked.make({
                      reason: "awaiting-trust",
                      message: "Trust this Workspace before using its configured executable",
                    }),
                prerequisites: [],
              }
            : yield* providers.availability(
                provider.tool,
                "feature",
                observed.trust.trusted,
                observationAdmission(
                  auth,
                  canonical.checkout,
                  found.projectRoot,
                  observed.trust.revision,
                  trust,
                  owners
                )
              );

        yield* auth.checkout(input.checkout);
        facts.push({
          providerId,
          preflight: state.preflight,
          prerequisites: state.prerequisites,
          launch: null,
        });
      }

      yield* auth.checkout(input.checkout);

      return LanguageDiscovery.make({
        checkout: canonical.checkout,
        projectRoot,
        effectiveSettings: input.settings,
        trust: observed.trust,
        providers: facts,
      });
    });

  const available = (input: {
    toolIds: readonly string[];
    checkout: LanguageCheckout | null;
    phase: "install" | "feature";
    refresh: boolean;
  }) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(hostId);
      const providers = yield* LanguageProviderAccess;
      let trusted = false;
      let admission: import("../install/host.ts").ObservationAdmission | undefined;

      if (input.checkout !== null) {
        const canonical = yield* auth.checkout(input.checkout);
        const observed = yield* trust.inspect(input.checkout);
        trusted = observed.trust.trusted;
        admission = observationAdmission(
          auth,
          canonical.checkout,
          canonical.root,
          observed.trust.revision,
          trust,
          owners
        );
        yield* auth.check;
      }

      const facts = [];

      for (const toolId of input.toolIds) {
        yield* auth.check;
        facts.push(yield* providers.availability(toolId, input.phase, trusted, admission));

        if (input.checkout !== null) yield* auth.checkout(input.checkout);
        yield* auth.check;
      }

      return facts;
    });

  const acquire = (input: AcquireInput) =>
    Effect.gen(function* () {
      const auth = yield* requestAuthority(hostId);

      if (input.clientId !== auth.principal.clientId) return yield* Effect.fail(denied());

      if (
        !catalog.integrations.some((item) =>
          item.providers.some((provider) => provider.id === input.providerId)
        ) &&
        !input.settings.settings.customServers?.some((server) => server.id === input.providerId)
      )
        return yield* Effect.fail(
          new LanguageError({
            reason: "method-not-found",
            message: "Provider is not catalogued or explicitly configured",
            retryable: false,
          })
        );
      const lifetime = yield* LanguageConnectionLifetime;
      yield* lifetime.attach(auth.principal, disconnect(auth.principal));
      yield* Effect.try({ try: () => owners.capture(auth), catch: () => denied() });
      yield* auth.check;

      return yield* finish(auth, input.checkout, broker.acquire(auth.principal.clientId, input));
    });

  const delegate = <A, E, R>(
    input: LanguageContextIdentity,
    operation: (clientId: string) => Effect.Effect<A, E, R>
  ) =>
    Effect.gen(function* () {
      const auth = yield* context(input);

      return yield* finish(auth, input.checkout, operation(auth.principal.clientId));
    });

  return {
    catalog: catalogRead,
    availability: available,
    discover,
    acquire,
    trustGet: (scope: typeof LanguageTrustScope.Type) =>
      Effect.gen(function* () {
        const auth = yield* requestAuthority(hostId);
        const checkout = yield* scopeCheckout(auth, scope);

        return (yield* finish(auth, checkout, trust.inspect(checkout))).trust;
      }),
    trustSet: (scope: typeof LanguageTrustScope.Type, trusted: boolean, expectedRevision: number) =>
      Effect.gen(function* () {
        const auth = yield* requestAuthority(hostId);
        const checkout = yield* scopeCheckout(auth, scope);
        const grant = yield* LanguageTrustGrantAuthority;
        yield* grant.authorize(auth.principal, scope);
        yield* auth.checkout(checkout);

        const mutation = Effect.acquireUseRelease(
          Effect.sync(() => owners.beginTrustChange(scope)),
          () =>
            Effect.gen(function* () {
              yield* broker.invalidateTrust(checkout);
              const result = yield* trust.set(checkout, trusted, expectedRevision);
              yield* broker.invalidateTrust(checkout);

              return result;
            }).pipe(Effect.uninterruptible),
          (release) => Effect.sync(release)
        );

        return yield* finish(auth, checkout, mutation);
      }),
    release: (input: LanguageContextIdentity, interestId: string) =>
      delegate(input, (clientId) => broker.release(clientId, input, interestId)),
    restart: (input: LanguageContextIdentity) =>
      delegate(input, (clientId) => broker.restart(clientId, input)),
    configure: (input: LanguageContextIdentity, settings: typeof LanguageEffectiveSettings.Type) =>
      delegate(input, (clientId) => broker.configure(clientId, input, settings)),
    sync: (input: LanguageSyncInput) =>
      delegate(input.context, (clientId) => broker.sync(clientId, input)),
    acknowledge: (input: { fence: LanguageRequestFence; buffer: LanguageBufferAcknowledgment }) =>
      Effect.gen(function* () {
        const auth = yield* context(input.fence.context);

        return yield* finish(
          auth,
          input.fence.context.checkout,
          broker.acknowledgeBuffer(
            auth.principal,
            () => !auth.lost() && owners.owns(auth.principal),
            input.fence,
            input.buffer
          )
        );
      }),
    request: (input: LanguageFeatureRequest) =>
      delegate(input.fence.context, (clientId) => broker.request(clientId, input)),
    prepare: (input: PreparationIntent) =>
      Effect.gen(function* () {
        const auth = yield* context(input.request.fence.context);

        return yield* finish(
          auth,
          input.request.fence.context.checkout,
          prepareFeatureEdit(broker, auth, owners, trust, provenance, input)
        );
      }),
    cancel: (input: LanguageContextIdentity, requestId: string) =>
      delegate(input, (clientId) => broker.cancel(clientId, input, requestId)),
    cancelProgress: (input: LanguageContextIdentity, token: string | number) =>
      delegate(input, (clientId) => broker.cancelProgress(clientId, input, token)),
    respond: (input: typeof LanguageServerResponse.Type) =>
      delegate(input.context, (clientId) => broker.respond(clientId, input)),
    watch: (input: LanguageContextIdentity) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const auth = yield* context(input);

          return broker.watch(auth.principal.clientId, input).pipe(
            Stream.mapEffect((event) => Effect.as(auth.checkout(input.checkout), event)),
            Stream.ensuring(
              Effect.suspend(() => (auth.lost() ? disconnect(auth.principal)() : Effect.void))
            )
          );
        })
      ),
  };
}

export class LanguageCore extends Context.Service<LanguageCore, ReturnType<typeof makeCore>>()(
  "polaris/languages/LanguageCore"
) {
  static layer(hostId: HostId) {
    return Layer.effect(
      LanguageCore,
      Effect.gen(function* () {
        return LanguageCore.of(
          makeCore(
            hostId,
            yield* LanguageBroker,
            yield* ProjectDiscovery,
            yield* ExecutionTrustService,
            yield* LanguageAcquisitionAuthority,
            yield* ProposalProvenance
          )
        );
      })
    );
  }
}
