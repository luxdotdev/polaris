import {
  LanguageTreeEditProposal,
  LanguageTreeEditDecision,
  LanguageTreeOperationOutcome,
  type LanguagePositionEncoding,
  type LanguageTreeDraftReceipt,
  type LanguageContextIdentity,
} from "@polaris/protocol";
import { Schema } from "effect";
import { affected, project, validateInventory } from "./plan.ts";
import {
  draftReceipt,
  previewFingerprint,
  type DraftDocument,
  type DraftGroup,
  type GroupStore,
} from "./group.ts";

/** G2 supplies authenticated fences, full dirty inventory, and dedicated format-2 transport. */
export interface RefactorPort {
  readonly authority: () => Promise<LanguageContextIdentity>;
  readonly inventory: (proposal: LanguageTreeEditProposal) => Promise<readonly DraftDocument[]>;
  readonly validate: (
    proposal: LanguageTreeEditProposal,
    originals: readonly DraftDocument[]
  ) => Promise<void>;
  readonly current: (group: DraftGroup, outcome?: LanguageTreeOperationOutcome) => Promise<void>;
  /** Must update runtime views synchronously after the durable projection transaction. */
  readonly publish: (group: DraftGroup, previous: DraftGroup) => void;
  readonly decide: (
    decision: typeof LanguageTreeEditDecision.Type
  ) => Promise<LanguageTreeOperationOutcome>;
  readonly get: (group: DraftGroup) => Promise<LanguageTreeOperationOutcome | null>;
  readonly recover: (
    group: DraftGroup,
    intent: "recover" | "undo" | "cancel"
  ) => Promise<LanguageTreeOperationOutcome>;
  readonly connected: () => boolean;
  readonly moving?: (group: DraftGroup) => Promise<void>;
}

export interface Preview {
  readonly proposal: LanguageTreeEditProposal;
  readonly originals: readonly DraftDocument[];
  readonly documents: readonly DraftDocument[];
  readonly touched: readonly string[];
  readonly fingerprint: string;
}

import { receiptVersion } from "./ownership.ts";
import { equal as same, sameRefactorOwner } from "./equality.ts";

export class RefactorCoordinator {
  private busy = false;
  private verifiedReceipt: DraftGroup | null = null;
  constructor(
    readonly store: GroupStore,
    readonly port: RefactorPort,
    readonly encoding: typeof LanguagePositionEncoding.Type
  ) {}

  async preview(input: LanguageTreeEditProposal): Promise<Preview> {
    const proposal = Schema.decodeUnknownSync(LanguageTreeEditProposal)(input);
    await this.authenticate(proposal);
    const originals = await this.port.inventory(proposal);
    validateInventory(proposal, originals);
    await this.port.validate(proposal, originals);
    const projection = project(proposal, originals, this.encoding);

    return { proposal, originals, ...projection, fingerprint: await previewFingerprint(proposal) };
  }

  private async exclusive<A>(run: () => Promise<A>): Promise<A> {
    if (this.busy) throw new Error("Another refactor operation is in progress.");
    this.busy = true;

    try {
      return await run();
    } finally {
      this.busy = false;
    }
  }

  private async authenticate(proposal: LanguageTreeEditProposal) {
    const context = await this.port.authority();

    if (!same(context, proposal.fence.context))
      throw new Error("Refactor belongs to another authenticated context.");
  }

  private connected() {
    if (!this.port.connected())
      throw new Error("Connect to the Host before accepting or recovering this refactor.");
  }

  async reject(preview: Preview, operationId: string) {
    this.connected();

    return this.port.decide(
      Schema.decodeUnknownSync(LanguageTreeEditDecision)({
        acceptance: {
          format: 2,
          proposalId: preview.proposal.proposalId,
          operationId,
          fence: preview.proposal.fence,
          snapshots: preview.proposal.snapshots,
          resourceSnapshots: preview.proposal.resourceSnapshots,
          decision: "reject",
        },
        drafts: null,
      })
    );
  }

