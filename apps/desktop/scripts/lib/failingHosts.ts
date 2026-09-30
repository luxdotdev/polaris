/**
 * Hosts that fail the way real ones do, for screenshots of the needs-attention
 * cards: a stand-in `ssh` answers three made-up aliases with the stderr and exit
 * code ssh or the bridge would give, and hands every other alias to `next`.
 * Nothing touches a real key or known_hosts.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface FailingHost {
  readonly alias: string;
  readonly label: string;
  readonly reason: string;
  readonly stderr: ReadonlyArray<string>;
  readonly code: number;
}

export const FAILING_HOSTS: ReadonlyArray<FailingHost> = [
  {
    alias: "fail-key-changed",
    label: "Build box",
    reason: "host-key-changed",
    stderr: [
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
      "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @",
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@",
      "Host key for build.internal has changed and you have requested strict checking.",
      "Host key verification failed.",
    ],
    code: 255,
  },
  {
    alias: "fail-auth",
    label: "Work VM",
    reason: "auth-failed",
    stderr: ["ubuntu@10.0.4.12: Permission denied (publickey)."],
    code: 255,
  },
  {
    alias: "fail-no-daemon",
    label: "Old laptop",
    reason: "daemon-not-running",
    stderr: ["polaris: no Daemon is running; start it with `polaris install`"],
    // BRIDGE_EXIT_NO_DAEMON in @polaris/protocol's bridge.ts.
    code: 69,
  },
];

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** Writes the stand-in into `<dir>/ssh`; put `dir` first on PATH. */
export const writeFailingSsh = (dir: string, next: string) => {
  mkdirSync(dir, { recursive: true });

  const cases = FAILING_HOSTS.map(
    (h) => `    ${h.alias}) printf '%s\\n' ${h.stderr.map(quote).join(" ")} >&2; exit ${h.code} ;;`
  ).join("\n");

  writeFileSync(
    join(dir, "ssh"),
    `#!/bin/sh\nfor arg in "$@"; do\n  case "$arg" in\n${cases}\n  esac\ndone\nexec ${quote(next)} "$@"\n`
  );
  chmodSync(join(dir, "ssh"), 0o755);
};
