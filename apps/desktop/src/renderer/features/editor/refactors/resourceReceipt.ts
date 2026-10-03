import * as P from "@polaris/protocol";
import { Match, Schema } from "effect";
import type { RefactorController } from "./controller.ts";
import type { GroupStore, DraftGroup } from "./group.ts";
import { equal } from "./equality.ts";

export interface ResourceReceiptPorts {
  readonly groups: GroupStore;
  readonly controller: (context: P.LanguageContextIdentity) => RefactorController | null;
  /** Recheck the independent Main identity, registered checkout and retained E1 context after waits. */
  readonly current: (context: P.LanguageContextIdentity) => void;
}

/** Private current-connection challenge; this never accepts, replays or changes a draft group. */
export const verifyResourceReceiptChallenge = async (
  ports: ResourceReceiptPorts,
  context: P.LanguageContextIdentity,
  input: typeof P.LanguageResourceReceiptChallenge.Type
): Promise<typeof P.LanguageResourceReceiptResponse.Type> => {
  const challenge = Schema.decodeUnknownSync(P.LanguageResourceReceiptChallenge)(input);
  ports.current(context);
  const controller = ports.controller(context);

  if (controller === null)
    throw new Error("The authenticated refactor coordinator is unavailable.");

  const resolve = async (acceptance: P.LanguageTreeEditAcceptance): Promise<DraftGroup> => {
    const groups = await ports.groups.list();
    ports.current(context);

    const matches = groups.filter(
      (group) =>
        group.operationId === challenge.operationId &&
        group.proposal.proposalId === acceptance.proposalId &&
        equal(group.proposal.fence.context, context)
    );

    if (matches.length !== 1)
      throw new Error("The exact persisted refactor operation is unavailable.");
    const group = matches[0]!;

    if (
      group.state !== "prepared" ||
      acceptance.operationId !== challenge.operationId ||
      acceptance.decision !== "accept" ||
      !equal(acceptance.fence, group.proposal.fence) ||
      !equal(acceptance.snapshots, group.proposal.snapshots) ||
      !equal(acceptance.resourceSnapshots, group.proposal.resourceSnapshots)
    )
      throw new Error("The acceptance does not own the persisted refactor preview.");

    return group;
  };

  const group = await Match.value(challenge).pipe(
    Match.tag("Resolve", ({ acceptance }) => resolve(acceptance)),
    Match.tag("Verify", async ({ proposal, drafts, phase }) => {
      if (phase === "moving")
        await controller.coordinator.verifyMovingReceipt(
          context,
          proposal,
          drafts,
          challenge.operationId
        );
      else
        await controller.coordinator.verifyReceipt(
          context,
          proposal,
          drafts,
          challenge.operationId
        );
      const saved = await ports.groups.get(drafts.groupId);

      if (saved === null) throw new Error("The persisted refactor draft group is missing.");

      return saved;
    }),
    Match.tag("Recover", async ({ groupId }) => {
      const saved = await ports.groups.get(groupId);

      if (saved === null) throw new Error("The persisted refactor draft group is missing.");
      await controller.coordinator.port.current(saved);

      return saved;
    }),
    Match.exhaustive
  );

  ports.current(context);

  const metadata = await controller.coordinator.groupStatus(
    context,
    group.id,
    challenge.operationId
  );

  ports.current(context);

  Match.value(challenge).pipe(
    Match.tag("Recover", (value) => {
      if (
        metadata.proposalId !== value.proposalId ||
        metadata.previewFingerprint !== value.previewFingerprint ||
        metadata.hostReceiptRevision !== value.hostReceiptRevision ||
        metadata.state === "conflict"
      )
        throw new Error("The recovery challenge does not own the reconciled Host receipt.");
    }),
    Match.orElse(() => undefined)
  );

  if (
    !equal(group, await ports.groups.get(group.id)) ||
    ports.controller(context) !== controller ||
    metadata.localRevision !== group.revision
  )
    throw new Error("The persisted refactor receipt changed during verification.");
  ports.current(context);

  return Schema.decodeUnknownSync(P.LanguageResourceReceiptResponse)({
    nonce: challenge.nonce,
    operationId: challenge.operationId,
    groupId: metadata.groupId,
    localRevision: metadata.localRevision,
    previewFingerprint: metadata.previewFingerprint,
    hostReceiptRevision: metadata.hostReceiptRevision,
    ...Match.value(challenge).pipe(
      Match.tag("Resolve", () => ({ proposal: group.proposal })),
      Match.orElse(() => ({}))
    ),
  });
};
