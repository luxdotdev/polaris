/**
 * The Changes tab's writes: stage, unstage, discard and commit, with the Host's
 * own git, config and hooks (`config: "host"`). Paths are relative to the top level.
 */
import { childEnv } from "../service/childEnv.ts";
import { runGit, gitText } from "./git.ts";

/** Paths go through stdin, NUL-separated and literal: no argv limit, no pathspec magic. */
const pathspecArgs = ["--pathspec-from-file=-", "--pathspec-file-nul"];

const pathOptions = (paths: ReadonlyArray<string>) => ({
  stdin: paths.map((path) => `${path}\0`).join(""),
  env: { GIT_LITERAL_PATHSPECS: "1" },
  config: "host" as const,
});

export const toplevel = (cwd: string) => gitText(cwd, ["rev-parse", "--show-toplevel"]);

const hasHead = async (top: string) =>
  (await runGit(top, ["rev-parse", "--verify", "--quiet", "HEAD"], { okCodes: [1] })).code === 0;

/** `add -A`, so a deleted path stages its deletion. */
export const stagePaths = async (cwd: string, paths: ReadonlyArray<string>) => {
  if (paths.length === 0) return;
  await runGit(await toplevel(cwd), ["add", "-A", ...pathspecArgs], pathOptions(paths));
};

/** Back to HEAD's version in the index; before the first commit, out of the index. */
export const unstagePaths = async (cwd: string, paths: ReadonlyArray<string>) => {
  if (paths.length === 0) return;
  const top = await toplevel(cwd);

  const args = (await hasHead(top))
    ? ["restore", "--staged", ...pathspecArgs]
    : ["rm", "--cached", "-r", "-q", ...pathspecArgs];

  await runGit(top, args, pathOptions(paths));
};

/** The worktree takes the index's version; git refuses a path it doesn't track. */
export const discardPaths = async (cwd: string, paths: ReadonlyArray<string>) => {
  if (paths.length === 0) return;
  await runGit(await toplevel(cwd), ["restore", "--worktree", ...pathspecArgs], pathOptions(paths));
};

export type CommitEvent =
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "committed"; readonly head: string }
  | { readonly kind: "failed"; readonly exitCode: number };

const pump = async (stream: ReadableStream<Uint8Array>, emit: (text: string) => void) => {
  const decoder = new TextDecoder();

  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });

    if (text !== "") emit(text);
  }
};

/**
 * `git commit -F -` in the top level, hooks' stdout and stderr interleaved as
 * they arrive. Nothing kills it early: a dropped Client only stops listening.
 */
export const commit = async (
  cwd: string,
  message: string,
  emit: (event: CommitEvent) => void
): Promise<void> => {
  const top = await toplevel(cwd);

  const proc = Bun.spawn(["git", "commit", "--cleanup=strip", "-F", "-"], {
    cwd: top,
    env: childEnv({
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      // No editor to wait on: the message is the Client's.
      GIT_EDITOR: "true",
      LC_ALL: "C",
    }),
    stdin: new Blob([message]),
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = (text: string) => emit({ kind: "output", text });

  await Promise.all([pump(proc.stdout, output), pump(proc.stderr, output)]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    emit({ kind: "failed", exitCode });

    return;
  }

  emit({ kind: "committed", head: await gitText(top, ["rev-parse", "HEAD"]) });
};
