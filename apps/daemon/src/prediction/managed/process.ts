/**
 * The Host-side pieces the managed server needs (ADR 0048): spawning llama-server,
 * a free loopback port, its health check, resident memory and the build's extraction.
 */
import { createServer } from "node:net";
import { join } from "node:path";
import { Predicate } from "effect";
import { LLAMA_BUILD } from "./catalog.ts";

export interface ManagedProcess {
  readonly pid: number;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number | null>;
  readonly kill: () => void;
}

export type Spawn = (command: string, args: ReadonlyArray<string>, cwd: string) => ManagedProcess;

/** The discovery ports stay free for a user's own server. */
const RESERVED = new Set([8080, 1234, 11434]);

export const pickPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      // A TCP listener's address is always the object form; the string form is for pipes.
      const port = address === null || Predicate.isString(address) ? 0 : address.port;
      server.close(() =>
        RESERVED.has(port) || port === 0 ? pickPort().then(resolve, reject) : resolve(port)
      );
    });
  });

export const spawnServer: Spawn = (command, args, cwd) => {
  const child = Bun.spawn([command, ...args], {
    cwd,
    env: {
      ...process.env,
      DYLD_LIBRARY_PATH: cwd,
      LD_LIBRARY_PATH: cwd,
      POLARIS_HANDOFF: undefined,
      POLARIS_HOST_SOCKET: undefined,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  return {
    pid: child.pid,
    stderr: child.stderr,
    exited: child.exited.then((code) => code),
    kill: () => {
      try {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2000).unref();
      } catch {
        /* already gone */
      }
    },
  };
};

/** llama-server answers 200 once the model is loaded and 503 while it loads. */
export const healthy = async (url: string, signal: AbortSignal): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      redirect: "error",
    });

    return response.status === 200;
  } catch {
    return false;
  }
};

export const residentBytes = async (pid: number): Promise<number | null> => {
  try {
    const child = Bun.spawn(["ps", "-o", "rss=", "-p", String(pid)], { stdout: "pipe" });
    const text = (await new Response(child.stdout).text()).trim();
    await child.exited;
    const kib = Number(text);

    return Number.isFinite(kib) && kib > 0 ? kib * 1024 : null;
  } catch {
    return null;
  }
};

export const buildDir = (dir: string) => join(dir, `llama-${LLAMA_BUILD}`);

export const serverBinary = (dir: string) => join(buildDir(dir), "llama-server");

/** The Host's own tar; the archive was hashed against its pin before this runs. */
export const extractBuild = async (archive: string, dir: string): Promise<void> => {
  const child = Bun.spawn(["tar", "-xzf", archive, "-C", dir], {
    stderr: "pipe",
    stdout: "ignore",
  });

  const stderr = await new Response(child.stderr).text();
  const code = await child.exited;

  if (code !== 0) throw new Error(stderr.trim() || `tar exited with ${code}`);
};
