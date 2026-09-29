/**
 * Test helpers: the fake agent as a Harness binary running one scenario, the
 * messages it received, and a session's events as they arrive.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema, Stream } from "effect";
import type { HarnessEvent, HarnessSession } from "../../HarnessDriver.ts";
import type { Scenario } from "./fakeAgent.ts";

const Received = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Unknown),
});

export type Received = typeof Received.Type;

const decodeReceived = Schema.decodeUnknownSync(Schema.fromJsonString(Received));

export interface FakeBinary {
  readonly dir: string;
  /** An executable that runs the fake agent on `scenario`. */
  readonly binary: string;
  /** Every JSON-RPC message the agent received, in order. */
  readonly received: () => ReadonlyArray<Received>;
  readonly methods: () => ReadonlyArray<string>;
  readonly remove: () => void;
}

export const fakeBinary = (scenario: Scenario): FakeBinary => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-acp-"));
  const scenarioPath = join(dir, "scenario.json");
  const log = join(dir, "received.jsonl");
  const binary = join(dir, "copilot");
  const agent = join(import.meta.dir, "fakeAgent.ts");

  writeFileSync(scenarioPath, JSON.stringify(scenario));
  writeFileSync(log, "");
  writeFileSync(
    binary,
    `#!/bin/sh\nFAKE_ACP_SCENARIO='${scenarioPath}' FAKE_ACP_LOG='${log}' exec '${process.execPath}' '${agent}' "$@"\n`
  );
  chmodSync(binary, 0o755);

  const received = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => decodeReceived(line));

  return {
    dir,
    binary,
    received,
    methods: () => received().flatMap((m) => (m.method === undefined ? [] : [m.method])),
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
};

export interface Collected {
  /** Every event so far. */
  readonly events: Array<HarnessEvent>;
  /** Resolves with the `count`th event with this tag, seen already or still to come. */
  readonly waitFor: (tag: HarnessEvent["_tag"], count?: number) => Promise<HarnessEvent>;
}

/** Drains a session's events into an array as they arrive. */
export const collect = (session: HarnessSession): Collected => {
  const events: Array<HarnessEvent> = [];
  const waiters: Array<() => void> = [];

  void Effect.runPromise(
    Stream.runForEach(session.events, (event) =>
      Effect.sync(() => {
        events.push(event);

        for (const wake of waiters.splice(0)) wake();
      })
    )
  );

  const waitFor = (tag: HarnessEvent["_tag"], count = 1): Promise<HarnessEvent> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no ${tag} in ${JSON.stringify(events.map((e) => e._tag))}`));
      }, 5_000);

      const check = () => {
        const found = events.filter((event) => event._tag === tag)[count - 1];

        if (found === undefined) return void waiters.push(check);
        clearTimeout(timer);
        resolve(found);
      };

      check();
    });

  return { events, waitFor };
};
