import { versionSatisfies } from "./selection";

const bounded = async <T>(promise: Promise<T>, milliseconds: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const readBounded = async (
  reader: {
    read(): Promise<{ done: true; value?: unknown } | { done?: false; value: Uint8Array }>;
  },
  stop: () => void
): Promise<string | null> => {
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) return output + decoder.decode();
      bytes += next.value.length;

      if (bytes > 4096) {
        stop();

        return null;
      }

      output += decoder.decode(next.value, { stream: true });
    }
  } catch {
    stop();

    return null;
  }
};

/** New-session descendants escape group signals; held pipes fail closed without awaiting their exit. */
export const probeShellCheckVersion = async (
  executable: string,
  cwd: string
): Promise<string | null> => {
  const child = Bun.spawn([executable, "--version"], {
    cwd,
    env: { LANG: "C", LC_ALL: "C" },
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let stopped = false;
  let cancellation: Promise<unknown> | undefined;

  const kill = () => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };

  const cancel = () => {
    cancellation ??= Promise.allSettled(readers.map((reader) => reader.cancel()));

    return cancellation;
  };

  const stop = () => {
    stopped = true;
    kill();
    void cancel();
  };

  const timer = setTimeout(stop, 2000);
  const streams = Promise.all(readers.map((reader) => readBounded(reader, stop)));

  let verified: string | null = null;
  let finalized = false;

  try {
    const code = await bounded(child.exited, 2000);
    kill();
    const output = await bounded(streams, 250);

    if (output === null) stop();

    if (stopped || code !== 0 || output === null) return null;
    const [stdout, stderr] = output;

    if (stdout == null || stderr == null || !/^ShellCheck\r?$/m.test(stdout)) return null;
    const version = /^version: (\d+\.\d+\.\d+)\r?$/m.exec(stdout)?.[1] ?? null;
    verified = version && versionSatisfies(version, ">=0.11.0") ? version : null;
  } finally {
    clearTimeout(timer);
    kill();
    finalized =
      (await bounded(Promise.allSettled([cancel(), streams, child.exited]), 250)) !== null;
  }

  return finalized ? verified : null;
};
