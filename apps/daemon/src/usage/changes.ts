/**
 * What changed in one pass, as `UsageChanged` buckets: every bucket in the
 * hours a pass touched, plus a zero bucket for any key it emptied.
 */
import type { UsageBucket } from "@polaris/protocol";
import type { UsageDb } from "./db.ts";
import { bucketsInHours, zeroBucket } from "./query.ts";
import type { UsageWriter, Vacated } from "./writer.ts";

/** The buckets a pass touched, plus a zero bucket for any it emptied (a replaced response moved). */
export const changedBuckets = (db: UsageDb, writer: UsageWriter): Array<UsageBucket> => {
  const hours = new Map<string, Set<number>>();
  const keys: Array<{ hour: number; harness: string; model: string; native: string }> = [];

  for (const key of writer.touched) {
    const [hour, harness, model, native] = key.split("\u0000");

    if (hour === undefined || harness === undefined || model === undefined || native === undefined)
      continue;
    keys.push({ hour: Number(hour), harness, model, native });
    hours.set(harness, (hours.get(harness) ?? new Set()).add(Number(hour)));
  }

  const buckets = [...hours].flatMap(([harness, set]) => bucketsInHours(db, harness, [...set]));

  const id = (hour: string, harness: string, model: string, session: string | null) =>
    `${hour}\u0000${harness}\u0000${model}\u0000${session ?? ""}`;

  const present = new Set(buckets.map((b) => id(b.hour, b.harness, b.model, b.sessionId)));

  const candidates: Array<Vacated> = [
    ...keys.map((key) => ({ ...key, sessionId: writer.sessionOf(key.harness, key.native) })),
    ...writer.vacated,
  ];

  for (const key of candidates) {
    const hour = new Date(key.hour).toISOString();

    if (present.has(id(hour, key.harness, key.model, key.sessionId))) continue;
    present.add(id(hour, key.harness, key.model, key.sessionId));
    buckets.push(zeroBucket(key));
  }

  return buckets;
};

/** The changed buckets, then forgets what the pass touched. */
export const takeChanges = (db: UsageDb, writer: UsageWriter): Array<UsageBucket> => {
  if (writer.touched.size === 0 && writer.vacated.length === 0) return [];
  const buckets = changedBuckets(db, writer);
  writer.touched.clear();
  writer.vacated.length = 0;

  return buckets;
};
