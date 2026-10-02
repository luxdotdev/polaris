import { access, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { probeShellCheckVersion } from "./shellcheck-probe";

export interface ShellCheckInput {
  readonly trusted: boolean;
  readonly configuredPath: string | null;
  readonly searchPath: ReadonlyArray<string>;
  readonly cwd: string;
}

export interface ShellCheckFact {
  readonly status: "trust-required" | "missing-prerequisite" | "available" | "probe-failed";
  readonly executable: string | null;
  readonly version: string | null;
  readonly source: "configured" | "discovered";
  readonly diagnosticProvider: "bash-language-server";
  readonly shellcheckDiagnostics: boolean;
  readonly detail: string;
}

const locate = async (input: ShellCheckInput): Promise<string | null> => {
  const candidates =
    input.configuredPath !== null
      ? [input.configuredPath]
      : input.searchPath
          .slice(0, 32)
          .filter(isAbsolute)
          .map((directory) => join(directory, "shellcheck"));

  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || candidate.includes("\0")) continue;

    try {
      const path = await realpath(candidate);
      await access(path, constants.X_OK);

      return path;
    } catch {
      continue;
    }
  }

  return null;
};

/** Consumers supply checkout-scoped execution trust; this probe grants no install or distribution approval. */
export const probeDeveloperShellCheck = async (input: ShellCheckInput): Promise<ShellCheckFact> => {
  const base = {
    executable: null,
    version: null,
    source: input.configuredPath !== null ? "configured" : "discovered",
    diagnosticProvider: "bash-language-server",
    shellcheckDiagnostics: false,
  } as const;

  if (!input.trusted)
    return {
      ...base,
      status: "trust-required",
      detail: "Trust this workspace to check ShellCheck.",
    };

  const executable = await locate(input);

  if (!executable)
    return {
      ...base,
      status: "missing-prerequisite",
      detail:
        input.configuredPath !== null
          ? "Couldn't find the configured ShellCheck executable. Choose an existing executable on this host."
          : "ShellCheck is missing on this host. Configure an existing executable to enable ShellCheck diagnostics.",
    };

  const version = await probeShellCheckVersion(executable, input.cwd).catch(() => null);

  if (!version)
    return {
      ...base,
      executable,
      status: "probe-failed",
      detail: "Couldn't verify ShellCheck 0.11.0 or later. Check the configured executable.",
    };

  return {
    ...base,
    executable,
    version,
    status: "available",
    shellcheckDiagnostics: true,
    detail: "ShellCheck diagnostics are available through Bash Language Server.",
  };
};

/** Never let Bash auto-discover an unprobed companion; Bash remains the only diagnostic publisher. */
export const shellCheckServerSettings = (fact: ShellCheckFact) => ({
  shellcheckPath: fact.shellcheckDiagnostics ? fact.executable : "",
});
