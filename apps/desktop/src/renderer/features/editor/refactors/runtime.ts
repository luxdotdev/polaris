import { bindLanguageResourceReceipts } from "../lsp/bindings.ts";
import { verifyResourceReceiptChallenge } from "./resourceReceipt.ts";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { EditorRefactorAuthority } from "../lsp/refactorComposition.ts";
import { bindEditorRefactors } from "../lsp/refactorComposition.ts";
import { createAcknowledgedPreparation } from "../lsp/acknowledgedPreparation.ts";
import { editorPreparationTransport } from "../lsp/preparationTransport.ts";
import type { LanguageProvider } from "../lsp/types.ts";
import { RefactorController, bindRefactors, refactorFor } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import type { DraftDocument, DraftGroup, GroupStore } from "./group.ts";
import { draftReceipt } from "./group.ts";
import { equal } from "./equality.ts";
import { promoteTextProposal } from "./proposals.ts";

export interface RuntimeRefactorContext extends EditorRefactorAuthority {
  readonly provider: LanguageProvider;
  readonly capabilities: readonly P.Capability[];
}

export interface RuntimeRefactorPorts {
  readonly api: () => LanguageApi | undefined;
  readonly contexts: () => readonly RuntimeRefactorContext[];
  readonly groups: GroupStore;
  readonly opened: (hostKey: string, root: string) => readonly DraftDocument[];
  readonly inventory: (
    proposal: P.LanguageTreeEditProposal,
    hostKey: string
  ) => Promise<readonly DraftDocument[]>;
  readonly validateDisk: (proposal: P.LanguageTreeEditProposal, hostKey: string) => Promise<void>;
  readonly moving: (group: DraftGroup) => Promise<void>;
  readonly current: (group: DraftGroup, outcome?: P.LanguageTreeOperationOutcome) => Promise<void>;
  readonly publish: (group: DraftGroup, previous: DraftGroup) => void;
  readonly subscribe: (changed: () => void) => () => void;
}

type Binding = {
  readonly authority: RuntimeRefactorContext;
  readonly api: LanguageApi;
  readonly controller: RefactorController;
  readonly unbind: () => void;
  readonly show: () => void;
};

