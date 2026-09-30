/**
 * The Host aliases in the user's `~/.ssh/config`, for "Add machine": every
 * literal `Host` pattern (wildcards and negations skipped), following
 * `Include` (globs, `~`, paths relative to `~/.ssh`). Polaris never asks for
 * an IP or a key; ssh resolves everything from the alias.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface SshAlias {
  readonly alias: string;
  /** `HostName` from the alias's own block, when it sets one. */
  readonly hostName: string | null;
  readonly user: string | null;
}

/** ssh's own limit on nested Include. */
const MAX_DEPTH = 16;

const isWildcard = (pattern: string) => /[*?]/.test(pattern) || pattern.startsWith("!");

/** Splits a config line's arguments, honouring double quotes. */
export const splitArgs = (text: string): Array<string> => {
  const args: Array<string> = [];

  for (const match of text.matchAll(/"([^"]*)"|(\S+)/g)) args.push(match[1] ?? match[2] ?? "");

  return args;
};

/** `Keyword args`, `Keyword=args` or `Keyword = args`; null for blanks and comments. */
export const parseLine = (line: string): { keyword: string; args: Array<string> } | null => {
  const trimmed = line.trim();

  if (trimmed === "" || trimmed.startsWith("#")) return null;
  const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(trimmed);

  if (match === null) return { keyword: trimmed.toLowerCase(), args: [] };

  return { keyword: match[1]!.toLowerCase(), args: splitArgs(match[2]!) };
};

const globToRegExp = (segment: string) =>
  new RegExp(
    `^${segment
      .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")
      .replaceAll("?", ".")}$`
  );

/** Expands `*` and `?` in any path segment, in sorted order (as ssh's glob(3) does). */
export const expandGlob = (path: string): Array<string> => {
  const segments = path.split("/");
  let found = [segments[0] === "" ? "/" : segments[0]!];

  for (const segment of segments.slice(1)) {
    if (segment === "") continue;

    found = found.flatMap((dir) => {
      if (!/[*?]/.test(segment)) return [join(dir, segment)];
      const pattern = globToRegExp(segment);

      try {
        return readdirSync(dir)
          .filter((name) => pattern.test(name) && !name.startsWith("."))
          .toSorted()
          .map((name) => join(dir, name));
      } catch {
        return [];
      }
    });
  }

  return found.filter((file) => existsSync(file) && statSync(file).isFile());
};

export interface ParseContext {
  readonly home: string;
  /** Reads an included file; null if it can't be read. */
  readonly read: (path: string) => string | null;
  readonly expand: (pattern: string) => ReadonlyArray<string>;
}

interface Block {
  aliases: Array<string>;
  hostName: string | null;
  user: string | null;
}

const includePath = (arg: string, home: string) => {
  const expanded = arg.startsWith("~/") ? join(home, arg.slice(2)) : arg;

  return isAbsolute(expanded) ? expanded : join(home, ".ssh", expanded);
};

interface Walk {
  readonly ctx: ParseContext;
  readonly depth: number;
  readonly blocks: Array<Block>;
  current: Block | null;
}

const include = (walk: Walk, patterns: ReadonlyArray<string>) => {
  if (walk.depth >= MAX_DEPTH) return;

  for (const pattern of patterns) {
    for (const file of walk.ctx.expand(includePath(pattern, walk.ctx.home))) {
      const included = walk.ctx.read(file);

      if (included !== null) collect(included, walk.ctx, walk.depth + 1, walk.blocks);
    }
  }
};

/** One keyword's effect on the walk: new blocks, Includes, and the block's HostName and User. */
const apply = (walk: Walk, keyword: string, args: ReadonlyArray<string>) => {
  const current = walk.current;

  if (keyword === "host") {
    walk.current = { aliases: args.filter((a) => !isWildcard(a)), hostName: null, user: null };
    walk.blocks.push(walk.current);
  } else if (keyword === "match") {
    // A Match block's settings apply by condition, never to one alias.
    walk.current = null;
  } else if (keyword === "include") {
    include(walk, args);
  } else if (current !== null && keyword === "hostname") {
    current.hostName ??= args[0] ?? null;
  } else if (current !== null && keyword === "user") {
    current.user ??= args[0] ?? null;
  }
};

/** Parses one config text into blocks, following its Includes. */
const collect = (
  text: string,
  ctx: ParseContext,
  depth: number,
  blocks: Array<Block>
): Array<Block> => {
  const walk: Walk = { ctx, depth, blocks, current: null };

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);

    if (parsed !== null) apply(walk, parsed.keyword, parsed.args);
  }

  return blocks;
};

/** Every literal alias, in the order ssh reads them; the first block naming an alias wins. */
export const parseSshConfig = (text: string, ctx: ParseContext): ReadonlyArray<SshAlias> => {
  const seen = new Map<string, SshAlias>();

  for (const block of collect(text, ctx, 0, [])) {
    for (const alias of block.aliases) {
      if (seen.has(alias)) continue;
      seen.set(alias, { alias, hostName: block.hostName, user: block.user });
    }
  }

  return [...seen.values()];
};

const readOrNull = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The aliases in `<home>/.ssh/config`; none if it doesn't exist. */
export const readSshAliases = (home: string = homedir()): ReadonlyArray<SshAlias> => {
  const text = readOrNull(join(home, ".ssh", "config"));

  if (text === null) return [];

  return parseSshConfig(text, { home, read: readOrNull, expand: expandGlob });
};
