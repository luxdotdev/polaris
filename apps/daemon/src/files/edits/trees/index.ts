import { FileEditFailure } from "../failure.ts";
import { mkdir, realpath, rm, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  LanguageTreeEditAcceptance,
  LanguageTreeEditProposal,
  LanguageTreeOperationOutcome,
  LanguageTreeDraftReceipt,
  LanguageTreeEditDecision,
} from "@polaris/protocol";
import { Schema } from "effect";
import { withFileMutation } from "../../write.ts";
import {
  fingerprint,
  identity,
  loadJournal,
  persistJournal,
  type Journal,
  type Owner,
} from "./journal.ts";
import { contained } from "../paths.ts";
import { acceptanceLocks, prepare, resourcePaths, validateSnapshots } from "./plan.ts";
import { InjectedCrash, location, lockPaths, moveFile, type Fault } from "./moves.ts";

import { resourceIdentity, sameIdentity } from "./snapshot.ts";

export { snapshotTree } from "./snapshot.ts";

export { InjectedCrash } from "./moves.ts";

export type { Owner } from "./journal.ts";

const locked = <A>(paths: string[], run: () => Promise<A>): Promise<A> => {
  const next = (index: number): Promise<A> => {
    const path = paths[index];

    return path === undefined ? run() : withFileMutation(path, () => next(index + 1));
  };

  return next(0);
};

const updateMove = (
  journal: Journal,
  index: number,
  state: Journal["moves"][number]["state"]
): Journal => ({
  ...journal,
  moves: journal.moves.map((move, at) => (at === index ? { ...move, state } : move)),
});

const outcomeState = (
  journal: Journal,
  state: LanguageTreeOperationOutcome["state"],
  message: string
): Journal => ({
  ...journal,
  outcome: { ...journal.outcome, state, message },
});

export interface CoordinatorOptions {
  /** Private Daemon-controlled directory on the checkout's filesystem; never Client supplied. */
  readonly journalRoot: string;
  /** Revalidates authenticated owner, context generation, fence, expiry and accepted preview. */
  readonly authorize: (
    owner: Owner,
    proposal: LanguageTreeEditProposal,
    acceptance: typeof LanguageTreeEditAcceptance.Type,
    drafts: LanguageTreeDraftReceipt | null,
    phase?: "prepare" | "moving"
  ) => Promise<void>;
  /** Authenticate status/recovery owner and verify current Client reconciliation before undo. */
  readonly authorizeRecovery: (
    owner: Owner,
    operationId: string,
    intent: "get" | "recover" | "undo" | "cancel",
    outcome?: LanguageTreeOperationOutcome,
    authority?: Journal["authority"]
  ) => Promise<void>;
  readonly fault?: Fault;
}

