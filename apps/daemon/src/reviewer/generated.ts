/**
 * Which changed files are generated: the built-in patterns (`isGeneratedPath`), then the
 * repo's `.gitattributes` at the diff's head (`linguist-generated`, `-diff`), then
 * `.polaris/review.md` `ignore:`. Review collapses them and the prompts leave their bodies out.
 */
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isGeneratedPath } from "@polaris/protocol";
import { checkoutGitRaw } from "../git/review/refs.ts";
import { isIgnored, readInstructions } from "./instructions.ts";

const decoder = new TextDecoder();

/** `linguist-generated` set or `diff` unset: generated; `linguist-generated=false`: not. */
type Attributed = ReadonlyMap<string, boolean>;

/** `git check-attr -z` output: path, attribute, value, repeated. */
export const parseCheckAttr = (output: string): Attributed => {
  const fields = output.split("\0");
  const verdicts = new Map<string, boolean>();

  for (let at = 0; at + 2 < fields.length; at += 3) {
    const [path = "", attribute, value] = fields.slice(at, at + 3);

    if (attribute === "linguist-generated" && (value === "set" || value === "true"))
      verdicts.set(path, true);
    else if (attribute === "linguist-generated" && (value === "unset" || value === "false"))
      verdicts.set(path, false);
    else if (attribute === "diff" && value === "unset" && verdicts.get(path) !== false)
      verdicts.set(path, true);
  }

  return verdicts;
};

const ATTRIBUTES = ["-z", "--stdin", "linguist-generated", "diff"];

/** Past this many directories to look in, asking git is cheaper than looking. */
const MAX_LOOKUPS = 200;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false
  );

/**
 * Whether git could hold attributes for `paths` in the working tree: a `.gitattributes` in
 * one of their directories or above, or `.git/info/attributes`. Saves a spawn per Turn diff.
 */
export const mayHaveAttributes = async (
  root: string,
  paths: ReadonlyArray<string>
): Promise<boolean> => {
  const dirs = new Set<string>([""]);

  for (const path of paths) {
    for (let dir = dirname(path); dir !== "." && dir !== "/"; dir = dirname(dir)) {
      if (dirs.has(dir)) break;
      dirs.add(dir);
    }

    if (dirs.size > MAX_LOOKUPS) return true;
  }

  const files = [...dirs].map((dir) => join(root, dir, ".gitattributes"));
  const found = await Promise.all([...files, join(root, ".git", "info", "attributes")].map(exists));

  return found.includes(true);
};

/** The attributes at `head` (git ≥ 2.40, else the working tree's), or the working tree's for null. */
export const readAttributes = async (
  root: string,
  head: string | null,
  paths: ReadonlyArray<string>
): Promise<Attributed> => {
  if (paths.length === 0 || (head === null && !(await mayHaveAttributes(root, paths))))
    return new Map();

  const stdin = `${paths.join("\0")}\0`;
  const source = head === null ? [] : [`--source=${head}`];
  let result = await checkoutGitRaw(root, ["check-attr", ...source, ...ATTRIBUTES], { stdin });

  if (result.code !== 0 && head !== null)
    result = await checkoutGitRaw(root, ["check-attr", ...ATTRIBUTES], { stdin });

  return result.code === 0 ? parseCheckAttr(decoder.decode(result.stdout)) : new Map();
};

export interface GeneratedInput {
  readonly paths: ReadonlyArray<string>;
  readonly attributes: Attributed;
  readonly ignore: ReadonlyArray<string>;
}

/** The generated paths among `paths`; `linguist-generated=false` overrides the built-in list. */
export const generatedAmong = (input: GeneratedInput): ReadonlySet<string> =>
  new Set(
    input.paths.filter(
      (path) =>
        isIgnored(input.ignore, path) || (input.attributes.get(path) ?? isGeneratedPath(path))
    )
  );

/** Reads the attributes and instructions at `head` (null: the working tree) and classifies `paths`. */
export const generatedPaths = async (options: {
  readonly root: string;
  readonly head: string | null;
  readonly repo: string;
  readonly paths: ReadonlyArray<string>;
  readonly ignore?: ReadonlyArray<string>;
}): Promise<ReadonlySet<string>> => {
  if (options.paths.length === 0) return new Set();

  const [attributes, ignore] = await Promise.all([
    readAttributes(options.root, options.head, options.paths),
    options.ignore === undefined
      ? readInstructions({
          cwd: options.root,
          head: options.head,
          repo: options.repo,
          cachedName: true,
        }).then((instructions) => instructions.ignore)
      : Promise.resolve(options.ignore),
  ]);

  return generatedAmong({ paths: options.paths, attributes, ignore });
};