  accept(preview: Preview, id: string, operationId: string, hostKey: string): Promise<DraftGroup> {
    return this.exclusive(async () => {
      this.connected();

      if (preview.proposal.expiresAt <= Date.now())
        throw new Error("This refactor preview expired.");

      if (preview.fingerprint !== (await previewFingerprint(preview.proposal)))
        throw new Error("Preview changed.");
      await this.authenticate(preview.proposal);
      await this.port.validate(preview.proposal, preview.originals);
      await this.currentInventory(preview);

      const group: DraftGroup = {
        format: 2,
        positionEncoding: this.encoding,
        id,
        operationId,
        hostKey,
        revision: 0,
        updatedAt: Date.now(),
        fingerprint: preview.fingerprint,
        proposal: preview.proposal,
        originals: preview.originals,
        documents: preview.originals,
        touched: preview.touched,
        state: "prepared",
        outcome: null,
        message: "Drafts preserved; awaiting Host outcome.",
      };

      await this.store.commit(group, null);
      // Recheck after durable storage latency; G2 repeats authentication after Host lock waits.
      await this.authenticate(preview.proposal);
      await this.port.validate(preview.proposal, preview.originals);
      await this.currentInventory(preview);
      const durable = await this.store.get(id);

      if (durable === null || !same(durable, group))
        throw new Error("Cannot verify persisted refactor drafts.");
      const drafts = draftReceipt(durable);

      const decision = Schema.decodeUnknownSync(LanguageTreeEditDecision)({
        acceptance: {
          format: 2,
          proposalId: preview.proposal.proposalId,
          operationId,
          fence: preview.proposal.fence,
          snapshots: preview.proposal.snapshots,
          resourceSnapshots: preview.proposal.resourceSnapshots,
          decision: "accept",
        },
        drafts,
      });

      try {
        return await this.reconcile(group, await this.port.decide(decision));
      } catch (cause) {
        const saved = await this.store.get(id);

        if (saved !== null && saved.revision !== group.revision) throw cause;

        const unknown: DraftGroup = {
          ...group,
          revision: 1,
          state: "unknown",
          message: "Host outcome is unknown. Check recovery before trying again.",
        };

        await this.store.commit(unknown, 0);
        this.port.publish(unknown, group);

        return unknown;
      }
    });
  }

  status(id: string): Promise<DraftGroup> {
    return this.exclusive(async () => {
      this.connected();
      const group = await this.need(id);
      const outcome = await this.port.get(group);

      if (outcome === null)
        throw new Error(
          "No durable Host receipt yet. Drafts retained; acceptance was not replayed."
        );

      return this.reconcile(group, outcome);
    });
  }

  recover(id: string, intent: "recover" | "undo" | "cancel"): Promise<DraftGroup> {
    return this.exclusive(async () => {
      this.connected();
      const group = await this.need(id);

      if (group.outcome === null) throw new Error("Check the Host outcome before recovery.");
      await this.port.current(group);
      const outcome = await this.port.recover(group, intent);

      return this.reconcile(group, outcome);
    });
  }

  async verifyReceipt(
    context: LanguageContextIdentity,
    proposal: LanguageTreeEditProposal,
    receipt: LanguageTreeDraftReceipt,
    operationId: string
  ): Promise<void> {
    const group = await this.need(receipt.groupId);
    await this.authenticate(proposal);

    if (
      group.state !== "prepared" ||
      !same(context, proposal.fence.context) ||
      !same(group.proposal, proposal) ||
      group.operationId !== operationId ||
      group.fingerprint !== (await previewFingerprint(proposal)) ||
      !same(draftReceipt(group), receipt)
    )
      throw new Error("Refactor receipt does not own this preview/context.");
    const inventory = await this.port.inventory(proposal);
    const dirty = inventory.filter((doc) => doc.dirty && affected(proposal, doc.canonicalPath));

    if (
      !same(
        dirty,
        group.originals.filter((doc) => doc.dirty)
      )
    )
      throw new Error("Persisted refactor receipt has stale or incomplete dirty descendants.");
    await this.port.validate(proposal, group.originals);
    await this.authenticate(proposal);

    if (!same(await this.need(receipt.groupId), group))
      throw new Error("Persisted refactor receipt changed while verifying ownership.");
    this.verifiedReceipt = group;
  }

  /** Continuation pins a previously fully verified prepared group while the Host owns disk movement. */
  async verifyMovingReceipt(
    context: LanguageContextIdentity,
    proposal: LanguageTreeEditProposal,
    receipt: LanguageTreeDraftReceipt,
    operationId: string
  ): Promise<void> {
    await this.authenticate(proposal);
    const group = await this.need(receipt.groupId);

    if (
      !same(context, proposal.fence.context) ||
      group.state !== "prepared" ||
      group.operationId !== operationId ||
      !same(group.proposal, proposal) ||
      group.fingerprint !== (await previewFingerprint(proposal)) ||
      !same(draftReceipt(group), receipt) ||
      this.verifiedReceipt === null ||
      !same(this.verifiedReceipt, group) ||
      this.port.moving === undefined
    )
      throw new Error("Moving receipt does not own the previously verified prepared draft group.");

    await this.port.moving(group);
    await this.authenticate(proposal);

    if (!same(await this.need(receipt.groupId), group) || !same(this.verifiedReceipt, group))
      throw new Error("The moving draft group changed while verifying ownership.");
    await this.port.moving(group);
    await this.authenticate(proposal);
  }

  /** Private authenticated metadata only; status never authorizes a new filesystem mutation. */
  async groupStatus(context: LanguageContextIdentity, id: string, operationId: string) {
    if (!same(context, await this.port.authority()))
      throw new Error("Refactor status belongs to another authenticated context.");
    const group = await this.need(id);

    if (
      group.operationId !== operationId ||
      !sameRefactorOwner(group.proposal.fence.context, context) ||
      group.fingerprint !== (await previewFingerprint(group.proposal))
    )
      throw new Error("Refactor status does not own this operation/preview.");
    await this.authenticateRecovery(group.proposal);

    if (!same(context, await this.port.authority()))
      throw new Error("Refactor status authority changed during verification.");

    return {
      groupId: group.id,
      operationId: group.operationId,
      proposalId: group.proposal.proposalId,
      previewFingerprint: group.fingerprint,
      state: group.state,
      localRevision: group.revision,
      hostReceiptRevision: group.outcome?.receiptRevision ?? null,
      drafts: draftReceipt(group),
    };
  }

