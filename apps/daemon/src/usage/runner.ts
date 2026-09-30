/**
 * Runs index passes in the Daemon's own process. A pass does bounded work
 * between yields (a 256 KiB chunk of a log, ~4 ms of writes), so streams and
 * RPCs keep flowing while it reads gigabytes; see ADR 0009.
 */
import type { UsageBucket } from "@polaris/protocol";
import { takeChanges } from "./changes.ts";
import type { UsageDb } from "./db.ts";
import { discoverLogs, type Env, indexLogs, type UsageHarness } from "./indexer.ts";
import type { SessionLink } from "./sessions.ts";
import type { UsageWriter } from "./writer.ts";

export type IndexJob =
  | {
      readonly op: "pass";
      readonly harnesses: ReadonlyArray<UsageHarness>;
      readonly links: ReadonlyArray<SessionLink>;
      /** The links are every cursor ever (a new index): remember that it has them. */
      readonly backfill: boolean;
    }
  | { readonly op: "link"; readonly links: ReadonlyArray<SessionLink> };

export interface IndexRunner {
  /** Runs one job; resolves with when the index caught up (null for a link-only job). */
  readonly run: (job: IndexJob) => Promise<string | null>;
  /** The buckets the jobs since the last call changed. Cheap after a short pass only. */
  readonly takeChanges: () => ReadonlyArray<UsageBucket>;
  /** Forgets what changed, e.g. after a long pass whose watchers will query again. */
  readonly dropChanges: () => void;
}

const link = (writer: UsageWriter, links: ReadonlyArray<SessionLink>) =>
  writer.transaction(() => {
    for (const { harness, native, sessionId } of links) writer.link(harness, native, sessionId);
  });

export const inProcessRunner = (options: {
  readonly db: UsageDb;
  readonly writer: UsageWriter;
  readonly env: Env;
  readonly gcEveryBytes: number;
}): IndexRunner => {
  const { db, writer } = options;

  return {
    run: async (job) => {
      link(writer, job.links);

      if (job.op === "link") return null;

      if (job.backfill) writer.putMeta("links", "1");
      await indexLogs(writer, discoverLogs(options.env, job.harnesses), options.gcEveryBytes);
      const indexedAt = new Date().toISOString();
      writer.putMeta("indexedAt", indexedAt);

      return indexedAt;
    },
    takeChanges: () => takeChanges(db, writer),
    dropChanges: () => {
      writer.touched.clear();
      writer.vacated.length = 0;
    },
  };
};
