// Builds each case's keystroke sequence from git: the file states after each history hunk,
// the in-progress edit typed 3 characters at a time, and the allowed ground-truth files.
import { $ } from "bun";
import { apply, hunks, landing, REPO, show, type Hunk } from "./git.ts";

export type CaseSpec = { id: string; cat: string; commit: string; path: string; hist: number[]; target: number[]; typed?: number };
export type Step = { states: string[][]; cursorLine: number; cursorCol: number };
export type Case = CaseSpec & {
  all: Hunk[];
  steps: Step[]; // warm keystroke sequence; the last is the case state that is scored
  allowed: string[][]; // current + target + any subset of the commit's other remaining hunks
  expected: string[]; // current + target only
  related: { path: string; text: string }[]; // sibling files at the parent commit, ~20 KB, for the card-sized prompt runs
};

const indentOf = (s: string) => s.length - s.trimStart().length;

function subsets<T>(xs: T[]): T[][] {
  return xs.slice(0, 6).reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
}

export async function buildCase(spec: CaseSpec): Promise<Case> {
  const base = (await show(`${spec.commit}^`, spec.path)).split("\n");
  const all = await hunks(spec.commit, spec.path);
  const states = spec.hist.map((_, i) => apply(base, all, spec.hist.slice(0, i + 1)));
  states.unshift(base);
  const done = states.at(-1)!;
  const steps: Step[] = [];

  if (spec.typed !== undefined) {
    // FIM-like: the user has typed the start of the target's first line
    const t = all[spec.target[0]!]!;
    const at = landing(all, spec.hist, spec.target[0]!);
    const first = t.newLines[0]!;
    const ind = indentOf(first);
    const n = Math.max(1, Math.round((first.length - ind) * spec.typed));
    const d = Math.max(1, Math.min(3, Math.floor(n / 4)));
    for (const k of [4, 3, 2, 1, 0].map((j) => j * d)) {
      const typed = Math.max(0, n - k);
      const line = first.slice(0, ind + typed);
      const cur = [...done.slice(0, at), line, ...done.slice(at)];
      steps.push({ states: [...states, cur], cursorLine: at, cursorCol: line.length });
    }
  } else {
    const lastIdx = spec.hist.at(-1)!;
    const h = all[lastIdx]!;
    const at = landing(all, spec.hist, lastIdx);
    const line = h.newLines.length ? at + h.newLines.length - 1 : at;
    const text = done[line] ?? "";
    const col = h.newLines.length ? text.trimEnd().length : 0;
    const room = col - indentOf(text);
    const d = Math.max(1, Math.min(3, Math.floor(room / 4)));
    for (const k of [4, 3, 2, 1, 0].map((j) => j * d)) {
      const cut = Math.min(k, room);
      const partial = text.slice(0, col - Math.max(0, cut)) + text.slice(col);
      const cur = [...done];
      cur[line] = partial;
      steps.push({ states: [...states.slice(0, -1), cur], cursorLine: line, cursorCol: col - Math.max(0, cut) });
    }
  }

  const rest = all.map((_, i) => i).filter((i) => !spec.hist.includes(i) && !spec.target.includes(i));
  const allowed = subsets(rest).map((s) => apply(base, all, [...spec.hist, ...spec.target, ...s]));
  const expected = apply(base, all, [...spec.hist, ...spec.target]);
  const dir = spec.path.slice(0, spec.path.lastIndexOf("/"));
  const names = (await $`git -C ${REPO} ls-tree --name-only ${spec.commit}^ ${dir}/`.quiet().text()).split("\n").filter((n) => /\.tsx?$/.test(n) && n !== spec.path).sort();
  const related: { path: string; text: string }[] = [];
  let size = 0;
  for (const n of names) {
    if (size > 20_000) break;
    const text = (await show(`${spec.commit}^`, n)).slice(0, 20_000 - size);
    related.push({ path: n, text });
    size += text.length;
  }
  return { ...spec, all, steps, allowed, expected, related };
}

export async function loadCases(file = new URL("./cases.json", import.meta.url).pathname): Promise<Case[]> {
  const specs: CaseSpec[] = await Bun.file(file).json();
  return Promise.all(specs.map(buildCase));
}

/** Common-prefix/suffix line diff of two file states: [start, endBefore, endAfter). */
export function changed(a: string[], b: string[]): [number, number, number] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [p, a.length - s, b.length - s];
}
