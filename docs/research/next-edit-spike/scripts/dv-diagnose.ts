// dv-diagnose.ts <states.json> <out.json> [server]: diagnostics of each case's buffer and of every
// state, from a real language server on a temporary checkout of the case's commit (other files as
// committed, the case file as an unsaved buffer). Server: "tsgo" (default) or "tsls" (Polaris' own).
import { $ } from "bun";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { Lsp, type Diag } from "./dv-lsp.ts";
import { REPO } from "./git.ts";
import type { CaseStates } from "./dv-states.ts";

export type CaseDiagnostics = { pre: Diag[]; states: Record<string, Diag[]>; ms: number[]; fixes?: { diag: Diag; titles: string[] }[]; error?: string };

// DV_FIXES=1: only the buffer's diagnostics, and the server's quick fixes for each unresolved name.
const fixesOnly = process.env.DV_FIXES === "1";
const unresolved = (d: Diag) => d.severity === 1 && ["2304", "2552", "2503", "18004"].includes(d.code);

const [statesFile = "", outFile = "", server = "tsgo"] = process.argv.slice(2);
const rows: CaseStates[] = await Bun.file(statesFile).json();
const done: Record<string, CaseDiagnostics> = (await Bun.file(outFile).exists()) ? await Bun.file(outFile).json() : {};
const here = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const tsgo = `${here}/node_modules/.bun/@typescript+typescript-darwin-arm64@7.0.2/node_modules/@typescript/typescript-darwin-arm64/lib/tsc`;
const tsls = process.env.DV_TSLS ?? "";
const tsserver = process.env.DV_TSSERVER ?? "";
const argv = server === "tsgo" ? [tsgo, "--lsp", "--stdio"] : ["node", tsls, "--stdio"];
const init = server === "tsgo" ? {} : { tsserver: { path: tsserver }, preferences: {} };

const tmp = mkdtempSync(`${process.env.DV_TMP ?? tmpdir()}/dv-wt-`);
const wt = `${tmp}/repo`;
await $`git -C ${REPO} worktree add --detach ${wt} HEAD`.quiet();
const nodeModules = (await $`find ${here} -maxdepth 3 -name node_modules -type d -not -path */node_modules/*`.quiet().text()).split("\n").filter(Boolean);

const link = async () => {
  for (const dir of nodeModules) {
    const rel = dir.slice(here.length + 1);
    if (existsSync(`${wt}/${rel}`)) continue;
    if (rel === "node_modules") symlinkSync(dir, `${wt}/${rel}`);
    else await $`mkdir -p ${wt}/${rel.slice(0, -"/node_modules".length)} && cp -RP ${dir} ${wt}/${rel}`.quiet();
  }
};

const byCommit = Map.groupBy(rows.filter((r) => !done[r.id]), (r) => r.commit);
let n = 0;
try {
  for (const [commit, cases] of byCommit) {
    await $`git -C ${wt} checkout --detach -f ${commit}`.quiet();
    await link();
    const lsp = new Lsp(argv, wt);
    try {
      await lsp.initialize(wt, init);
      for (const c of cases) {
        const uri = `file://${wt}/${c.path}`;
        const result: CaseDiagnostics = { pre: [], states: {}, ms: [] };
        try {
          lsp.open(uri, c.buffer);
          result.pre = await lsp.pull(uri);
          if (fixesOnly) result.fixes = await Promise.all(result.pre.filter(unresolved).map(async (diag) => {
            const range = { start: { line: diag.line, character: diag.character }, end: { line: diag.endLine, character: diag.endCharacter } };
            const actions = await lsp.request<{ title: string }[] | null>("textDocument/codeAction", { textDocument: { uri }, range, context: { diagnostics: [{ range, code: Number(diag.code), message: diag.message, severity: 1, source: "ts" }], only: ["quickfix"] } });
            return { diag, titles: (actions ?? []).map((a) => a.title) };
          }));
          for (const s of fixesOnly ? [] : c.states) {
            lsp.change(uri, s.after);
            const t = performance.now();
            result.states[s.hash] = await lsp.pull(uri);
            result.ms.push(performance.now() - t);
            lsp.change(uri, c.buffer);
            await lsp.pull(uri);
          }
          lsp.close(uri);
        } catch (error) {
          result.error = String(error);
        }
        done[c.id] = result;
        process.stderr.write(`${++n} ${c.id} pre=${result.pre.length} ${result.error ?? ""}\n`);
      }
    } finally {
      await lsp.stop();
    }
    await Bun.write(outFile, JSON.stringify(done));
  }
} finally {
  await $`git -C ${REPO} worktree remove --force ${wt}`.quiet().nothrow();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Diagnosed ${Object.keys(done).length} cases → ${outFile}`);
