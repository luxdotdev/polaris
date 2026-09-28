/**
 * A fake `codex` executable for app-server lifecycle tests.
 *
 * `makeFakeCodex(dir)` writes `<dir>/codex`, a shell script that:
 * - `codex --version` prints `codex-cli <contents of <dir>/version>`;
 * - `codex app-server --listen unix://<path>` runs this file with Bun, which
 *   serves a `FakeAppServer` on that socket answering `initialize` and
 *   `thread/loaded/list` (thread ids from `<dir>/loaded`, one per line).
 *
 * Not used at runtime.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeAppServer } from "./FakeAppServer.ts";

export interface FakeCodex {
  readonly path: string;
  readonly setVersion: (version: string) => void;
  readonly setLoaded: (threadIds: ReadonlyArray<string>) => void;
}

export const makeFakeCodex = (dir: string, version = "1.0.0"): FakeCodex => {
  const path = join(dir, "codex");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then printf 'codex-cli %s\\n' "$(cat '${join(dir, "version")}')"; exit 0; fi`,
      `exec '${process.execPath}' '${import.meta.path}' '${dir}' "$@"`,
      "",
    ].join("\n")
  );
  chmodSync(path, 0o755);
  const setVersion = (v: string) => writeFileSync(join(dir, "version"), v);
  const setLoaded = (ids: ReadonlyArray<string>) =>
    writeFileSync(join(dir, "loaded"), ids.join("\n"));
  setVersion(version);
  setLoaded([]);
  return { path, setVersion, setLoaded };
};

if (import.meta.main) {
  const [dir = ".", command, flag, listen] = process.argv.slice(2);
  if (command !== "app-server" || flag !== "--listen" || !listen?.startsWith("unix://")) {
    console.error(`fake codex: unsupported arguments ${process.argv.slice(3).join(" ")}`);
    process.exit(2);
  }
  const loaded = () => {
    const file = join(dir, "loaded");
    return existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line !== "")
      : [];
  };
  startFakeAppServer(listen.slice("unix://".length), (request, conn) => {
    if (request.method === "initialize") return conn.reply({ userAgent: "fake" });
    if (request.method === "thread/loaded/list")
      return conn.reply({ data: loaded(), nextCursor: null });
    conn.replyError(-32601, `fake codex: ${request.method} not supported`);
  });
  console.error(`fake codex app-server ${readFileSync(join(dir, "version"), "utf8")} on ${listen}`);
}