/** Detached coordinator: G2 registers only after authentication, draft persistence and capability gates. */
export const createTreeEditCoordinator = (options: CoordinatorOptions) => {
  const directoryFor = (owner: Owner, operationId: string) =>
    join(
      options.journalRoot,
      "tree-" +
        identity(
          Schema.decodeUnknownSync(LanguageTreeOperationOutcome.fields.owner)(owner),
          Schema.decodeUnknownSync(LanguageTreeEditAcceptance.fields.operationId)(operationId)
        )
    );

  const fault: Fault = options.fault ?? (async () => {});

  const get = async (owner: Owner, operationId: string) => {
    const directory = directoryFor(owner, operationId);

    return withFileMutation(directory, async () => {
      await options.authorizeRecovery(owner, operationId, "get");

      return (await loadJournal(directory))?.outcome ?? null;
    });
  };

  const requireLocation = async (
    directory: string,
    journal: Journal,
    move: Journal["moves"][number],
    expected: "before" | "after"
  ) => {
    if ((await location(directory, journal, move)) !== expected)
      throw new FileEditFailure({
        code: "disk-conflict",
        message: "Resource changed during authorization",
      });
  };

  const applyMoves = async (
    directory: string,
    initial: Journal,
    signal: AbortSignal | undefined,
    authorize: () => Promise<void>
  ) => {
    let journal = initial;
    let activeMove = 0;

    try {
      if (signal?.aborted)
        throw new FileEditFailure({ code: "cancelled", message: "Resource operation cancelled" });

      for (const [index, move] of journal.moves.entries()) {
        activeMove = index;

        if (signal?.aborted)
          throw new FileEditFailure({ code: "cancelled", message: "Resource operation cancelled" });

        if ((await location(directory, journal, move)) !== "before")
          throw new FileEditFailure({
            code: "disk-conflict",
            message: "Resource version changed before mutation",
          });
        journal = await persistJournal(
          directory,
          outcomeState(
            updateMove(journal, index, "forward"),
            "applying",
            "Applying resource operation"
          )
        );
        await fault("intent", index);

        if (signal?.aborted)
          throw new FileEditFailure({ code: "cancelled", message: "Resource operation cancelled" });

        if ((await location(directory, journal, move)) !== "before")
          throw new FileEditFailure({
            code: "disk-conflict",
            message: "Resource version changed after intent",
          });
        await authorize();
        await requireLocation(directory, journal, move, "before");
        await moveFile(move.from, move.to);
        await fault("mutation", index);
        journal = await persistJournal(directory, updateMove(journal, index, "applied"));
        await fault("receipt", index);
      }

      journal = {
        ...journal,
        outcome: {
          ...journal.outcome,
          steps: journal.outcome.steps.map((step) => ({
            ...step,
            state: "applied",
            message: "Applied",
          })),
        },
      };

      return (
        await persistJournal(
          directory,
          outcomeState(journal, "applied", "Resource operations applied")
        )
      ).outcome;
    } catch (cause) {
      if (cause instanceof InjectedCrash) throw cause;
      const touched = journal.moves.some((move) => move.state !== "pending");

      const failed = journal.moves[activeMove]?.step ?? null;

      journal = {
        ...journal,
        outcome: {
          ...journal.outcome,
          failedChange: failed,
          steps: journal.outcome.steps.map((step) => ({
            ...step,
            state:
              step.index === failed
                ? "failed"
                : journal.moves
                      .filter((move) => move.step === step.index)
                      .every((move) => move.state === "applied")
                  ? "applied"
                  : "not-applied",
            message: String(cause).slice(0, 512),
          })),
        },
      };

      return (
        await persistJournal(
          directory,
          outcomeState(journal, touched ? "partial" : "failed", String(cause).slice(0, 512))
        )
      ).outcome;
    }
  };

  const accept = async (
    owner: Owner,
    input: LanguageTreeEditProposal,
    decision: typeof LanguageTreeEditAcceptance.Type,
    drafts: LanguageTreeDraftReceipt | null,
    signal?: AbortSignal
  ) => {
    const proposal = Schema.decodeUnknownSync(LanguageTreeEditProposal)(input);
    const acceptance = Schema.decodeUnknownSync(LanguageTreeEditAcceptance)(decision);
    drafts = drafts === null ? null : Schema.decodeUnknownSync(LanguageTreeDraftReceipt)(drafts);

    if (
      drafts?.descendants.some(
        (draft) =>
          resolve(draft.canonicalPath) !== draft.canonicalPath ||
          !proposal.resourceSnapshots.some(
            (snapshot) =>
              snapshot.canonicalPath === draft.canonicalPath ||
              contained(snapshot.canonicalPath, draft.canonicalPath)
          )
      )
    )
      throw new FileEditFailure({
        code: "invalid-operation",
        message: "Draft descendant escapes affected resource roots",
      });

    if (acceptance.decision === "accept" && !drafts)
      throw new FileEditFailure({
        code: "drafts-not-durable",
        message: "Client drafts must be durable before resource operations",
      });
    const directory = directoryFor(owner, acceptance.operationId);
    const requestFingerprint = fingerprint([proposal, acceptance, drafts]);

    return withFileMutation(directory, async () => {
      const previous = await loadJournal(directory);

      if (previous) {
        if (previous.fingerprint !== requestFingerprint)
          throw new FileEditFailure({
            code: "invalid-operation",
            message: "Operation ID already belongs to a different acceptance",
          });

        await options.authorizeRecovery(owner, acceptance.operationId, "get");

        return previous.outcome;
      }

      await options.authorize(owner, proposal, acceptance, drafts);

      if (
        proposal.proposalId !== acceptance.proposalId ||
        fingerprint(proposal.fence) !== fingerprint(acceptance.fence) ||
        fingerprint(proposal.snapshots) !== fingerprint(acceptance.snapshots) ||
        fingerprint(proposal.resourceSnapshots) !== fingerprint(acceptance.resourceSnapshots) ||
        (drafts !== null &&
          (fingerprint(proposal.resourceSnapshots) !== fingerprint(drafts.resourceSnapshots) ||
            fingerprint(proposal) !== drafts.previewFingerprint))
      )
        throw new FileEditFailure({
          code: "invalid-operation",
          message: "Acceptance does not match proposal",
        });
      Schema.decodeUnknownSync(LanguageTreeEditDecision)({ acceptance, drafts });
      const context = proposal.fence.context;

      if (
        context.hostId !== owner.hostId ||
        context.clientId !== owner.clientId ||
        fingerprint(context.checkout) !== fingerprint(owner.checkout)
      )
        throw new FileEditFailure({ code: "owner-mismatch", message: "Proposal owner mismatch" });

      if (proposal.expiresAt <= Date.now())
        throw new FileEditFailure({ code: "stale-proposal", message: "Proposal expired" });
      const root = await realpath(owner.checkout.path);
      await mkdir(options.journalRoot, { recursive: true, mode: 0o700 });
      const journalRoot = await realpath(options.journalRoot);
      const journalStat = await lstat(journalRoot);
      const checkoutStat = await lstat(root);

      if (
        !journalStat.isDirectory() ||
        (journalStat.mode & 0o077) !== 0 ||
        journalStat.dev !== checkoutStat.dev
      )
        throw new FileEditFailure({
          code: "invalid-root",
          message: "Journal must be private and on the resource filesystem",
        });

      if (
        journalRoot !== options.journalRoot ||
        contained(root, journalRoot) ||
        root === journalRoot
      )
        throw new FileEditFailure({
          code: "invalid-root",
          message: "Journal root must be canonical and private outside checkout",
        });

      const outcome = Schema.decodeUnknownSync(LanguageTreeOperationOutcome)({
        operationId: acceptance.operationId,
        proposalId: proposal.proposalId,
        format: 2,
        owner,
        state: "prepared",
        draftsDurable: drafts?.durable ?? false,
        receiptDurable: false,
        receiptRevision: 0,
        draftGroupId: drafts?.groupId ?? null,
        steps: [],
        failedChange: null,
        message: "Prepared",
      });

      if (acceptance.decision === "reject")
        return (
          await persistJournal(directory, {
            format: 2,
            rootIdentity: resourceIdentity(await lstat(root)),
            root,
            fingerprint: requestFingerprint,
            moves: [],
            outcome: { ...outcome, state: "rejected" },
          })
        ).outcome;

      if (!drafts?.durable)
        throw new FileEditFailure({
          code: "drafts-not-durable",
          message: "Client drafts must be durable before resource operations",
        });
      await rm(directory, { recursive: true, force: true });

      const { paths } = await resourcePaths(root, proposal);
      const locks = await acceptanceLocks(root, proposal, paths);

      return locked([root], async () => {
        await options.authorize(owner, proposal, acceptance, drafts);

        if (proposal.expiresAt <= Date.now())
          throw new FileEditFailure({
            code: "stale-proposal",
            message: "Proposal expired while waiting for resource locks",
          });
        let journal: Journal;

        try {
          journal = await prepare(directory, root, proposal, outcome, requestFingerprint);
          journal = {
            ...journal,
            authority: {
              context: proposal.fence.context,
              previewFingerprint: fingerprint(proposal),
            },
          };
        } catch (cause) {
          await rm(directory, { recursive: true, force: true });

          return (
            await persistJournal(directory, {
              format: 2,
              rootIdentity: resourceIdentity(await lstat(root)),
              root,
              fingerprint: requestFingerprint,
              moves: [],
              outcome: { ...outcome, state: "failed", message: String(cause).slice(0, 512) },
            })
          ).outcome;
        }

        const finalLocks = [...new Set([...locks, ...lockPaths(journal)])]
          .filter((path) => path !== root && path !== directory)
          .sort();

        return locked(finalLocks, async () => {
          await options.authorize(owner, proposal, acceptance, drafts);

          if (proposal.expiresAt <= Date.now())
            throw new FileEditFailure({
              code: "stale-proposal",
              message: "Proposal expired while waiting for final locks",
            });
          await validateSnapshots(root, proposal, paths);
          journal = await persistJournal(directory, journal);
          await fault("prepared", -1);

          return applyMoves(directory, journal, signal, () =>
            options.authorize(owner, proposal, acceptance, drafts, "moving")
          );
        });
      });
    });
  };

  const restoreMove = async (
    directory: string,
    initial: Journal,
    index: number,
    authorize: () => Promise<void>
  ) => {
    let journal = initial;
    const move = journal.moves[index]!;
    const current = await location(directory, journal, move);

    if (current === "conflict")
      throw new FileEditFailure({
        code: "disk-conflict",
        message: "Intervening version prevents recovery",
      });

    if (move.state === "applied" && current !== "after")
      throw new FileEditFailure({
        code: "disk-conflict",
        message: "Applied version is no longer owned",
      });

    if (current === "after") {
      journal = await persistJournal(directory, updateMove(journal, index, "backward"));
      await fault("restore-intent", index);

      if ((await location(directory, journal, move)) !== "after")
        throw new FileEditFailure({
          code: "disk-conflict",
          message: "Version changed before restoration",
        });
      await authorize();

      if ((await location(directory, journal, move)) !== "after")
        throw new FileEditFailure({
          code: "disk-conflict",
          message: "Resource changed during recovery authorization",
        });
      await moveFile(move.to, move.from);
      await fault("restore-mutation", index);
    }

    journal = await persistJournal(directory, updateMove(journal, index, "restored"));

    return journal;
  };

  const recover = async (
    owner: Owner,
    operationId: string,
    expectedReceiptRevision: number,
    intent: "recover" | "undo" | "cancel"
  ) => {
    const directory = directoryFor(owner, operationId);

    return withFileMutation(directory, async () => {
      await options.authorizeRecovery(owner, operationId, intent);
      const recorded = await loadJournal(directory);

      if (!recorded)
        throw new FileEditFailure({
          code: "operation-not-found",
          message: "Unknown resource operation",
        });

      await options.authorizeRecovery(
        owner,
        operationId,
        intent,
        recorded.outcome,
        recorded.authority
      );

      if (
        (await realpath(owner.checkout.path)) !== recorded.root ||
        !sameIdentity(recorded.rootIdentity, resourceIdentity(await lstat(recorded.root)))
      )
        throw new FileEditFailure({ code: "invalid-root", message: "Checkout identity changed" });

      if (recorded.outcome.receiptRevision !== expectedReceiptRevision)
        throw new FileEditFailure({
          code: "receipt-conflict",
          message: "Receipt revision changed",
        });

      if (["restored", "rejected", "failed"].includes(recorded.outcome.state))
        return recorded.outcome;

      let activeStep: number | null = null;

      return locked(
        lockPaths(recorded).filter((path) => path !== directory),
        async () => {
          await options.authorizeRecovery(
            owner,
            operationId,
            intent,
            recorded.outcome,
            recorded.authority
          );

          let journal = await persistJournal(
            directory,
            outcomeState(recorded, "recovering", `${intent}: restoring resource operations`)
          );

          try {
            for (let index = journal.moves.length - 1; index >= 0; index--) {
              const move = journal.moves[index]!;
              activeStep = move.step;

              if (move.state === "pending" || move.state === "restored") continue;
              journal = await restoreMove(directory, journal, index, () =>
                options.authorizeRecovery(
                  owner,
                  operationId,
                  intent,
                  recorded.outcome,
                  recorded.authority
                )
              );
            }

            journal = {
              ...journal,
              outcome: {
                ...journal.outcome,
                steps: journal.outcome.steps.map((step) => ({
                  ...step,
                  state: "restored",
                  message: "Restored",
                })),
              },
            };

            return (
              await persistJournal(
                directory,
                outcomeState(journal, "restored", "Resource operations restored")
              )
            ).outcome;
          } catch (cause) {
            if (cause instanceof InjectedCrash) throw cause;

            journal = {
              ...journal,
              outcome: {
                ...journal.outcome,
                failedChange: activeStep,
                steps: journal.outcome.steps.map((step) => ({
                  ...step,
                  state:
                    step.index === activeStep
                      ? "conflict"
                      : journal.moves
                            .filter((move) => move.step === step.index)
                            .every((move) => move.state === "restored" || move.state === "pending")
                        ? "restored"
                        : step.state,
                  message: String(cause).slice(0, 512),
                })),
              },
            };

            return (
              await persistJournal(
                directory,
                outcomeState(journal, "recovery-required", String(cause).slice(0, 512))
              )
            ).outcome;
          }
        }
      );
    });
  };

  return { accept, get, recover };
};
