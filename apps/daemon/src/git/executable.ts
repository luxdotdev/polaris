/**
 * The git the Daemon starts, as an absolute path found on `PATH`: on Windows a bare `git`
 * runs a `git.exe` in the cwd first, the repository (docs/adr/0069-git-runs-by-its-absolute-path.md).
 */
import { executableOf } from "../platform/executable.ts";

type Env = Readonly<Record<string, string | undefined>>;

export { pathOf } from "../platform/executable.ts";

/** The absolute path of the git a child with `env` finds on its `PATH`, never one in the cwd. */
export const gitExecutable = (env: Env = process.env): string => executableOf("git", env);
