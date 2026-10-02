import { Match, Schema } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const RuntimeSignal = Schema.TaggedUnion({
  demand: {},
  ready: {},
  empty: {},
  grace: {},
  crash: { retry: Schema.Boolean },
  retry: {},
  disconnect: {},
  revoke: {},
  restart: {},
  stop: {},
});

export const RuntimeStep = Schema.Struct({
  event: RuntimeSignal,
  phase: Schema.Literals([
    "stopped",
    "untrusted",
    "starting",
    "ready",
    "grace",
    "backoff",
    "failed",
  ]),
});

export const RuntimeTrace = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literal("runtime"),
  steps: Schema.Array(RuntimeStep).check(Schema.isMaxLength(10000)),
});

const expression = (event: typeof RuntimeSignal.Type) =>
  Match.value(event).pipe(
    Match.tag("crash", ({ retry }) => `Fail(${retry})`),
    Match.orElse(
      (value) =>
        ({
          demand: "Demand",
          ready: "Ready",
          empty: "Empty",
          grace: "Grace",
          retry: "Retry",
          disconnect: "Disconnect",
          revoke: "Revoke",
          restart: "Restart",
          stop: "Stop",
        })[value._tag]
    )
  );

/** Compare observations from the real broker's pure transitions with the executable Quint model. */
export async function replayRuntime(input: typeof RuntimeTrace.Type) {
  const trace = Schema.decodeUnknownSync(RuntimeTrace)(input);
  const root = resolve(import.meta.dir, "../..");
  const directory = await mkdtemp(join(tmpdir(), "m31-t1-replay-"));
  const path = join(directory, "runtime.qnt");
  const model = "./language-runtime";

  const steps = trace.steps
    .map(
      ({ event, phase }) =>
        `.then(publish(${expression(event)})).expect(phase == "${phase}" and safety)`
    )
    .join("\n");

  try {
    await writeFile(
      join(directory, "language-runtime.qnt"),
      await readFile(resolve(root, "language-runtime.qnt"))
    );
    await writeFile(
      path,
      `module runtime_replay {\nimport language_runtime.* from "${model}"\nrun runtimeTraceTest = init\n${steps}\n}\n`
    );

    const child = Bun.spawn(
      [resolve(root, "node_modules/.bin/quint"), "test", path, "--main=runtime_replay"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const output = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    const code = await child.exited;

    if (code !== 0) throw new Error(`Runtime replay rejected: ${output}${error}`);

    return { steps: trace.steps.length, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
