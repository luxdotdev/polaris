import type { ProcessPort } from "../transport/index.ts";
import { failure } from "../transport/framing.ts";

export interface Launch {
  executable: string;
  args: readonly string[];
  cwd: string;
  environment: Record<string, string>;
}

/** Private launch values never enter logs or public launch facts. No shell interpolation. */
export function spawnLanguageProcess(launch: Launch): ProcessPort {
  if (!launch.executable.startsWith("/"))
    throw failure("missing-prerequisite", "Expected resolved Host executable");

  const child = Bun.spawn([launch.executable, ...launch.args], {
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...launch.environment,
      POLARIS_HANDOFF: undefined,
      POLARIS_HOST_SOCKET: undefined,
      POLARIS_SESSION_ID: undefined,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: process.platform !== "win32",
  });

  let stopping: Promise<void> | undefined;

  function signal(value: NodeJS.Signals) {
    try {
      if (process.platform === "win32") child.kill(value);
      else process.kill(-child.pid, value);
    } catch {
      /* The owned process group has already exited. */
    }
  }

  async function stop(graceful: boolean) {
    if (graceful) {
      let wake: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        child.exited,
        new Promise<void>((resolve) => {
          wake = setTimeout(resolve, 200);
        }),
      ]);

      if (wake !== undefined) clearTimeout(wake);
    }

    signal("SIGTERM");
    const timer = setTimeout(() => signal("SIGKILL"), 500);

    try {
      await child.exited;
    } finally {
      clearTimeout(timer);
      // The server may leave descendants after its own exit.
      signal("SIGKILL");
      await child.stdin.end();
    }
  }

  return {
    pid: child.pid,
    stdout: child.stdout,
    stderr: child.stderr,
    exited: child.exited,
    write: async (bytes) => {
      await child.stdin.write(bytes);
      await child.stdin.flush();
    },
    stop: (graceful = false) => (stopping ??= stop(graceful)),
  };
}
