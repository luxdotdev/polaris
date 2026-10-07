import { Schema } from "effect";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const Phase = Schema.Literals(["NotDownloaded", "Downloading", "Installed", "Failed"]);

export const HostStateStep = Schema.TaggedUnion({
  Subscribe: {},
  Close: {},
  SetState: { tool: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1 })), phase: Phase },
  Consume: { phases: Schema.Array(Phase).check(Schema.isMinLength(2), Schema.isMaxLength(2)) },
});

export const HostStateTrace = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literal("host-installer-feed"),
  steps: Schema.Array(HostStateStep).check(Schema.isMaxLength(10000)),
});

/** Replay recorded installer/feed observations against the same Quint projection checked by CI. */
export async function replayHostState(input: typeof HostStateTrace.Type) {
  const trace = Schema.decodeUnknownSync(HostStateTrace)(input);
  const root = resolve(import.meta.dir, "../..");
  const directory = await mkdtemp(join(tmpdir(), "host-state-replay-"));

  const steps = trace.steps
    .map((step) =>
      HostStateStep.match(step, {
        Subscribe: () => ".then(publish(0, Subscribe)).expect(safety)",
        Close: () => ".then(publish(0, Close)).expect(safety)",
        SetState: ({ tool, phase }) =>
          `.then(publish(0, SetState({ tool: ${tool}, phase: ${phase} }))).expect(safety)`,
        Consume: ({ phases }) =>
          `.expect(hosts.get(0).pending == [Map(0 -> ${phases[0]}, 1 -> ${phases[1]})]).then(publish(0, Consume)).expect(safety)`,
      })
    )
    .join("\n");

  try {
    await writeFile(
      join(directory, "language-host-state.qnt"),
      await readFile(join(root, "language-host-state.qnt"))
    );
    const path = join(directory, "replay.qnt");

    await writeFile(
      path,
      `module host_replay {\nimport language_host_state.* from "./language-host-state"\nrun recordedHostFeedTest = init\n${steps}\n}\n`
    );

    const child = Bun.spawn(
      [join(root, "node_modules/.bin/quint"), "test", path, "--main=host_replay"],
      { stdout: "pipe", stderr: "pipe" }
    );

    const [output, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (code !== 0) throw new Error(`Host state replay rejected: ${output}${error}`);

    return { steps: trace.steps.length, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
