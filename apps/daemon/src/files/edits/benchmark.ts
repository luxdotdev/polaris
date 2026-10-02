import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  HostId,
  WorkspaceId,
  LanguageCheckout,
  LanguageEditProposal,
  LanguageEditAcceptance,
  LanguageOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";
import { renamePath, writeVersioned } from "../write.ts";
import { currentVersion } from "../version.ts";
import { createFileEditCoordinator } from "./index.ts";
import { prepare } from "./plan.ts";
import { persistJournal } from "./journal.ts";

const batch = async (home: string, label: string, count: number) => {
  const root = join(home, label);
  await mkdir(root);
  const uri = (name: string) => pathToFileURL(join(root, name)).href;

  for (let index = 0; index < count; index++)
    await writeFile(join(root, `before-${index}`), "x".repeat(1024));

  const owner = {
    hostId: HostId.make("fake-host"),
    clientId: "benchmark",
    checkout: LanguageCheckout.cases.Workspace.make({
      workspaceId: WorkspaceId.make("fake-workspace"),
      path: root,
    }),
  };

  const started = performance.now();

  const snapshots = await Promise.all(
    Array.from({ length: count }, async (_, index) => [
      {
        uri: uri(`before-${index}`),
        canonicalPath: join(root, `before-${index}`),
        diskVersion: await currentVersion(join(root, `before-${index}`)),
        diskText: null,
        buffer: null,
      },
      {
        uri: uri(`after-${index}`),
        canonicalPath: join(root, `after-${index}`),
        diskVersion: null,
        diskText: null,
        buffer: null,
      },
    ])
  );

  const proposal = Schema.decodeUnknownSync(LanguageEditProposal)({
    proposalId: "proposal",
    origin: "rename",
    label: "Benchmark",
    expiresAt: Date.now() + 60000,
    fence: {
      context: {
        ...owner,
        contextId: "context",
        providerId: "provider",
        projectRoot: root,
        generation: 1,
        configurationFingerprint: "a".repeat(64),
      },
      requiredSequence: 0,
      documents: [],
    },
    snapshots: snapshots.flat(),
    edit: {
      documentChanges: Array.from({ length: count }, (_, index) => ({
        kind: "rename",
        oldUri: uri(`before-${index}`),
        newUri: uri(`after-${index}`),
      })),
    },
  });

  const acceptance = Schema.decodeUnknownSync(LanguageEditAcceptance)({
    proposalId: "proposal",
    operationId: "operation",
    fence: proposal.fence,
    snapshots: proposal.snapshots,
    decision: "accept",
  });

  return { root, owner, proposal, acceptance, snapshotMs: performance.now() - started };
};

if (import.meta.main) {
  if (process.env.POLARIS_LEASE_HELD !== "m31-bench") throw new Error("Run under m31-bench lease");
  const home = await realpath(await mkdtemp(join(tmpdir(), "m31-x1-measure-")));
  const results = [];
  const count = 16;

  try {
    for (let run = 0; run < 5; run++) {
      const prepared = await batch(home, `prepare-${run}`, count);

      const outcome = Schema.decodeUnknownSync(LanguageOperationOutcome)({
        operationId: "operation",
        proposalId: "proposal",
        owner: prepared.owner,
        state: "prepared",
        draftsDurable: true,
        receiptDurable: false,
        receiptRevision: 0,
        draftGroupId: null,
        steps: [],
        failedChange: null,
        message: "Prepared",
      });

      const directory = join(home, `prepare-journal-${run}`);
      const prepareStart = performance.now();

      const journal = await prepare(
        directory,
        prepared.root,
        prepared.proposal,
        outcome,
        "benchmark"
      );

      const prepareMs = performance.now() - prepareStart;
      const persistStart = performance.now();
      await persistJournal(directory, journal);
      const receiptMs = performance.now() - persistStart;
      const measured = await batch(home, `coordinator-${run}`, count);
      let observedRss = process.memoryUsage().rss;

      const coordinator = createFileEditCoordinator({
        journalRoot: join(home, `journal-${run}`),
        authorize: async () => {},
        fault: async () => {
          observedRss = Math.max(observedRss, process.memoryUsage().rss);
        },
      });

      const applyStart = performance.now();

      const applied = await coordinator.accept(
        measured.owner,
        measured.proposal,
        measured.acceptance,
        { durable: true, groupId: null }
      );

      if (applied.state !== "applied") throw new Error(applied.message);
      const acceptMs = performance.now() - applyStart;
      const recoveryStart = performance.now();

      const restored = await coordinator.recover(
        measured.owner,
        "operation",
        applied.receiptRevision,
        "undo"
      );

      if (restored.state !== "restored") throw new Error(restored.message);
      const recoveryMs = performance.now() - recoveryStart;
      const control = await batch(home, `control-${run}`, count);
      const saveControlStart = performance.now();

      for (let index = 0; index < count; index++) {
        const expected = control.proposal.snapshots[index * 2]!.diskVersion;

        if (!expected) throw new Error("Control source is missing");
        await writeVersioned(
          join(control.root, `before-${index}`),
          Buffer.from("x".repeat(1024)),
          expected
        );
      }

      const versionCheckedSaveMs = performance.now() - saveControlStart;
      const controlStart = performance.now();

      for (let index = 0; index < count; index++)
        await renamePath(
          join(control.root, `before-${index}`),
          join(control.root, `after-${index}`)
        );
      results.push({
        run,
        count,
        snapshotMs: measured.snapshotMs,
        validatePrepareMs: prepareMs,
        singlePreparedReceiptMs: receiptMs,
        coordinatorAcceptIncludingJournalsMs: acceptMs,
        recoveryIncludingJournalsMs: recoveryMs,
        existingVersionCheckedSaveControlMs: versionCheckedSaveMs,
        existingSerializedRenameControlMs: performance.now() - controlStart,
        processPeakRssRaw: process.resourceUsage().maxRSS,
        observedRssMiB: observedRss / 1048576,
      });
    }

    console.log(
      JSON.stringify(
        {
          machine: process.platform,
          bun: Bun.version,
          fixture:
            "16 independent 1KiB regular-file renames on same temporary filesystem; 5 runs; observed RSS sampled at durable checkpoints",
          limits:
            "No historical coordinator baseline. Existing version-checked save and serialized rename controls have no batch crash journal; rename has no expected-version guards. Validation/prepare combined; accept/recovery include all receipts. resourceUsage maxRSS is retained as platform-specific Bun raw units, not KiB. Observed RSS is not sampler peak or total Daemon/process-tree memory.",
          results,
        },
        null,
        2
      )
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
