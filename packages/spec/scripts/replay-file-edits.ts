import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Schema } from "effect";

export const FileEditTrace = Schema.Struct({
  version: Schema.Literal(1),
  source: Schema.Literal("runtime"),
  events: Schema.Array(
    Schema.Struct({
      event: Schema.Literals([
        "Prepare",
        "Intent",
        "Move",
        "PersistApplied",
        "UndoIntent",
        "Restore",
        "PersistRestored",
        "ExternalSource",
        "ExternalTarget",
        "Crash",
        "Retry",
        "Ack",
      ]),
      phase: Schema.Literals(["Pending", "Forward", "Applied", "Backward", "Restored"]),
      source: Schema.Literals(["Missing", "Owned", "External"]),
      target: Schema.Literals(["Missing", "Owned", "External"]),
    })
  ).check(Schema.isMaxLength(10000)),
});

export const replayFileEditTrace = async (input: typeof FileEditTrace.Type) => {
  const trace = Schema.decodeUnknownSync(FileEditTrace)(input);
  const directory = await mkdtemp(join(tmpdir(), "polaris-file-trace-"));
  const spec = "./file-edits";

  const module = [
    "module recorded_file_edits {",
    `import file_edits.* from ${JSON.stringify(spec)}`,
    "run recordedTest = init.expect(safety)",
    ...trace.events.map(
      (entry) =>
        `.then(publish(${entry.event})).expect(safety and phase == ${entry.phase} and source == ${entry.source} and target == ${entry.target})`
    ),
    "}",
  ].join("\n");

  try {
    const path = join(directory, "trace.qnt");
    await writeFile(
      join(directory, "file-edits.qnt"),
      await readFile(resolve(import.meta.dir, "../file-edits.qnt"))
    );
    await writeFile(path, module);

    const child = Bun.spawn(
      [
        resolve(import.meta.dir, "../node_modules/.bin/quint"),
        "test",
        path,
        "--main=recorded_file_edits",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    return { exitCode, output: stdout + stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const path = process.argv[2];

  if (!path)
    throw new Error("usage: bun packages/spec/scripts/replay-file-edits.ts <runtime-trace.json>");
  const trace = Schema.decodeUnknownSync(FileEditTrace)(JSON.parse(await readFile(path, "utf8")));
  const result = await replayFileEditTrace(trace);
  console.log(result.output);
  process.exitCode = result.exitCode;
}