/** One existing R1 controller per independently authenticated context; all share the buffer group store. */
export const bindRuntimeRefactors = (ports: RuntimeRefactorPorts) => {
  const bindings = new Map<string, Binding>();

  const transports = new Map<
    string,
    { api: LanguageApi; transport: ReturnType<typeof editorPreparationTransport> }
  >();

  let disposed = false;
  const keyOf = (context: P.LanguageContextIdentity) => JSON.stringify(context);

  const authority = (context: P.LanguageContextIdentity) =>
    ports.contexts().find((value) => !value.signal.aborted && equal(value.context, context)) ??
    null;

  const transport = (hostKey: string) => {
    const api = ports.api();

    if (api === undefined || disposed) return null;
    let value = transports.get(hostKey);

    if (value?.api !== api) {
      value = { api, transport: editorPreparationTransport(api, hostKey) };
      transports.set(hostKey, value);
    }

    return value.transport;
  };

  const construct = (captured: RuntimeRefactorContext, api: LanguageApi): Binding => {
    const hostKey = captured.hostKey;
    const context = captured.context;

    const currentAuthority = () => {
      const latest = authority(context);

      if (
        disposed ||
        ports.api() !== api ||
        latest === null ||
        latest.token !== captured.token ||
        latest.signal !== captured.signal ||
        latest.identity.connectionEpoch !== captured.identity.connectionEpoch
      )
        throw new Error("The authenticated refactor context changed.");

      return latest;
    };

    const inventory = async (proposal: P.LanguageTreeEditProposal) => {
      currentAuthority();
      const documents = await ports.inventory(proposal, hostKey);
      currentAuthority();

      return documents;
    };

    const coordinator = new RefactorCoordinator(
      ports.groups,
      {
        authority: () => Promise.resolve(currentAuthority().context),
        inventory,
        validate: async (proposal, originals) => {
          const checkFence = () => {
            const latest = currentAuthority();

            if (!P.languageRpcAllowed("languages.tree.edit.decide", latest.capabilities))
              throw new Error(
                "Durable refactors require this Host's language edits, resources and tree-v2 capabilities."
              );
            const opened = ports.opened(hostKey, context.checkout.path);

            const currentDocuments = proposal.fence.documents.every((document) => {
              const matches = opened.filter((doc) => doc.uri === document.uri);

              return matches.length === 1 && matches[0]?.buffer?.version === document.version;
            });

            if (
              proposal.expiresAt <= Date.now() ||
              !equal(proposal.fence.context, context) ||
              !P.languageFenceSatisfied(proposal.fence, latest.provider.ack) ||
              !currentDocuments
            )
              throw new Error("The refactor proposal is stale. Request a new preview.");
          };

          checkFence();
          await ports.validateDisk(proposal, hostKey);

          if (!equal(originals, await inventory(proposal)))
            throw new Error("The refactor draft inventory changed.");
          checkFence();
        },
        moving: async (group) => {
          currentAuthority();
          await ports.moving(group);
          currentAuthority();
        },
        current: async (group, outcome) => {
          currentAuthority();
          await ports.current(group, outcome);
          currentAuthority();
        },
        publish: (group, previous) => {
          currentAuthority();
          ports.publish(group, previous);
        },
        connected: () => {
          try {
            currentAuthority();

            return true;
          } catch {
            return false;
          }
        },
        decide: async (input) => {
          const decision = Schema.decodeUnknownSync(P.LanguageTreeEditDecision)(input);
          const current = currentAuthority();

          if (decision.drafts !== null) {
            const group = await ports.groups.get(decision.drafts.groupId);

            if (group === null) throw new Error("The durable refactor group is missing.");
            await coordinator.verifyReceipt(
              current.context,
              group.proposal,
              decision.drafts,
              decision.acceptance.operationId
            );
          }

          currentAuthority();

          const response = await api.request("languages.tree.edit.decide", {
            hostKey,
            ...decision,
          });

          currentAuthority();

          if (!response.ok) throw new Error(response.error.message);

          return response.value;
        },
        get: async (group) => {
          await coordinator.groupStatus(currentAuthority().context, group.id, group.operationId);
          currentAuthority();

          const response = await api.request("languages.tree.operation.get", {
            hostKey,
            checkout: context.checkout,
            clientId: captured.identity.clientId,
            operationId: group.operationId,
          });

          currentAuthority();

          if (!response.ok) throw new Error(response.error.message);

          return response.value;
        },
        recover: async (group, intent) => {
          const metadata = await coordinator.groupStatus(
            currentAuthority().context,
            group.id,
            group.operationId
          );

          const saved = await ports.groups.get(group.id);

          if (
            saved === null ||
            !equal(saved, group) ||
            !equal(metadata.drafts, draftReceipt(saved)) ||
            metadata.hostReceiptRevision === null
          )
            throw new Error("The durable recovery receipt changed.");
          currentAuthority();

          const response = await api.request("languages.tree.operation.recover", {
            hostKey,
            checkout: context.checkout,
            clientId: captured.identity.clientId,
            operationId: group.operationId,
            intent,
            expectedReceiptRevision: metadata.hostReceiptRevision,
          });

          currentAuthority();

          if (!response.ok) throw new Error(response.error.message);

          return response.value;
        },
      },
      captured.provider.capabilities.positionEncoding
    );

    const controller = new RefactorController(hostKey, coordinator);
    let unbind = () => {};

    const show = () => {
      unbind();
      unbind = bindRefactors(controller, context.checkout.path);
    };

    if (refactorFor(hostKey, context.checkout.path) === null) show();
    void controller.restore().catch((cause) => controller.state.setState({ error: String(cause) }));

    return { authority: captured, api, controller, unbind: () => unbind(), show };
  };

  const refresh = () => {
    const contexts = ports.contexts();
    const api = ports.api();

    for (const [key, binding] of bindings) {
      const next = contexts.find((value) => keyOf(value.context) === key);

      if (
        api === binding.api &&
        next?.token === binding.authority.token &&
        next?.signal === binding.authority.signal &&
        !next.signal.aborted &&
        next.identity.connectionEpoch === binding.authority.identity.connectionEpoch
      )
        continue;
      binding.unbind();
      bindings.delete(key);
    }

    if (disposed || api === undefined) return;

    for (const value of contexts) {
      const key = keyOf(value.context);

      if (value.signal.aborted || bindings.has(key)) continue;

      bindings.set(key, construct(value, api));
    }
  };

  const unsubscribe = ports.subscribe(refresh);
  refresh();

  const unbind = bindEditorRefactors({
    authority: (context) => {
      refresh();

      return authority(context);
    },
    controller: (hostKey, root, context) => {
      const binding = bindings.get(keyOf(context));
      const displayed = refactorFor(hostKey, root);

      if (binding === undefined || binding.authority.hostKey !== hostKey) return null;

      if (displayed !== binding.controller && displayed !== null) {
        const state = displayed.state.getState();

        if (state.busy || state.preview !== null)
          throw new Error("Finish the current refactor preview first.");
      }

      if (displayed !== binding.controller) binding.show();

      return binding.controller;
    },
    prepare: createAcknowledgedPreparation({
      authority,
      transport,
      inventory: async (hostKey, root) => ports.opened(hostKey, root),
    }),
    promoteTextProposal,
  });

  const unreceipts = bindLanguageResourceReceipts(async (hostKey, context, challenge) => {
    const captured = authority(context);
    const binding = bindings.get(keyOf(context));

    if (captured === null || binding === undefined || captured.hostKey !== hostKey)
      throw new Error("The authenticated refactor receipt context is unavailable.");

    return verifyResourceReceiptChallenge(
      {
        groups: ports.groups,
        controller: (value) => bindings.get(keyOf(value))?.controller ?? null,
        current: (value) => {
          const latest = authority(value);

          if (
            disposed ||
            latest === null ||
            latest.token !== captured.token ||
            latest.signal !== captured.signal ||
            latest.identity.connectionEpoch !== captured.identity.connectionEpoch ||
            ports.api() !== binding.api
          )
            throw new Error("The authenticated refactor receipt context changed.");
        },
      },
      context,
      challenge
    );
  });

  return () => {
    disposed = true;
    unreceipts();
    unsubscribe();
    unbind();

    for (const value of bindings.values()) value.unbind();
    bindings.clear();
    transports.clear();
  };
};
