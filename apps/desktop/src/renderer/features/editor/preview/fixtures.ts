/** The files of Paper E1–E3, on a Mac Studio Workspace "polaris" at ~/code/polaris. */

export const HOST = "studio";

export const WORKSPACE = "ws-polaris";

export const ROOT = "/Users/lucas/code/polaris";

export const path = (relative: string) => `${ROOT}/${relative}`;

export const RECONNECT = `import { type Host, type ConnectionState } from "../context";
import { dial, DialError } from "./transport";
import { log } from "../log";

const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 500;

/** Keep retrying on our own until the host answers or we give up. */
export async function reconnect(host: Host): Promise<ConnectionState> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await dial(host.address, { timeoutMs: 4_000 });
      return "connected";
    } catch (err) {
      if (isAuthPrompt(err)) return "needs-attention";
      log.debug(\`reconnect \${host.name} failed\`, { attempt });
      await sleep(BASE_DELAY_MS * attempt);
    }
  }
  return "offline";
}

function isAuthPrompt(err: unknown): boolean {
  return err instanceof DialError && err.code === "AUTH_REQUIRED";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
`;

export const TRANSPORT = `import { connect, type Socket } from "node:net";

export class DialError extends Error {
  constructor(readonly code: "AUTH_REQUIRED" | "REFUSED" | "TIMEOUT") {
    super(code);
  }
}

export interface DialOptions {
  readonly timeoutMs: number;
}

export function dial(address: string, { timeoutMs }: DialOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    const timer = setTimeout(() => reject(new DialError("TIMEOUT")), timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", () => reject(new DialError("REFUSED")));
  });
}
`;

export const SESSION_ROW = `import { type AgentSession } from "../context";
import { HarnessTile } from "./harness-tile";
import { formatAge } from "../time";

type Props = { session: AgentSession; selected: boolean };

/** One agent session in the sidebar: who, what it is doing, and how long ago. */
export function SessionRow({ session, selected }: Props) {
  const needsYou = session.state === "needs-you";
  return (
    <li className={selected ? "row row-selected" : "row"}>
      <HarnessTile harness={session.harness} state={session.state} />
      <div className="row-text">
        <span className="row-title">{session.title}</span>
        <span className={needsYou ? "row-doing needs-you" : "row-doing"}>
          {session.doing}
        </span>
      </div>
      <time className="row-age">{formatAge(session.updatedAt)}</time>
    </li>
  );
}
`;

export const CONTEXT_MD = `# Polaris glossary

## Host

A machine that runs a **Daemon**: this Mac, a Mac Studio, a Linux VM, a Raspberry Pi.

## Workspace

A folder on a Host that Polaris knows about. Agent sessions run in a Workspace.

- Hidden when idle
- Shown again when something happens in it
`;

export const PYPROJECT = `[project]
name = "sightline"
version = "0.4.1"
dependencies = ["httpx>=0.27", "rich"]

[tool.ruff]
line-length = 100
`;

export const MAIN_PY = `import asyncio
from dataclasses import dataclass


@dataclass
class Probe:
    host: str
    port: int = 22

    async def ping(self) -> bool:
        reader, writer = await asyncio.open_connection(self.host, self.port)
        writer.close()
        return True
`;

/** A ~1 MB TypeScript file for the open-time and typing budgets. */
export const bigFile = (bytes = 1_000_000) => {
  const block = RECONNECT;
  const copies = Math.ceil(bytes / block.length);

  return Array.from({ length: copies }, (_, i) =>
    block.replaceAll("reconnect", `reconnect${i}`)
  ).join("\n");
};

export const FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries({
    [path("daemon/src/hosts/reconnect.ts")]: RECONNECT,
    [path("daemon/src/hosts/transport.ts")]: TRANSPORT,
    [path("desktop/src/orchestrator/session-row.tsx")]: SESSION_ROW,
    [path("CONTEXT.md")]: CONTEXT_MD,
    [path("tools/pyproject.toml")]: PYPROJECT,
    [path("tools/probe.py")]: MAIN_PY,
    [path("design/assets/logo.png")]: "\u0089PNG\u0000\u0000",
    [path("bench/big.ts")]: bigFile(),
  })
);
