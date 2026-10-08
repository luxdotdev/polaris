import type { LanguageProjectFormatterTool } from "@polaris/protocol";

/** Each tool reads the buffer on stdin and resolves its own config and ignores from `file`. */
const ARGUMENTS: Record<LanguageProjectFormatterTool, (file: string) => string[]> = {
  oxfmt: (file) => [`--stdin-filepath=${file}`],
  prettier: (file) => ["--stdin-filepath", file],
  biome: (file) => ["format", `--stdin-file-path=${file}`],
  dprint: (file) => ["fmt", "--stdin", file],
};

export interface FormatterRun {
  readonly tool: LanguageProjectFormatterTool;
  readonly executable: string;
  readonly cwd: string;
  readonly file: string;
  readonly text: string;
  readonly timeoutMs: number;
}

export type RunResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "timeout" | "cancelled" | "formatter-failed";
      readonly message: string;
    };

const MAX_OUTPUT_CHARS = 1048576;

const firstLine = (stderr: string) =>
  stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== "")
    ?.slice(0, 300) ?? "";

const spawn = (run: FormatterRun) =>
  Bun.spawn([run.executable, ...ARGUMENTS[run.tool](run.file)], {
    cwd: run.cwd,
    env: {
      ...process.env,
      POLARIS_HANDOFF: undefined,
      POLARIS_HOST_SOCKET: undefined,
      POLARIS_SESSION_ID: undefined,
    },
    stdin: new Blob([run.text]),
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

/** No shell; the process group is killed on timeout or cancellation. */
export async function runProjectFormatter(
  run: FormatterRun,
  signal: AbortSignal
): Promise<RunResult> {
  if (signal.aborted) return { ok: false, reason: "cancelled", message: "Formatting cancelled" };

  let child: ReturnType<typeof spawn>;

  try {
    child = spawn(run);
  } catch (cause) {
    return {
      ok: false,
      reason: "formatter-failed",
      message: `${run.tool} didn't start: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  let stopped: "timeout" | "cancelled" | null = null;

  const kill = (why: "timeout" | "cancelled") => {
    stopped ??= why;

    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };

  const cancel = () => kill("cancelled");
  const timer = setTimeout(() => kill("timeout"), run.timeoutMs);

  signal.addEventListener("abort", cancel, { once: true });

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    if (stopped !== null)
      return {
        ok: false,
        reason: stopped,
        message: stopped === "timeout" ? `${run.tool} timed out` : "Formatting cancelled",
      };

    if (code !== 0)
      return {
        ok: false,
        reason: "formatter-failed",
        message: firstLine(stderr) || `${run.tool} exited with code ${code}`,
      };

    if (stdout.length > MAX_OUTPUT_CHARS)
      return { ok: false, reason: "formatter-failed", message: `${run.tool} output is too large` };

    // Some tools print nothing for a file their config excludes.
    return { ok: true, text: stdout === "" ? run.text : stdout };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
