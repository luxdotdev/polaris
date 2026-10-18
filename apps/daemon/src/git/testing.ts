/** Test helpers: throwaway git repositories. Not used at runtime. */
import { afterAll, afterEach } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitText } from "./git.ts";

const BUSY = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);

const ATTEMPTS = 20;

/** Whether a failed removal may succeed later: Windows keeps a directory busy while it's in use. */
const retryable = (cause: unknown, attempt: number) => {
  // SAFETY: rmSync throws only Node system errors, which carry a string `code`.
  const code = (cause as NodeJS.ErrnoException).code ?? "";

  return process.platform === "win32" && BUSY.has(code) && attempt < ATTEMPTS;
};

/**
 * Retries for 2 s on Windows, which keeps a directory busy until a closed watch lets go.
 * It blocks the event loop meanwhile; after a Daemon test use `removeDirSettled`.
 */
export const removeDir = (path: string): void => {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });

      return;
    } catch (cause) {
      if (!retryable(cause, attempt)) throw cause;
      Bun.sleepSync(100);
    }
  }
};

/**
 * `removeDir` that lets the event loop run between attempts, so a child the test's Daemon
 * started (git still being fed its stdin) can finish and let go of the directory (ENG-356).
 */
export const removeDirSettled = async (path: string): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });

      return;
    } catch (cause) {
      if (!retryable(cause, attempt)) throw cause;
      await Bun.sleep(100);
    }
  }
};

/** The native realpath also expands Windows 8.3 names (RUNNER~1) into the ones git prints. */
export const tempDir = (prefix = "polaris-test-"): string => {
  const directory = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  // Register in the calling test's context; module-level hooks only cover the importing file.
  afterEach(() => removeDirSettled(directory));

  return directory;
};

/** Declare before beforeAll; the returned factory keeps shared roots until the suite ends. */
export const suiteTempDir = (prefix = "polaris-test-"): (() => string) => {
  const directories: Array<string> = [];
  afterAll(async () => {
    for (const directory of directories.splice(0)) await removeDirSettled(directory);
  });

  return () => {
    const directory = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
    directories.push(directory);

    return directory;
  };
};

export const write = (root: string, path: string, content: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
};

/** A repository with an identity set and one commit containing `files`. */
export const makeRepo = async (files: Record<string, string> = { "README.md": "hello\n" }) => {
  const root = tempDir("polaris-repo-");
  await gitText(root, ["init", "-q", "-b", "main"]);
  // One write, not several `git config` calls: each changes the config, so the next call lists it
  // again. autocrlf off: Git for Windows (and its CI runners) turn it on, rewriting checkouts as CRLF.
  appendFileSync(
    join(root, ".git/config"),
    "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n" +
      "[core]\n\tautocrlf = false\n"
  );

  for (const [path, content] of Object.entries(files)) write(root, path, content);

  if (Object.keys(files).length > 0) {
    await gitText(root, ["add", "-A"]);
    await gitText(root, ["commit", "-q", "-m", "initial"]);
  }

  return root;
};

export const commitAll = async (root: string, message: string): Promise<string> => {
  await gitText(root, ["add", "-A"]);
  await gitText(root, ["commit", "-q", "-m", message]);

  return gitText(root, ["rev-parse", "HEAD"]);
};
