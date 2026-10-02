import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Schema } from "effect";
import {
  LanguageError,
  LanguageDocumentNotification,
  LanguageSyncInput,
  LanguageFeatureRequest,
} from "../../../protocol/src/index.ts";
import { fixture } from "../../../../apps/daemon/src/languages/runtime/fixtures.testing.ts";
import { RuntimeTrace, RuntimeStep, RuntimeSignal, replayRuntime } from "./index.ts";
import {
  LanguageTrace,
  LanguageTraceEvent,
  LanguageTraceObservation,
} from "../language-replay/index.ts";

const tracePath = "/tmp/m31-t1-lifecycle.trace.json";

test("actual process lifecycle trace replays in Quint and rejects false observations", async () => {
  const steps: (typeof RuntimeTrace.Type)["steps"][number][] = [];

  const f = await fixture("ordinary", 5, ({ event, phase }) => {
    const signal = Schema.decodeUnknownSync(RuntimeSignal)({ ...event, _tag: event.type });

    const step = Schema.decodeUnknownSync(RuntimeStep)({
      event: signal,
      phase,
    });

    steps.push(step);
  });

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);
    await f.broker.release("one", context, "file");
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Close.make({ uri: f.uri, version: 1 }),
      })
    );

    for (let i = 0; i < 100 && f.broker.stats().contexts > 0; i++) await Bun.sleep(5);
    expect(f.broker.stats().contexts).toBe(0);
  } finally {
    await f.dispose();
  }

  const trace = RuntimeTrace.make({ version: 1, source: "runtime", steps });
  await writeFile(tracePath, JSON.stringify(trace, null, 2));
  expect((await replayRuntime(trace)).steps).toBeGreaterThan(2);

  const mutant = {
    ...trace,
    steps: trace.steps.map((step, index) =>
      index === 0 ? RuntimeStep.make({ ...step, phase: "ready" }) : step
    ),
  };

  const outcome = await replayRuntime(mutant).then(
    () => "accepted",
    () => "rejected"
  );

  expect(outcome).toBe("rejected");
}, 15000);

test("actual ordered acknowledgments/results/restart snapshots map to P1 language trace", async () => {
  const f = await fixture();
  const events: (typeof LanguageTrace.Type)["events"][number][] = [];

  try {
    const { context } = await f.acquire();
    const ack = await f.open("one", context, "runtime trace");
    await f.ready("one", context);
    const version = ack.documents[0]!.version;

    const observed = (generation: number, sequence: number, current: number, delivered = -1) =>
      LanguageTraceObservation.cases.Context.make({
        context: 0,
        generation,
        sequence,
        version: current,
        delivered,
      });

    events.push({
      event: LanguageTraceEvent.cases.Sync.make({
        context: 0,
        generation: 1,
        sequence: ack.acceptedSequence,
        previous: 0,
        version,
      }),
      observed: observed(1, ack.acceptedSequence, version),
    });

    const request = LanguageFeatureRequest.make({
      requestId: "trace",
      fence: { context, requiredSequence: ack.acceptedSequence, documents: ack.documents },
      method: "textDocument/hover",
      params: { textDocument: { uri: f.uri } },
      deadline: Date.now() + 1000,
    });

    events.push({
      event: LanguageTraceEvent.cases.Request.make({
        context: 0,
        generation: 1,
        sequence: ack.acceptedSequence,
        version,
      }),
      observed: observed(1, ack.acceptedSequence, version),
    });
    const result = await f.broker.request("one", request);
    const actual = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Int }))(result.result);
    events.push({
      event: LanguageTraceEvent.cases.Result.make({
        context: 0,
        generation: 1,
        version: actual.version,
      }),
      observed: observed(1, ack.acceptedSequence, version, actual.version),
    });

    const cancelled = f.broker
      .request(
        "one",
        LanguageFeatureRequest.make({
          ...request,
          requestId: "trace-cancel",
          params: { ...request.params, slow: true },
        })
      )
      .then(
        () => false,
        (error: LanguageError) => Schema.is(LanguageError)(error) && error.reason === "cancelled"
      );

    await Bun.sleep(10);
    events.push({
      event: LanguageTraceEvent.cases.Request.make({
        context: 0,
        generation: 1,
        sequence: ack.acceptedSequence,
        version,
      }),
      observed: observed(1, ack.acceptedSequence, version, actual.version),
    });
    f.broker.cancel("one", context, "trace-cancel");
    expect(await cancelled).toBe(true);
    events.push({
      event: LanguageTraceEvent.cases.Cancel.make({ context: 0 }),
      observed: observed(1, ack.acceptedSequence, version, actual.version),
    });
    const restarted = await f.broker.restart("one", context);
    expect(restarted.context.generation).toBeGreaterThan(context.generation);
    events.push({
      event: LanguageTraceEvent.cases.Restart.make({ context: 0 }),
      observed: observed(
        2,
        restarted.ack.acceptedSequence,
        restarted.ack.documents[0]?.version ?? 0
      ),
    });
    const trace = LanguageTrace.make({ version: 1, source: "runtime", events });
    const path = "/tmp/m31-t1-language.trace.json";
    await writeFile(path, JSON.stringify(trace, null, 2));

    const child = Bun.spawn(
      [process.execPath, resolve(import.meta.dir, "../replay-language.ts"), path],
      { stdout: "pipe", stderr: "pipe" }
    );

    await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(await child.exited).toBe(0);
  } finally {
    await f.dispose();
  }
}, 15000);
