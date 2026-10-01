import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { rmdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/** Scripts use their Host's resource under Polaris, or the shared local lock. */
export const takeScriptLease = async (name: "bench" | "smoke"): Promise<void> => {
  if (process.env.POLARIS_LEASE_HELD === name) return;

  if (process.env.POLARIS_HOST_SOCKET !== undefined) {
    const source = fileURLToPath(new URL("../apps/daemon/src/main.ts", import.meta.url));

    const cli =
      process.env.POLARIS_BINARY === undefined ? ["bun", source] : [process.env.POLARIS_BINARY];

    const child = spawn(
      cli[0]!,
      [...cli.slice(1), "lease", name, "--", process.execPath, ...process.argv.slice(1)],
      { stdio: "inherit" }
    );

    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    process.on("SIGINT", () => forward("SIGINT"));
    process.on("SIGTERM", () => forward("SIGTERM"));
    process.exit(
      await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
        child.on("error", () => resolve(127));
      })
    );
  }

  const path = `/tmp/polaris-${name}-lock`;

  while (true) {
    try {
      await mkdir(path);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      await setTimeout(500);
    }
  }

  let held = true;

  const release = () => {
    if (!held) return;
    held = false;

    try {
      rmdirSync(path);
    } catch {}
  };

  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(143);
  });
};
