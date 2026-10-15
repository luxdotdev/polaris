// Git helpers for the next-edit spike: zero-context hunks of one file in one commit,
// and applying any subset of them to the parent version.
import { $ } from "bun";

export const REPO = process.env.SPIKE_REPO ?? new URL("../../../../", import.meta.url).pathname;

export type Hunk = { oldStart: number; oldLines: string[]; newLines: string[] };

export async function show(rev: string, path: string): Promise<string> {
  return await $`git -C ${REPO} show ${rev}:${path}`.quiet().text();
}

export async function hunks(commit: string, path: string): Promise<Hunk[]> {
  const diff = await $`git -C ${REPO} diff -U0 --no-color ${commit}^ ${commit} -- ${path}`.quiet().text();
  const out: Hunk[] = [];
  let cur: Hunk | undefined;
  for (const line of diff.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      // with zero old lines, git reports the line *before* the insertion
      const oldStart = oldCount === 0 ? Number(m[1]) : Number(m[1]) - 1;
      cur = { oldStart, oldLines: [], newLines: [] };
      out.push(cur);
    } else if (cur && line.startsWith("-") && !line.startsWith("---")) cur.oldLines.push(line.slice(1));
    else if (cur && line.startsWith("+") && !line.startsWith("+++")) cur.newLines.push(line.slice(1));
  }
  return out;
}

/** Applies the chosen hunks (indices into `all`, which are in parent coordinates). */
export function apply(base: string[], all: Hunk[], chosen: number[]): string[] {
  const set = new Set(chosen);
  const out: string[] = [];
  let i = 0;
  all.forEach((h, k) => {
    if (!set.has(k)) return;
    while (i < h.oldStart) out.push(base[i++]!);
    out.push(...h.newLines);
    i += h.oldLines.length;
  });
  while (i < base.length) out.push(base[i++]!);
  return out;
}

/** Line in the edited file where hunk `k` lands, given the chosen hunks already applied. */
export function landing(all: Hunk[], chosen: number[], k: number): number {
  let delta = 0;
  for (const j of chosen) if (all[j]!.oldStart < all[k]!.oldStart) delta += all[j]!.newLines.length - all[j]!.oldLines.length;
  return all[k]!.oldStart + delta;
}
