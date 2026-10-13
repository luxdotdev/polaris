/** Where the Rust and Lua smoke's Daemon and fixture live: this Mac, or a Host over SSH. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { startDaemon } from "./daemon.ts";
import { REPO_ROOT } from "./electron.ts";

export interface SmokeHost {
  readonly label: string;
  readonly project: string;
  readonly put: (path: string, text: string, mode?: number) => void;
  readonly read: (path: string) => string;
  readonly exists: (path: string) => boolean;
  /** `ps` lines (`pid rss command`) of the processes started under this smoke's directory. */
  readonly processes: () => string[];
  readonly start: () => Promise<{
    readonly socketPath: string;
    readonly stop: () => Promise<void>;
  }>;
  readonly cleanup: () => void;
}

export const localHost = (home: string): SmokeHost => {
  const project = join(home, "project");

  return {
    label: "this Mac",
    project,
    put: (path, text, mode = 0o644) => {
      mkdirSync(dirname(join(project, path)), { recursive: true });
      writeFileSync(join(project, path), text, { mode });
    },
    read: (path) => readFileSync(join(project, path), "utf8"),
    exists: (path) => existsSync(join(project, path)),
    processes: () =>
      execFileSync("ps", ["-axo", "pid=,rss=,command="], { encoding: "utf8" })
        .split("\n")
        .filter((line) => line.includes(home)),
    start: async () => {
      const daemon = await startDaemon({
        home,
        benchHarness: true,
        env: { RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup") },
      });

      return { socketPath: daemon.socketPath, stop: () => daemon.stop() };
    },
    cleanup: () => undefined,
  };
};

const SSH = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "UpdateHostKeys=no"];

/**
 * A private directory on the Host holds the Daemon's home, the fixture and a temporary rustup
 * (never `~/.rustup` or the shell profile); cleanup removes all of it.
 */
export const remoteHost = (alias: string, local: string, arch: string): SmokeHost => {
  const ssh = (command: string, input?: string | Buffer) =>
    execFileSync("ssh", [...SSH, alias, command], {
      encoding: "utf8",
      input,
      timeout: 600000,
      maxBuffer: 64 * 1024 * 1024,
    });

  const root =
    process.env.POLARIS_SMOKE_REMOTE_ROOT ?? ssh("mktemp -d $HOME/.polaris-s8a-XXXXXX").trim();

  const project = `${root}/project`;
  const environment = `HOME=${root}/home POLARIS_HOME=${root}/home RUSTUP_HOME=${root}/rustup CARGO_HOME=${root}/cargo`;
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

  return {
    label: alias,
    project,
    put: (path, text, mode = 0o644) =>
      void ssh(
        `mkdir -p ${quote(dirname(`${project}/${path}`))} && cat > ${quote(`${project}/${path}`)} && chmod ${mode.toString(8)} ${quote(`${project}/${path}`)}`,
        text
      ),
    read: (path) => ssh(`cat ${quote(`${project}/${path}`)}`),
    exists: (path) =>
      ssh(`test -e ${quote(`${project}/${path}`)} && echo yes || true`).trim() === "yes",
    processes: () =>
      ssh("ps -eo pid=,rss=,args=")
        .split("\n")
        .filter((line) => line.includes(root)),
    start: async () => {
      ssh(
        `mkdir -p ${root}/home && cat > ${root}/polaris && chmod 755 ${root}/polaris`,
        readFileSync(join(REPO_ROOT, `apps/daemon/dist/${arch}/polaris`))
      );
      console.log("Installing a temporary Rust toolchain under", root);
      ssh(
        `test -d ${root}/rustup/toolchains || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | env ${environment} sh -s -- -y --no-modify-path --profile minimal --component rust-src,rustfmt >/dev/null 2>&1`
      );
      ssh(
        `cd ${root} && (setsid nohup env ${environment} ${root}/polaris serve --foreground > ${root}/daemon.log 2>&1 < /dev/null &)`
      );
      ssh(
        `for i in $(seq 1 150); do test -S ${root}/home/daemon.sock && exit 0; sleep 0.1; done; cat ${root}/daemon.log; exit 1`
      );

      const socketPath = join(local, "remote.sock");

      const tunnel = spawn("ssh", [
        ...SSH,
        "-N",
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "StreamLocalBindUnlink=yes",
        "-L",
        `${socketPath}:${root}/home/daemon.sock`,
        alias,
      ]);

      for (let i = 0; i < 100 && !existsSync(socketPath); i++)
        await new Promise((resolve) => setTimeout(resolve, 100));

      return {
        socketPath,
        stop: async () => {
          tunnel.kill();
          ssh(`pkill -f '${root}/[p]olaris' || true`);
        },
      };
    },
    cleanup: () => void ssh(`pkill -f '${root}[/]' ; rm -rf ${root}`),
  };
};