  private async currentInventory(preview: Preview) {
    const inventory = await this.port.inventory(preview.proposal);

    if (!same(inventory, preview.originals))
      throw new Error("Drafts changed. Request a new preview.");
    validateInventory(preview.proposal, inventory);
  }

  private async need(id: string) {
    const group = await this.store.get(id);

    if (group === null) throw new Error("Durable refactor draft group is missing.");

    await this.authenticateRecovery(group.proposal);

    return group;
  }

  private async authenticateRecovery(proposal: LanguageTreeEditProposal) {
    if (!sameRefactorOwner(await this.port.authority(), proposal.fence.context))
      throw new Error(
        "Refactor recovery belongs to another authenticated Host, Client or checkout."
      );
  }

  private async reconcile(
    group: DraftGroup,
    input: LanguageTreeOperationOutcome
  ): Promise<DraftGroup> {
    const outcome = Schema.decodeUnknownSync(LanguageTreeOperationOutcome)(input);

    if (
      outcome.operationId !== group.operationId ||
      outcome.proposalId !== group.proposal.proposalId ||
      outcome.owner.hostId !== group.proposal.fence.context.hostId ||
      outcome.owner.clientId !== group.proposal.fence.context.clientId ||
      !same(outcome.owner.checkout, group.proposal.fence.context.checkout) ||
      outcome.draftGroupId !== group.id ||
      !outcome.receiptDurable ||
      (group.outcome !== null && outcome.receiptRevision < group.outcome.receiptRevision)
    )
      throw new Error("Host receipt does not own this draft group or is stale.");

    if (group.outcome !== null && outcome.receiptRevision === group.outcome.receiptRevision) {
      if (!same(group.outcome, outcome))
        throw new Error("Host receipt changed without a revision.");

      return group;
    }

    validateOutcomeSteps(group, outcome);
    await this.port.current(group, outcome);

    const restored =
      outcome.state === "restored" || outcome.state === "rejected" || outcome.state === "failed";

    const applied = outcome.state === "applied";
    const partial = outcome.state === "partial";

    const currentContext = await this.port.authority();

    if (
      (applied || partial) &&
      group.positionEncoding === undefined &&
      !same(currentContext, group.proposal.fence.context)
    )
      throw new Error(
        "The historical refactor position encoding is unavailable; drafts are retained."
      );

    const projection = restored
      ? { documents: group.originals, touched: group.touched }
      : applied || partial
        ? project(group.proposal, group.originals, group.positionEncoding ?? this.encoding, outcome)
        : { documents: group.documents, touched: group.touched };

    const next: DraftGroup = {
      ...group,
      ...projection,
      documents: ownedVersions(reconcileVersions(projection.documents, group.documents), outcome),
      revision: group.revision + 1,
      updatedAt: Date.now(),
      outcome,
      state: restored ? "restored" : applied ? "applied" : "partial",
      message: outcome.message,
    };

    await this.store.commit(next, group.revision);
    await this.port.current(group, outcome);
    this.port.publish(next, group);

    return next;
  }
}

const validateOutcomeSteps = (group: DraftGroup, outcome: LanguageTreeOperationOutcome) => {
  const resources = (group.proposal.edit.documentChanges ?? []).flatMap((change, index) =>
    "kind" in change ? [{ index, change }] : []
  );

  if (new Set(outcome.steps.map((step) => step.index)).size !== outcome.steps.length)
    throw new Error("Duplicate outcome steps.");

  for (const step of outcome.steps) {
    const resource = resources.find((item) => item.index === step.index);

    if (!resource || !same(resource.change, step.operation))
      throw new Error("Outcome step differs from the accepted operation.");
  }

  if (
    outcome.state === "applied" &&
    (outcome.steps.length !== resources.length ||
      outcome.steps.some((step) => step.state !== "applied"))
  )
    throw new Error("Incomplete applied Host outcome.");
};

const reconcileVersions = (
  documents: readonly DraftDocument[],
  previous: readonly DraftDocument[]
) =>
  documents.map((doc) => {
    const prior = previous.find(
      (item) => item.sourcePath !== null && item.sourcePath === doc.sourcePath
    );

    if (!prior) return doc;
    const changed = prior.text !== doc.text;
    const version = prior.version + Number(changed);
    const draftRevision = prior.draftRevision + Number(changed);

    return {
      ...doc,
      version,
      draftRevision,
      buffer: doc.buffer === null ? null : { version, draftRevision, text: doc.text },
    };
  });

const ownedVersions = (
  documents: readonly DraftDocument[],
  outcome: LanguageTreeOperationOutcome
) =>
  documents.map((doc) => ({
    ...doc,
    diskVersion: receiptVersion(outcome, doc.canonicalPath) ?? doc.diskVersion,
  }));
