// Runs typescript-language-server on each import case's post-history buffer, inside a temporary
// worktree at the case's commit, and applies each import rule until it offers nothing more.
// Pass dev, test or extra. Records every round's diagnostics, quick fixes and choice.
import { $ } from "bun";
import { mkdtemp, rm, symlink, cp, mkdir, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { hardeningCases } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import {
  selectImportFix,
  UNRESOLVED_NAME_CODES,
  type ImportChoice,
  type UnresolvedName,
} from "../../../../packages/predict/src/edit/imports/index.ts";
import { LspClient, type Diagnostic } from "./lsp-client.ts";
import { applyLspEdits, changedRegion, type ImportCase } from "./imports-shared.ts";

const split = process.argv[2];
if (!["dev", "test", "extra"].includes(split ?? "")) throw new Error("Pass dev, test or extra");
const ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SERVER = process.env.TS_LS ?? "/Users/lucasdoell/code/polaris/.polaris-dev/m31-v1/tools/typescript-language-server/lib/cli.mjs";
const TSSERVER = join(ROOT, "packages/syntax-diff/node_modules/typescript-js/lib/tsserver.js");
const specs: { id: string; commit: string }[] = await Bun.file(new URL("./cases.json", import.meta.url)).json();
const cases: ImportCase[] = split === "extra"
  ? await Bun.file(new URL("../reach/imports-extra.cases.json", import.meta.url)).json()
  : hardeningCases.filter((c) => c.category === "import" && c.split === split)
      .map((c) => ({ ...c, commit: specs.find((s) => s.id === c.id)!.commit }));

type Rule = "spec" | "module" | "ts-first";
type Scope = "range" | "range+names";
const RUNS: [Rule, Scope][] = [["spec", "range"], ["module", "range"], ["spec", "range+names"],
  ["module", "range+names"], ["ts-first", "range+names"]];

// The first import fix for the first name, in the server's order: TypeScript's own ranking.
const tsFirst = (uri: string, names: UnresolvedName[]): ImportChoice | null => {
  for (const name of [...names].sort((a, b) => a.diagnostic.range.start.line - b.diagnostic.range.start.line)) {
    const one = selectImportFix({ uri, text: "" }, [{ ...name, actions: name.actions
      .filter((a) => /^(?:Add|Update) import from/.test(a.title)).slice(0, 1).map((a) => ({ ...a, isPreferred: true })) }], "spec");
    if (one) return one;
  }
  return null;
};

const run = async (lsp: LspClient, uri: string, language: string, c: ImportCase, rule: Rule, scope: Scope) => {
  let text = c.buffer;
  const rounds = [];
  let diagnostics = await lsp.open(uri, language, text);
  for (let round = 0; round < 6; round++) {
    // Located by text each round, so applied imports don't shift the burst's lines.
    const region = changedRegion(text, c.history);
    const inScope = (d: Diagnostic) => {
      if (!UNRESOLVED_NAME_CODES.has(Number(d.code))) return false;
      if ([...region.lines].some((l) => l >= d.range.start.line && l <= d.range.end.line)) return true;
      const name = /'([$\w]+)'/.exec(d.message)?.[1];
      return scope === "range+names" && name !== undefined && region.names.has(name);
    };
    const names: UnresolvedName[] = [];
    for (const diagnostic of diagnostics.filter(inScope))
      names.push({ diagnostic, actions: (await lsp.request("textDocument/codeAction", { textDocument: { uri },
        range: diagnostic.range, context: { diagnostics: [diagnostic], only: ["quickfix"] } })) ?? [] });
    const choice = rule === "ts-first" ? tsFirst(uri, names) : selectImportFix({ uri, text }, names, rule);
    rounds.push({ names, choice: choice && { title: choice.action.title, module: choice.module, edits: choice.edits } });
    if (!choice) break;
    text = applyLspEdits(text, choice.edits);
    diagnostics = await lsp.change(uri, text);
  }
  await lsp.closeDocument(uri);
  return { rule, scope, rounds, final: text };
};

const tmp = await realpath(await mkdtemp(join(tmpdir(), "polaris-imports-")));
const tree = join(tmp, "tree");
const out: unknown[] = [];
try {
  await $`git -C ${ROOT} worktree add --detach ${tree} ${cases[0]!.commit}`.quiet();
  await symlink(join(ROOT, "node_modules"), join(tree, "node_modules"));
  for (const c of cases) {
    await $`git -C ${tree} checkout --detach -f ${c.commit}`.quiet();
    await $`git -C ${tree} clean -fdq -e node_modules`.quiet();
    // Workspace links are relative, so copies resolve to this commit's packages.
    for (const rel of new Bun.Glob("{apps,packages,tooling}/*/node_modules").scanSync({ cwd: ROOT, onlyFiles: false })) {
      const target = join(tree, rel);
      if (!existsSync(dirname(target)) || existsSync(target)) continue;
      await mkdir(dirname(target), { recursive: true });
      await cp(join(ROOT, rel), target, { recursive: true, verbatimSymlinks: true });
    }
    const file = join(tree, c.path);
    await Bun.write(file, c.buffer);
    const start = performance.now();
    const lsp = new LspClient(["node", SERVER, "--stdio"], tree);
    try {
      await lsp.initialize(tree, { tsserver: { path: TSSERVER, useSyntaxServer: "never" },
        disableAutomaticTypingAcquisition: true, plugins: [] });
      const runs = [];
      for (const [rule, scope] of RUNS)
        runs.push(await run(lsp, `file://${file}`, c.path.endsWith("x") ? "typescriptreact" : "typescript", c, rule, scope));
      out.push({ id: c.id, commit: c.commit, path: c.path, runs, elapsedMs: performance.now() - start });
      process.stderr.write(`${c.id} `);
    } finally {
      await lsp.close();
    }
  }
} finally {
  await $`git -C ${ROOT} worktree remove --force ${tree}`.nothrow().quiet();
  await rm(tmp, { recursive: true, force: true });
  await $`git -C ${ROOT} worktree prune`.nothrow().quiet();
}
await Bun.write(new URL(`../reach/imports-${split}.lsp.json`, import.meta.url), JSON.stringify(out) + "\n");
console.log(`\nRecorded ${out.length} cases`);
