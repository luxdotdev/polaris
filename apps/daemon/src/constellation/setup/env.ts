import { isWindowsBaseKey } from "../../service/childEnv.ts";

/** What a package manager needs to find tools, caches and the network; no tokens or agent sockets. */
const ALLOWED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "TERM",
  "TZ",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "BUN_INSTALL",
  "PNPM_HOME",
  "VOLTA_HOME",
  "NVM_DIR",
  "ASDF_DIR",
  "ASDF_DATA_DIR",
  "PYENV_ROOT",
  "CARGO_HOME",
  "RUSTUP_HOME",
]);

const ALLOWED_PREFIXES = ["LC_", "XDG_"];

/** The environment a worktree setup child gets: an allowlist of the Daemon's, nothing else. */
export const setupEnv = (source: Readonly<Record<string, string | undefined>> = process.env) =>
  Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        (ALLOWED.has(entry[0]) ||
          isWindowsBaseKey(entry[0]) ||
          ALLOWED_PREFIXES.some((prefix) => entry[0].startsWith(prefix)))
    )
  );
