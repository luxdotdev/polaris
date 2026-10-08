/** A gitignore-style ignore file (`.prettierignore`, `.gitignore`), relative to its directory. */
export type IgnoreMatcher = (relativePath: string) => boolean;

interface Rule {
  readonly negate: boolean;
  readonly directory: boolean;
  readonly glob: Bun.Glob;
}

const rule = (line: string): Rule => {
  const negate = line.startsWith("!");
  let pattern = negate ? line.slice(1) : line;

  if (pattern.startsWith("\\")) pattern = pattern.slice(1);
  const directory = pattern.endsWith("/");

  if (directory) pattern = pattern.slice(0, -1);
  const anchored = pattern.includes("/");

  if (pattern.startsWith("/")) pattern = pattern.slice(1);

  return { negate, directory, glob: new Bun.Glob(anchored ? pattern : `**/${pattern}`) };
};

const matches = (entry: Rule, parts: readonly string[]) => {
  for (let index = 1; index <= parts.length; index++) {
    if (entry.directory && index === parts.length) return false;

    if (entry.glob.match(parts.slice(0, index).join("/"))) return true;
  }

  return false;
};

/** The last matching rule wins; a path under an ignored directory is ignored. */
export const ignoreMatcher = (text: string): IgnoreMatcher => {
  const rules = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map(rule);

  return (relativePath) => {
    const parts = relativePath.split("/").filter((part) => part !== "" && part !== ".");
    let ignored = false;

    for (const entry of rules) if (matches(entry, parts)) ignored = !entry.negate;

    return ignored;
  };
};
