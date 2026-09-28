import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Everything the Daemon writes lives under `~/.polaris/` (no sudo, ever).
 * `POLARIS_HOME` overrides the root for tests and side-by-side dev Daemons.
 */
export const polarisHome = (): string => process.env.POLARIS_HOME ?? join(homedir(), ".polaris");

export const paths = () => {
  const root = polarisHome();
  return {
    root,
    /** The Daemon's only listener: a Unix socket, reached remotely through `polaris bridge` over SSH. */
    socket: join(root, "daemon.sock"),
    lock: join(root, "daemon.lock"),
    database: join(root, "state.sqlite"),
    staging: join(root, "staging"),
    logs: join(root, "logs"),
    /** Installed Daemon builds, one directory per version; `current` is a symlink. */
    bin: join(root, "bin"),
  };
};
