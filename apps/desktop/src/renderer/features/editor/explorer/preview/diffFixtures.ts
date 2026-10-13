/** Diff tabs on fixtures (`#explorer/diff…`): the files git shows at HEAD and in the index. */
import { RECONNECT, ROOT } from "./fixtures.ts";

export const DIFF_SCENES = [
  "diff",
  "diff-split",
  "diff-line",
  "diff-staged",
  "diff-python",
  "diff-binary",
  "diff-same",
] as const;

export type DiffScene = (typeof DIFF_SCENES)[number];

/** reconnect.ts in the index: an older retry loop, so the diff has every kind of change. */
const RECONNECT_INDEX = RECONNECT.replace(
  "Keep retrying on our own until the host answers or we give up.",
  "Keep retrying until the host answers."
)
  .replace("await dial(host.address, { timeoutMs: 4_000 });", "await dial(host.address);")
  .replace(
    `      if (isAuthPrompt(err)) return "needs-attention";
      log.debug(\`reconnect \${host.name} failed\`, { attempt });`,
    `      log.warn("reconnect failed", err);`
  )
  .replace("const BASE_DELAY_MS = 500;", "const BASE_DELAY_MS = 250;")
  .replace(
    `function sleep(ms: number): Promise<void> {\n  return new Promise((resolve) => setTimeout(resolve, ms));\n}\n`,
    ""
  );

const HOSTS_PY = `"""Hosts this checkout deploys to, and how to reach them."""

from dataclasses import dataclass


@dataclass
class Host:
    name: str
    address: str
    port: int = 22
    user: str = "lucas"


def connect(host: Host, timeout: float = 4.0, retries: int = 3) -> bool:
    # Try each address in turn until one answers or we run out of retries.
    for attempt in range(retries):
        if dial(host.address, host.port, timeout=timeout):
            return True
        log.info("retrying %s (attempt %d)", host.name, attempt)
    return False
`;

const HOSTS_PY_INDEX = HOSTS_PY.replace('    user: str = "lucas"\n', "")
  .replace("timeout: float = 4.0, retries: int = 3", "timeout: float = 4.0")
  .replace("until one answers or we run out of retries.", "until one answers.")
  .replace("for attempt in range(retries):", "for attempt in range(3):")
  .replace("host.address, host.port, timeout=timeout", "host.address, timeout=timeout");

const WORKING_STRIP = `export const WorkingStrip = ({ session }: { session: Session }) => (
  <div className="working-strip">{session.title}</div>
);
`;

export const DIFF_ENTRIES = [
  { path: "scripts/hosts.py", origPath: null, index: ".", worktree: "M" },
  { path: "design/logo.png", origPath: null, index: ".", worktree: "M" },
  { path: "daemon/src/log.ts", origPath: null, index: "M", worktree: "." },
];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const text = (value: string) => ({ kind: "text" as const, text: value });

/** `git.show` at `revision` ("" is the index) of `path`, relative to the top level. */
export const shown = (revision: string, path: string) => {
  if (path === "design/logo.png") return { kind: "bytes" as const, bytes: PNG };

  if (path === "daemon/src/hosts/reconnect.ts")
    return text(revision === "" ? RECONNECT_INDEX : RECONNECT);

  if (path === "scripts/hosts.py") return text(HOSTS_PY_INDEX);

  if (path === "desktop/src/orchestrator/working-strip.tsx") return text(WORKING_STRIP);

  return text(`// ${path.split("/").at(-1) ?? ""}\n`);
};

/** `files.read` of the working tree. */
export const worktree = (path: string) => {
  if (path.endsWith("hosts.py")) return text(HOSTS_PY);

  if (path.endsWith("logo.png")) return { kind: "bytes" as const, bytes: PNG.with(9, 1) };

  return path.endsWith("reconnect.ts")
    ? text(RECONNECT)
    : text(`// ${path.split("/").at(-1) ?? ""}\n`);
};

/** Which change each scene opens, and how the tab draws. */
export const DIFF_OPEN: Record<
  DiffScene,
  { path: string; side: "staged" | "unstaged"; style: "unified" | "split"; syntax: boolean }
> = {
  diff: { path: "daemon/src/hosts/reconnect.ts", side: "unstaged", style: "unified", syntax: true },
  "diff-split": {
    path: "daemon/src/hosts/reconnect.ts",
    side: "unstaged",
    style: "split",
    syntax: true,
  },
  "diff-line": {
    path: "daemon/src/hosts/reconnect.ts",
    side: "unstaged",
    style: "unified",
    syntax: false,
  },
  "diff-staged": {
    path: "desktop/src/orchestrator/working-strip.tsx",
    side: "staged",
    style: "unified",
    syntax: true,
  },
  "diff-python": { path: "scripts/hosts.py", side: "unstaged", style: "unified", syntax: true },
  "diff-binary": { path: "design/logo.png", side: "unstaged", style: "unified", syntax: true },
  "diff-same": { path: "CONTEXT.md", side: "unstaged", style: "unified", syntax: true },
};

export const diffPath = (scene: DiffScene) => `${ROOT}/${DIFF_OPEN[scene].path}`;
