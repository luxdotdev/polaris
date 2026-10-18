/**
 * The repo's review instructions (ENG-225): `.polaris/review.md` as committed
 * at the reviewed head, then the private `~/.polaris/review/<repo>.md` on this
 * Host, appended after it. Optional front-matter lists paths to ignore.
 */
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { Option, Schema } from "effect";
import { uninterrupted } from "../git/interrupt.ts";
import { checkoutGitRaw } from "../git/review/refs.ts";
import { listRemotes, parseRemoteUrl } from "../git/review/remotes.ts";
import { polarisHome } from "../paths.ts";

export const COMMITTED_INSTRUCTIONS = ".polaris/review.md";

export interface ReviewInstructions {
  /** Both files' bodies, committed first; null when neither exists. */
  readonly text: string | null;
  /** Globs from either file's `ignore:` front-matter. */
  readonly ignore: ReadonlyArray<string>;
}

const FrontMatter = Schema.Struct({
  ignore: Schema.optionalKey(Schema.Array(Schema.String)),
});

const decodeFrontMatter = Schema.decodeUnknownOption(FrontMatter);

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a file into its front-matter's ignore globs and its body. */
export const parseInstructions = (source: string): ReviewInstructions => {
  const match = FENCE.exec(source);

  if (match === null) return { text: source.trim() || null, ignore: [] };
  const body = source.slice(match[0].length).trim();
  let ignore: ReadonlyArray<string> = [];

  try {
    const parsed = decodeFrontMatter(Bun.YAML.parse(match[1] ?? ""));

    if (Option.isSome(parsed)) ignore = parsed.value.ignore ?? [];
  } catch {
    // Front-matter that isn't YAML is left out; the body still counts.
  }

  return { text: body || null, ignore };
};

const decoder = new TextDecoder();

const readPrivate = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

/** The committed file at `head`, or the working tree's when `head` is null. */
const committedAt = async (cwd: string, head: string | null): Promise<string | null> => {
  if (head === null) return readPrivate(join(cwd, COMMITTED_INSTRUCTIONS));
  const result = await checkoutGitRaw(cwd, ["show", `${head}:${COMMITTED_INSTRUCTIONS}`]);

  return result.code === 0 ? decoder.decode(result.stdout) : null;
};

/**
 * `<host>/<owner>/<name>` for a repo key, or the repo's `origin` (else first)
 * remote for a Workspace path; the directory's name when it has none.
 */
export const privateInstructionsName = async (repo: string): Promise<string> => {
  if (!isAbsolute(repo)) return repo;
  const remotes = await listRemotes(repo);
  const remote = remotes.find((r) => r.name === "origin") ?? remotes[0];
  const url = remote === undefined ? null : parseRemoteUrl(remote.url);

  if (url !== null) return `${url.host}/${url.owner}/${url.name}`.toLowerCase();

  return `local/${basename(repo) || "repo"}`;
};

export const privateInstructionsPath = (name: string): string =>
  join(polarisHome(), "review", `${name}.md`);

/** Names by Workspace path: a remote rarely changes, and `git.diff` asks once per Turn. */
const names = new Map<string, Promise<string>>();

const KEPT_NAMES = 64;

const cachedName = (repo: string): Promise<string> => {
  const known = names.get(repo);

  if (known !== undefined) return known;

  if (names.size >= KEPT_NAMES) names.clear();
  // Shared by every caller: one caller's interrupt mustn't kill its git for the rest.
  const name = uninterrupted(() => privateInstructionsName(repo));
  names.set(repo, name);

  return name;
};

export const readInstructions = async (options: {
  readonly cwd: string;
  /** Null reads the committed file from the working tree. */
  readonly head: string | null;
  readonly repo: string;
  /** Reuse this Daemon's earlier answer for the repo's private file name (`git.diff`). */
  readonly cachedName?: boolean;
}): Promise<ReviewInstructions> => {
  const name = await (options.cachedName === true
    ? cachedName(options.repo)
    : privateInstructionsName(options.repo));

  const sources = [
    await committedAt(options.cwd, options.head),
    await readPrivate(privateInstructionsPath(name)),
  ].flatMap((source) => (source === null ? [] : [parseInstructions(source)]));

  const texts = sources.flatMap((source) => (source.text === null ? [] : [source.text]));

  return {
    text: texts.length > 0 ? texts.join("\n\n") : null,
    ignore: sources.flatMap((source) => source.ignore),
  };
};

/** True when a path matches one of the ignore globs. */
export const isIgnored = (ignore: ReadonlyArray<string>, path: string): boolean =>
  ignore.some((glob) => new Bun.Glob(glob).match(path));
