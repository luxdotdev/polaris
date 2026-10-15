// The probe policies compared in the reach study; "spec" is §4's rule as written.
import type { hardeningCases } from "../../../../packages/predict/src/edit/hardening.testing.ts";
import { reachFocuses, type ReachSignal } from "../../../../packages/predict/src/edit/reach/index.ts";

type Case = (typeof hardeningCases)[number];

const specBaseline = (c: Case, w: { from: number; to: number }) => {
  const last = c.history.at(-1)!;
  const words = (s: string) => s.match(/[$A-Z_a-z][$\w]*/g) ?? [];
  const after = words(last.after);
  const removed = new Set(words(last.before).filter((n) => !after.includes(n)));
  return [...c.buffer.matchAll(/[$A-Z_a-z][$\w]*/g)]
    .filter((m) => removed.has(m[0]) && (m.index < w.from || m.index >= w.to))
    .map((m) => m.index)
    .sort((a, b) => Math.abs(a - c.cursor) - Math.abs(b - c.cursor));
};

export const variants: Record<string, readonly ReachSignal[] | "spec"> = {
  spec: "spec",
  last: ["last"],
  "last+history": ["last", "history"],
  "orphan+last+history": ["orphan", "last", "history"],
  "+moved": ["orphan", "moved", "last", "history"],
  "+callee": ["orphan", "moved", "last", "callee", "history"], // the default
  "+signature": ["orphan", "moved", "last", "callee", "history", "signature"],
  "+kept": ["orphan", "moved", "last", "callee", "history", "kept"],
  all: ["orphan", "moved", "last", "callee", "history", "signature", "kept"],
};

export const focusesFor = (variant: string, c: Case, window: { from: number; to: number }) => {
  const signals = variants[variant]!;
  return signals === "spec" ? specBaseline(c, window) : reachFocuses({ ...c, window }, { signals });
};
