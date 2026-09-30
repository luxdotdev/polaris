/**
 * How this Host runs each catalogue Harness that speaks ACP. The catalogue
 * entry (name, `minVersion`, setup copy) lives in `@polaris/protocol`; this is
 * the Daemon's side: the binary, its ACP argv, and what its probe may touch.
 * Plain data, so the availability probe and the registry can read it without
 * loading the driver.
 */
import { join } from "node:path";
import type { PermissionMode } from "@polaris/protocol";

export type AcpKind = "gemini" | "copilot";

export interface AcpHarness {
  readonly kind: AcpKind;
  /** The binary on PATH. */
  readonly binary: string;
  /** Overrides the binary (launchd / systemd PATHs often lack nvm or Homebrew). */
  readonly binaryEnv: string;
  /** Arguments that start the Harness as an ACP agent on stdio. */
  readonly acpArgs: ReadonlyArray<string>;
  /**
   * The Harness's own config directory, from the user's home or its override
   * variable. A Host where it doesn't exist has never run the Harness.
   */
  readonly configDir: (env: Readonly<Record<string, string | undefined>>, home: string) => string;
  /**
   * A variable pointing the Harness's state somewhere else. `--version` runs with
   * it set to an empty scratch directory, so probing writes nothing to the user's.
   */
  readonly scratchHomeEnv: string | null;
  /** argv after the binary that reopens a session in the Harness's own TUI; null when it can't. */
  readonly resumeArgs: ((cursor: string) => ReadonlyArray<string>) | null;
}

export const GEMINI: AcpHarness = {
  kind: "gemini",
  binary: "gemini",
  binaryEnv: "POLARIS_GEMINI",
  acpArgs: ["--acp"],
  configDir: (env, home) => join(env.GEMINI_CLI_HOME || home, ".gemini"),
  // `gemini --version` writes `~/.gemini/projects.json` temp files.
  scratchHomeEnv: "GEMINI_CLI_HOME",
  // `--resume` takes "latest" or a list index, not a session id.
  resumeArgs: null,
};

export const COPILOT: AcpHarness = {
  kind: "copilot",
  binary: "copilot",
  binaryEnv: "POLARIS_COPILOT",
  acpArgs: ["--acp"],
  configDir: (env, home) => env.COPILOT_HOME || join(home, ".copilot"),
  scratchHomeEnv: null,
  resumeArgs: (cursor) => [`--resume=${cursor}`],
};

export const ACP_HARNESSES: ReadonlyArray<AcpHarness> = [GEMINI, COPILOT];

/**
 * Session mode ids Harnesses use for each permission mode, most specific first.
 * The first one a session offers is selected; with none, Polaris only answers
 * the Harness's permission requests by the mode (see `permissions.ts`).
 */
export const MODE_IDS: Record<PermissionMode, ReadonlyArray<string>> = {
  supervised: ["default", "ask", "read-only"],
  "auto-edits": ["auto_edit", "autoEdit", "acceptEdits", "accept-edits", "workspace-write"],
  auto: ["auto", "agent", "autopilot"],
  "full-access": ["yolo", "bypassPermissions", "agent-full-access", "allow-all"],
};
