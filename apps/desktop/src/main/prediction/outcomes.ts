import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";
import {
  PredictionLogRecord,
  PredictionOutcome,
  PredictionKeystrokes,
  type PredictionMetrics,
} from "../../shared/predictionOutcomes.ts";

export const OUTCOME_LOG_MAX_BYTES = 5_000_000;

export const outcomeLogPath = (userData: string) => join(userData, "prediction-outcomes.jsonl");

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(PredictionLogRecord));

const isOutcome = Schema.is(PredictionOutcome);

export const predictionMetrics = (
  records: ReadonlyArray<PredictionLogRecord>
): PredictionMetrics => {
  const shown = records.filter(isOutcome).filter((record) => record.outcome !== null);
  const window = shown.slice(-200);
  const accepted = shown.filter((record) => record.outcome === "accepted");
  const undone = accepted.filter((record) => record.undoneWithin30s).length;

  const keystrokes = records.reduce(
    (sum, record) => sum + ("keystrokes" in record ? record.keystrokes : 0),
    0
  );

  const countsByKind = { insert: 0, replace: 0, delete: 0, import: 0, jump: 0 };

  for (const record of shown) countsByKind[record.kind]++;

  return {
    shown: shown.length,
    accepted: accepted.length,
    acceptanceWindow: window.length,
    acceptanceRate:
      window.length === 0
        ? null
        : window.filter((record) => record.outcome === "accepted").length / window.length,
    keystrokes,
    shownPer100Keystrokes: keystrokes === 0 ? null : (shown.length * 100) / keystrokes,
    undoneWithin30s: undone,
    undoneRate: accepted.length === 0 ? null : undone / accepted.length,
    countsByKind,
  };
};

/** One serialized writer; demand-scheduled batches never wake an idle Desktop App. */
export class PredictionOutcomes {
  private records: PredictionLogRecord[] = [];
  private lines: string[] = [];
  private bytes = 0;
  private pending: PredictionLogRecord[] = [];
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private tail: Promise<void>;
  private closed = false;

  constructor(private readonly path: string) {
    this.tail = this.load();
    void this.tail.catch(() => console.warn("polaris: prediction history unavailable"));
  }

  record(input: PredictionOutcome): void {
    const record = Schema.decodeUnknownSync(PredictionOutcome)(input);
    this.add(record);
  }

  keystrokes(input: PredictionKeystrokes): void {
    this.add(Schema.decodeUnknownSync(PredictionKeystrokes)(input));
  }

  private add(record: PredictionLogRecord) {
    if (this.closed) return;
    this.pending.push(record);

    if (this.scheduled !== null) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      void this.flush().catch(() => console.warn("polaris: prediction history write failed"));
    });
  }

  private enqueue(operation: () => Promise<void>) {
    this.tail = this.tail.then(operation);
    void this.tail.catch(() => {});

    return this.tail;
  }

  private trim() {
    let trimmed = false;

    while (this.bytes >= OUTCOME_LOG_MAX_BYTES) {
      const count = Math.ceil(this.lines.length / 2);
      const removed = this.lines.splice(0, count);
      this.records.splice(0, count);
      this.bytes -= removed.reduce((sum, line) => sum + Buffer.byteLength(line), 0);
      trimmed = true;
    }

    return trimmed;
  }

  private async replace() {
    await mkdir(dirname(this.path), { recursive: true });
    const partial = `${this.path}.part`;

    try {
      await writeFile(partial, this.lines.join(""), { mode: 0o600 });
      await rename(partial, this.path);
    } finally {
      await rm(partial, { force: true });
    }
  }

  private async load() {
    let source: string;

    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error)) return;
      throw error;
    }

    for (const line of source.split("\n")) {
      if (line.length === 0) continue;
      const record = decodeLine(line);

      if (Option.isNone(record)) continue;
      const encoded = `${JSON.stringify(record.value)}\n`;
      this.records.push(record.value);
      this.lines.push(encoded);
      this.bytes += Buffer.byteLength(encoded);
    }

    const trimmed = this.trim();

    if (trimmed || this.lines.join("") !== source) await this.replace();
  }

  flush(): Promise<void> {
    if (this.scheduled !== null) clearImmediate(this.scheduled);
    this.scheduled = null;
    const batch = this.pending.splice(0);

    if (batch.length === 0) return this.tail;

    return this.enqueue(async () => {
      let append = "";
      let replaced = false;

      for (const record of batch) {
        const line = `${JSON.stringify(record)}\n`;
        this.records.push(record);
        this.lines.push(line);
        this.bytes += Buffer.byteLength(line);
        append += line;
        replaced = this.trim() || replaced;
      }

      if (replaced) await this.replace();
      else {
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, append, { mode: 0o600 });
      }
    });
  }

  async metrics(): Promise<PredictionMetrics> {
    await this.flush();

    // Records finalize after the undo observation period, so arrival order need not be shown order.
    const records = [...this.records].sort(
      (a, b) => ("time" in a ? a.time : 0) - ("time" in b ? b.time : 0)
    );

    return predictionMetrics(records);
  }

  clear(): Promise<void> {
    void this.flush();

    return this.enqueue(async () => {
      this.records = [];
      this.lines = [];
      this.bytes = 0;
      await this.replace();
    });
  }

  close(): Promise<void> {
    this.closed = true;

    return this.flush();
  }
}
