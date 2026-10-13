/**
 * The Host aliases in the user's `~/.ssh/config`, for "Add machine": every
 * literal `Host` pattern (wildcards and negations skipped), following
 * `Include` (globs, `~`, paths relative to `~/.ssh`). Polaris never asks for
 * an IP or a key; ssh resolves everything from the alias.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";

export interface SshConfigOptions {
  readonly platform?: NodeJS.Platform | undefined;
  readonly env?: NodeJS.ProcessEnv;
}

const configPath = (path: string, platform: NodeJS.Platform) =>
  platform === "win32" ? path.replaceAll("\\", "/") : path;

const configJoin = (platform: NodeJS.Platform, ...parts: ReadonlyArray<string>) =>
  configPath(platform === "win32" ? win32.join(...parts) : join(...parts), platform);

interface GlobFiles {
  readonly list: (path: string) => ReadonlyArray<string>;
  readonly isFile: (path: string) => boolean;
}

const globFiles: GlobFiles = {
  list: (path) => readdirSync(path),
  isFile: (path) => existsSync(path) && statSync(path).isFile(),
};

export interface SshAlias {
  readonly alias: string;
  /** `HostName` from the alias's own block, when it sets one. */
  readonly hostName: string | null;
  readonly user: string | null;
}

/** ssh's own limit on nested Include. */
const MAX_DEPTH = 16;

/** Wildcards, negations, and names ssh would read as an option: never an alias to offer. */
const isWildcard = (pattern: string) =>
  /[*?]/.test(pattern) || pattern.startsWith("!") || pattern.startsWith("-");

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
export const expandGlob = (
  path: string,
  platform: NodeJS.Platform = process.platform,
  files: GlobFiles = globFiles
): Array<string> => {
  const normalized = configPath(path, platform);
  const root = platform === "win32" ? win32.parse(normalized).root : "";
  const segments = normalized.slice(root.length).split("/");
  let found = [root || (segments[0] === "" ? "/" : segments[0]!)];

  for (const segment of root ? segments : segments.slice(1)) {
    if (segment === "") continue;

    found = found.flatMap((dir) => {
      if (!/[*?]/.test(segment)) return [configJoin(platform, dir, segment)];
      const pattern = globToRegExp(segment);

      try {
        return files
          .list(dir)
          .filter((name) => pattern.test(name) && !name.startsWith("."))
          .toSorted()
          .map((name) => configJoin(platform, dir, name));
      } catch {
        return [];
      }
    });
  }

  return found.filter(files.isFile);
};

export interface ParseContext extends SshConfigOptions {
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

const includePath = (arg: string, ctx: ParseContext): string | null => {
  const platform = ctx.platform ?? process.platform;
  let missing = false;

  const argument =
    platform === "win32"
      ? arg.replace(
          /%([^%]+)%|\$\{([^}]+)\}/g,
          (_match, percent: string | undefined, brace: string | undefined) => {
            const name = (percent ?? brace ?? "").toLowerCase();

            const value = Object.entries(ctx.env ?? process.env).find(
              ([key]) => key.toLowerCase() === name
            )?.[1];

            if (value === undefined) missing = true;

            return value ?? "";
          }
        )
      : arg;

  if (missing) return null;
  const normalized = configPath(argument, platform);

  const expanded = normalized.startsWith("~/")
    ? configJoin(platform, ctx.home, normalized.slice(2))
    : normalized;

  const absolute = platform === "win32" ? win32.isAbsolute(expanded) : isAbsolute(expanded);

  return absolute ? expanded : configJoin(platform, ctx.home, ".ssh", expanded);
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
    const path = includePath(pattern, walk.ctx);

    if (path === null) continue;

    for (const file of walk.ctx.expand(path)) {
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
export const readSshAliases = (
  home: string = homedir(),
  options: SshConfigOptions = {}
): ReadonlyArray<SshAlias> => {
  const text = readOrNull(join(home, ".ssh", "config"));

  if (text === null) return [];

  return parseSshConfig(text, {
    ...options,
    home,
    read: readOrNull,
    expand: (path) => expandGlob(path, options.platform),
  });
};
