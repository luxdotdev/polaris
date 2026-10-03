import { isAbsolute } from "node:path";
import { Schema } from "effect";
import type { VersionCommand, VersionOutput } from "./probes.ts";
import { abortable, checkAbort, failure } from "../install/validation.ts";

type ProbeReader = {
  read: () => Promise<
    { done: false; value: Uint8Array } | { done: true; value?: Uint8Array | undefined }
  >;
  cancel: () => Promise<void>;
};

async function output(reader: ProbeReader, signal: AbortSignal) {
  const parts: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const next = await abortable(reader.read(), signal);

    if (next.done) break;
    size += next.value.length;

    if (size > 4096 || parts.length >= 256)
      throw failure("too-large", "Runtime version output exceeds limit");
    parts.push(next.value);
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, size));
}

async function cleanupGroup(
  pid: number,
  exited: Promise<number>,
  readers: ReadonlyArray<ProbeReader>
) {
  const cleanup = new AbortController();
  const deadline = setTimeout(() => cleanup.abort(), 500);

  try {
    await abortable(
      Promise.all([exited, ...readers.map((reader) => reader.cancel().catch(() => {}))]),
      cleanup.signal
    );

    while (true) {
      try {
        process.kill(-pid, 0);
      } catch (cause) {
        if (Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }))(cause)) return;
        throw failure(
          "recovery-required",
          "Runtime probe process group cleanup could not be verified",
          true
        );
      }

      await abortable(new Promise<void>((resolve) => setTimeout(resolve, 10)), cleanup.signal);
    }
  } catch {
    throw failure(
      "recovery-required",
      "Runtime probe process group cleanup could not be verified",
      true
    );
  } finally {
    clearTimeout(deadline);
  }
}

/** POSIX only. No shell, inherited secrets, stdin, package scripts or toolchain installation. */
export async function runHostVersion(
  command: VersionCommand,
  signal: AbortSignal
): Promise<VersionOutput> {
  checkAbort(signal);

  if (
    process.platform === "win32" ||
    !isAbsolute(command.executable) ||
    !isAbsolute(command.cwd) ||
    command.argv.length > 16 ||
    command.argv.some((arg) => arg.length > 4096 || arg.includes("\0"))
  )
    throw failure("invalid-input", "Invalid Host version probe command");

  const child = Bun.spawn([command.executable, ...command.argv], {
    cwd: command.cwd,
    env: { LANG: "C", LC_ALL: "C" },
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  const controller = new AbortController();

  const kill = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };

  const abort = () => {
    controller.abort(signal.reason);
    kill();
  };

  signal.addEventListener("abort", abort, { once: true });

  if (signal.aborted) abort();

  const timer = setTimeout(() => {
    controller.abort(failure("timeout", "Runtime version probe timed out", true));
    kill();
  }, 1500);

  try {
    const [stdout, stderr, exitCode] = await abortable(
      Promise.all([
        output(readers[0]!, controller.signal),
        output(readers[1]!, controller.signal),
        child.exited,
      ]),
      controller.signal
    );

    checkAbort(signal);

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
    kill();
    await cleanupGroup(child.pid, child.exited, readers);
  }
}
