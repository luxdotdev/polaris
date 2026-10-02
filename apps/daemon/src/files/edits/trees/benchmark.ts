import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./testing.ts";
import { identity, loadJournal, persistJournal } from "./journal.ts";
import { snapshotTree } from "./snapshot.ts";

const timed = async <A>(run: () => Promise<A>) => {
  const start = performance.now();
  const value = await run();

  return { value, ms: performance.now() - start };
};

export const measureTrees = async () => {
  const runs = [];

  for (let run = 0; run < 5; run++) {
    const f = await fixture();

    try {
      for (let index = 0; index < 16; index++)
        await writeFile(join(f.root, "source/nested", `file-${index}`), "x".repeat(1024));
      const snapshot = await timed(() => snapshotTree(f.root, join(f.root, "source")));
      const request = await f.request(f.chain());
      let preparedAt = 0;
      let peakRss = process.memoryUsage().rss;
      const started = performance.now();

      const outcome = await f
        .coordinator({
          fault: async (point) => {
            peakRss = Math.max(peakRss, process.memoryUsage().rss);

            if (point === "prepared") preparedAt = performance.now();
          },
        })
        .accept(f.owner, request.proposal, request.acceptance, request.drafts);

      if (outcome.state !== "applied") throw new Error(outcome.message);
      const finished = performance.now();
      const directory = join(f.home, "journal", `tree-${identity(f.owner, "operation")}`);
      const journal = (await loadJournal(directory))!;
      const receipt = await timed(() => persistJournal(directory, journal));

      const restarted = f.coordinator({
        fault: async () => {
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
        },
      });

      const query = await timed(() => restarted.get(f.owner, "operation"));

      const recovery = await timed(() =>
        restarted.recover(f.owner, "operation", receipt.value.outcome.receiptRevision, "undo")
      );

      if (recovery.value.state !== "restored") throw new Error(recovery.value.message);

      const control = await timed(async () => {
        await rename(join(f.root, "source"), join(f.root, "final"));
        await rename(join(f.root, "final"), join(f.root, "source"));
      });

      runs.push({
        snapshotMs: snapshot.ms,
        prepareMs: preparedAt - started,
        applyMs: finished - preparedAt,
        acceptMs: finished - started,
        journalMs: receipt.ms,
        restartQueryMs: query.ms,
        undoMs: recovery.ms,
        plainRenameRoundtripMs: control.ms,
        checkpointPeakRssMiB: peakRss / 1048576,
      });
    } finally {
      await f.cleanup();
    }
  }

  return {
    fixture:
      "5 independent private same-filesystem directory fixtures,16x1KiB+original descendants,4-move overwrite/rename/delete chain",
    limits:
      "checkpoint RSS only; no process-tree/physical footprint peak, historical durability baseline or production budget certification; plain rename lacks version/hash/journal/fsync/auth/draft/guard semantics",
    processPeakRssRaw: process.resourceUsage().maxRSS,
    runs,
  };
};

if (import.meta.main) {
  const result = await measureTrees();
  console.log(JSON.stringify(result, null, 2));
}
