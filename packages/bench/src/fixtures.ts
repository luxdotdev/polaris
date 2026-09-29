/**
 * Generated test data: git repositories and large source trees. Large trees are
 * cached under /tmp/polaris-bench/fixtures/ (keyed by size) and copied per run,
 * so every run starts from the same bytes without regenerating them.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = "/tmp/polaris-bench/fixtures";

/** Bump when the generator changes, so stale caches are not reused. */
const GENERATOR_VERSION = 1;

export const git = (cwd: string, ...args: ReadonlyArray<string>) => {
  const out = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "bench",
      GIT_AUTHOR_EMAIL: "bench@polaris.invalid",
      GIT_COMMITTER_NAME: "bench",
      GIT_COMMITTER_EMAIL: "bench@polaris.invalid",
    },
  });

  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr.toString()}`);

  return out.stdout.toString();
};

/** A small git repo with one commit. */
export const smallRepo = (dir: string) => {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# bench\n");
  writeFileSync(join(dir, "src", "index.ts"), "export const answer = 42\n");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");

  return dir;
};

const WORDS = [
  "session",
  "workspace",
  "turn",
  "checkpoint",
  "daemon",
  "harness",
  "stream",
  "snapshot",
  "sequence",
  "approval",
  "worktree",
  "terminal",
  "attachment",
  "delta",
  "engine",
  "store",
];

/** Deterministic pseudo-random numbers (mulberry32). */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * A source tree of `files` TypeScript-ish files (~1.5 KB each) in nested
 * directories of 100, committed to git. Every 1000th file contains the token
 * `needleBench`, for grep.
 */
const writeTree = (dir: string, files: number) => {
  const random = rng(files);
  const pick = () => WORDS[Math.floor(random() * WORDS.length)]!;

  for (let i = 0; i < files; i++) {
    const d1 = `pkg${Math.floor(i / 10_000)}`;
    const d2 = `mod${Math.floor(i / 100) % 100}`;
    const folder = join(dir, "packages", d1, "src", d2);

    if (i % 100 === 0) mkdirSync(folder, { recursive: true });
    const name = `${pick()}${pick().replace(/^./, (c) => c.toUpperCase())}${i}.ts`;
    const lines: Array<string> = [`// generated file ${i}`];

    for (let l = 0; l < 30; l++) {
      lines.push(`export const ${pick()}${l} = (${pick()}: string) => \`${pick()} \${${pick()}}\``);
    }

    if (i % 1000 === 0) lines.push(`export const needleBench${i} = true`);
    writeFileSync(join(folder, name), `${lines.join("\n")}\n`);
  }
};

/** A cached, committed source tree of `files` files; returns its path (do not modify it). */
export const sourceTree = (files: number): string => {
  const dir = join(FIXTURES, `tree-v${GENERATOR_VERSION}-${files}`);

  if (existsSync(join(dir, ".complete"))) return join(dir, "repo");
  rmSync(dir, { recursive: true, force: true });
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  writeTree(repo, files);
  writeFileSync(join(repo, "README.md"), "# generated\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "generated tree");
  writeFileSync(join(dir, ".complete"), "");

  return repo;
};

/** A private copy of a cached tree (APFS clones on macOS, so it is cheap there). */
export const copyTree = (source: string, dest: string) => {
  if (process.platform === "darwin") {
    const out = Bun.spawnSync(["cp", "-Rc", source, dest]);

    if (out.exitCode === 0) return dest;
  }

  cpSync(source, dest, { recursive: true });

  return dest;
};

/** A file of `bytes` pseudo-random bytes (incompressible, like a binary or image). */
export const randomFile = async (path: string, bytes: number) => {
  const chunk = new Uint8Array(1024 * 1024);
  const random = rng(bytes);

  for (let i = 0; i < chunk.length; i++) chunk[i] = Math.floor(random() * 256);
  const out = Bun.file(path).writer();

  for (let written = 0; written < bytes; written += chunk.length) {
    await out.write(chunk.subarray(0, Math.min(chunk.length, bytes - written)));
  }

  return out.end();
};
