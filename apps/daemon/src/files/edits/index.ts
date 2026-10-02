import { FileEditFailure } from "./failure.ts";
import { mkdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  LanguageEditAcceptance,
  LanguageEditProposal,
  LanguageOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";
import { withFileMutation } from "../write.ts";
import {
  fingerprint,
  identity,
  loadJournal,
  persistJournal,
  type Journal,
  type Owner,
} from "./journal.ts";
import { contained } from "./paths.ts";
import { prepare, resourcePaths } from "./plan.ts";
import { InjectedCrash, location, lockPaths, moveFile, type Fault } from "./moves.ts";

export { InjectedCrash } from "./moves.ts";

export type { Owner } from "./journal.ts";

const locked = <A>(paths: string[], run: () => Promise<A>): Promise<A> => {
  const [path, ...rest] = paths;

  return path === undefined ? run() : withFileMutation(path, () => locked(rest, run));
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
  state: LanguageOperationOutcome["state"],
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
    proposal: LanguageEditProposal,
    acceptance: typeof LanguageEditAcceptance.Type
  ) => Promise<void>;
  readonly fault?: Fault;
}

export interface DraftReceipt {
  readonly durable: boolean;
  readonly groupId: string | null;
}

/** Detached coordinator: G2 registers only after authentication, draft persistence and capability gates. */
export const createFileEditCoordinator = (options: CoordinatorOptions) => {
  const directoryFor = (owner: Owner, operationId: string) =>
    join(
      options.journalRoot,
      identity(
        Schema.decodeUnknownSync(LanguageOperationOutcome.fields.owner)(owner),
        Schema.decodeUnknownSync(LanguageEditAcceptance.fields.operationId)(operationId)
      )
    );

  const fault: Fault = options.fault ?? (async () => {});

  const get = async (owner: Owner, operationId: string) => {
    const directory = directoryFor(owner, operationId);

    return withFileMutation(directory, async () => (await loadJournal(directory))?.outcome ?? null);
  };

  const applyMoves = async (directory: string, initial: Journal, signal?: AbortSignal) => {
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
            message: String(cause),
          })),
        },
      };

      return (
        await persistJournal(
          directory,
          outcomeState(journal, touched ? "partial" : "failed", String(cause))
        )
      ).outcome;
    }
  };

  const accept = async (
    owner: Owner,
    input: LanguageEditProposal,
    decision: typeof LanguageEditAcceptance.Type,
    drafts: DraftReceipt,
    signal?: AbortSignal
  ) => {
    const proposal = Schema.decodeUnknownSync(LanguageEditProposal)(input);
    const acceptance = Schema.decodeUnknownSync(LanguageEditAcceptance)(decision);
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

        return previous.outcome;
      }

      await options.authorize(owner, proposal, acceptance);

      if (
        proposal.proposalId !== acceptance.proposalId ||
        fingerprint(proposal.fence) !== fingerprint(acceptance.fence) ||
        fingerprint(proposal.snapshots) !== fingerprint(acceptance.snapshots)
      )
        throw new FileEditFailure({
          code: "invalid-operation",
          message: "Acceptance does not match proposal",
        });
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

      if (
        journalRoot !== options.journalRoot ||
        contained(root, journalRoot) ||
        root === journalRoot
      )
        throw new FileEditFailure({
          code: "invalid-root",
          message: "Journal root must be canonical and private outside checkout",
        });

      const outcome = Schema.decodeUnknownSync(LanguageOperationOutcome)({
        operationId: acceptance.operationId,
        proposalId: proposal.proposalId,
        owner,
        state: "prepared",
        draftsDurable: drafts.durable,
        receiptDurable: false,
        receiptRevision: 0,
        draftGroupId: drafts.groupId,
        steps: [],
        failedChange: null,
        message: "Prepared",
      });

      if (acceptance.decision === "reject")
        return (
          await persistJournal(directory, {
            format: 1,
            root,
            fingerprint: requestFingerprint,
            moves: [],
            outcome: { ...outcome, state: "rejected" },
          })
        ).outcome;

      if (!drafts.durable)
        throw new FileEditFailure({
          code: "drafts-not-durable",
          message: "Client drafts must be durable before resource operations",
        });
      await rm(directory, { recursive: true, force: true });

      const { paths } = await resourcePaths(root, proposal);

      return locked([...new Set(paths.values())].sort(), async () => {
        await options.authorize(owner, proposal, acceptance);

        if (proposal.expiresAt <= Date.now())
          throw new FileEditFailure({
            code: "stale-proposal",
            message: "Proposal expired while waiting for resource locks",
          });
        let journal: Journal;

        try {
          journal = await prepare(directory, root, proposal, outcome, requestFingerprint);
        } catch (cause) {
          await rm(directory, { recursive: true, force: true });

          return (
            await persistJournal(directory, {
              format: 1,
              root,
              fingerprint: requestFingerprint,
              moves: [],
              outcome: { ...outcome, state: "failed", message: String(cause) },
            })
          ).outcome;
        }

        journal = await persistJournal(directory, journal);
        await fault("prepared", -1);

        return applyMoves(directory, journal, signal);
      });
    });
  };

  const restoreMove = async (directory: string, initial: Journal, index: number) => {
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
      const recorded = await loadJournal(directory);

      if (!recorded)
        throw new FileEditFailure({
          code: "operation-not-found",
          message: "Unknown resource operation",
        });

      if ((await realpath(owner.checkout.path)) !== recorded.root)
        throw new FileEditFailure({ code: "invalid-root", message: "Checkout identity changed" });

      if (recorded.outcome.receiptRevision !== expectedReceiptRevision)
        throw new FileEditFailure({
          code: "receipt-conflict",
          message: "Receipt revision changed",
        });

      if (["restored", "rejected", "failed"].includes(recorded.outcome.state))
        return recorded.outcome;

      let activeStep: number | null = null;

      return locked(lockPaths(recorded), async () => {
        let journal = await persistJournal(
          directory,
          outcomeState(recorded, "recovering", `${intent}: restoring resource operations`)
        );

        try {
          for (let index = journal.moves.length - 1; index >= 0; index--) {
            const move = journal.moves[index]!;
            activeStep = move.step;

            if (move.state === "pending" || move.state === "restored") continue;
            journal = await restoreMove(directory, journal, index);
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
                message: String(cause),
              })),
            },
          };

          return (
            await persistJournal(
              directory,
              outcomeState(journal, "recovery-required", String(cause))
            )
          ).outcome;
        }
      });
    });
  };

  return { accept, get, recover };
};
