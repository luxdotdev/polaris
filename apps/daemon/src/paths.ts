import { homedir } from "node:os";
import { join } from "node:path";
import { localEndpoint } from "@polaris/protocol/endpoint";

/**
 * Everything the Daemon writes lives under `~/.polaris/` (no sudo, ever); on Windows
 * that is `%USERPROFILE%\.polaris`, private through the profile's ACL.
 * `POLARIS_HOME` overrides the root for tests and side-by-side dev Daemons.
 */
export const polarisHome = (): string => process.env.POLARIS_HOME ?? join(homedir(), ".polaris");

export const paths = () => {
  const root = polarisHome();

  return {
    root,
    /**
     * The Daemon's only listener, reached remotely through `polaris bridge` over SSH:
     * a Unix socket, or on Windows a named pipe named after the root (ADR 0059).
     */
    socket: localEndpoint(root),
    lock: join(root, "daemon.lock"),
    database: join(root, "state.sqlite"),
    staging: join(root, "staging"),
    logs: join(root, "logs"),
    /** The Reviewer's generated git common dirs: a fresh one per session, only Polaris writes them. */
    confinedGit: join(root, "confined-git"),
    /** Installed Daemon builds, one directory per version; `current` is a symlink. */
    bin: join(root, "bin"),
  };
};
