import { childEnv } from "../../service/childEnv.ts";

/** A fake Harness at the process boundary; the real CLI inherits its kernel ancestry. */
await Bun.stdin.text();

const child = Bun.spawn(
  [
    process.execPath,
    new URL("../../main.ts", import.meta.url).pathname,
    "session",
    "start",
    "--json",
  ],
  {
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
    env: childEnv({ ...process.env, POLARIS_HOST_SOCKET: process.argv[2]! }),
  }
);

await child.stdin.write("Start from stdin in my Workspace");

await child.stdin.end();

process.exit(await child.exited);
