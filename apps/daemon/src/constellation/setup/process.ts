import { Effect } from "effect";
import { WorktreeSetupRun } from "@polaris/protocol";

const MAX_OUTPUT = 256 * 1024;

/** Keep draining both pipes even after the retained transcript tail reaches its limit. */
const output = async (pipe: ReadableStream<Uint8Array>) => {
  const reader = pipe.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const next = await reader.read();

    if (next.done) break;
    text = (text + decoder.decode(next.value, { stream: true })).slice(-MAX_OUTPUT);
  }

  return text + decoder.decode();
};

export const executeSetup = Effect.fn("WorktreeSetup.execute")(function* (run: WorktreeSetupRun) {
  const proc = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn(["/bin/sh", "-c", run.command], {
          cwd: run.cwd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        }),
      catch: (error) => new Error(String(error)),
    }),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode !== null) return;

        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }

        await child.exited;
      })
  );

  const [stdout, stderr, code] = yield* Effect.promise(() =>
    Promise.all([output(proc.stdout), output(proc.stderr), proc.exited])
  );

  return new WorktreeSetupRun({
    id: run.id,
    constellationId: run.constellationId,
    taskId: run.taskId,
    command: run.command,
    cwd: run.cwd,
    startedAt: run.startedAt,
    output: (stdout + stderr).slice(-MAX_OUTPUT),
    exitCode: code,
    status: code === 0 ? "completed" : "failed",
    endedAt: new Date().toISOString(),
  });
});
