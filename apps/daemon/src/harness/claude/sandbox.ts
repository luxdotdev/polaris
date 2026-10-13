/**
 * Whether Claude Code's sandbox can start on this Host, checked the way Claude
 * Code checks it: Seatbelt on macOS, bubblewrap and socat on the PATH on Linux.
 */
import { which } from "../../service/userPath.ts";

/** A tool Claude Code's Linux sandbox needs: its binary and the package that installs it. */
export interface SandboxTool {
  readonly binary: string;
  readonly pkg: string;
}

const LINUX_TOOLS: ReadonlyArray<SandboxTool> = [
  { binary: "bwrap", pkg: "bubblewrap" },
  { binary: "socat", pkg: "socat" },
];

/** `missing` is empty where Claude Code has no sandbox at all (native Windows). */
export type ClaudeSandbox =
  | { readonly available: true }
  | { readonly available: false; readonly missing: ReadonlyArray<SandboxTool> };

export interface SandboxHost {
  readonly platform: NodeJS.Platform;
  readonly find: (binary: string) => string | null;
}

const realHost = (): SandboxHost => ({ platform: process.platform, find: which });

export const probeClaudeSandbox = (host: SandboxHost = realHost()): ClaudeSandbox => {
  if (host.platform === "darwin") return { available: true };

  if (host.platform !== "linux") return { available: false, missing: [] };
  const missing = LINUX_TOOLS.filter((tool) => host.find(tool.binary) === null);

  return missing.length === 0 ? { available: true } : { available: false, missing };
};

const joinNames = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const installHint = (missing: ReadonlyArray<SandboxTool>) =>
  `apt install ${missing.map((tool) => tool.pkg).join(" ")}`;

/** The note on a Risk Summary whose Claude Code Reviewer ran without the sandbox. */
export const unsandboxedReviewerNote = (sandbox: ClaudeSandbox, host: string): string | null => {
  if (sandbox.available) return null;

  if (sandbox.missing.length === 0)
    return `The reviewer only read files: Claude Code has no sandbox on ${host}.`;
  const tools = joinNames(sandbox.missing.map((tool) => tool.pkg));

  return `The reviewer only read files: ${host} has no ${tools} for Claude Code's sandbox. Install ${
    sandbox.missing.length === 1 ? "it" : "them"
  } (${installHint(sandbox.missing)}) to let the reviewer run git and checks.`;
};

const SANDBOX_FAILURE = /Sandbox required but unavailable:?\s*(.*)/s;

/**
 * Claude Code's "Sandbox required but unavailable…" as a line a person can act
 * on, naming the Host and what to install; null for any other error.
 */
export const describeSandboxFailure = (
  error: string,
  context: { readonly host: string; readonly sandbox: ClaudeSandbox; readonly own: boolean }
): string | null => {
  const match = SANDBOX_FAILURE.exec(error);

  if (match === null) return null;
  const head = `Claude Code's sandbox can't start on ${context.host}`;
  const turnOff = context.own ? ", or turn the sandbox off in your Claude Code settings" : "";

  if (!context.sandbox.available && context.sandbox.missing.length > 0) {
    const tools = joinNames(context.sandbox.missing.map((tool) => tool.pkg));

    return `${head}: ${tools} ${context.sandbox.missing.length === 1 ? "isn't" : "aren't"} installed. Install ${
      context.sandbox.missing.length === 1 ? "it" : "them"
    } (${installHint(context.sandbox.missing)})${turnOff}.`;
  }

  const reason = (match[1] ?? "").split(/\s·\s|\.\s+Set sandbox\./)[0]?.trim() ?? "";

  return `${head}${reason === "" ? "" : `: ${reason}`}${turnOff === "" ? "." : `${turnOff}.`}`;
};
