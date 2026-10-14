// Prompt formats, from the model cards only (Zed's source is GPL and was not read):
// - Zeta 2.1: huggingface.co/zed-industries/zeta-2.1 README + sample.prompt/sample.output.
// - Sweep Next-Edit 1.5B: huggingface.co/sweepai/sweep-next-edit-1.5B run_model.py + blog.sweep.dev/posts/oss-next-edit.
// - Mellum2 FIM: @polaris/predict's buildPrompt (the v1 path).
import { buildPrompt, generationBudget, postprocess } from "../../../../packages/predict/src/index.ts";
import { changed, type Case, type Step } from "./build.ts";

export type Built = {
  prompt: string;
  stop: string[];
  nPredict: number;
  /** The whole predicted file after applying the model's output (null = abstained/unparseable). */
  apply: (out: string) => string[] | null;
  /** Lines the model was allowed to rewrite, in current-file coordinates. */
  window: [number, number];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const current = (s: Step) => s.states.at(-1)!;

/** Unified diff of one edit event, 3 lines of context, as in Zeta's sample edit_history. */
function unified(path: string, a: string[], b: string[]): string {
  const [p, ea, eb] = changed(a, b);
  const lo = Math.max(0, p - 3);
  const ha = Math.min(a.length, ea + 3), hb = Math.min(b.length, eb + 3);
  const body = [
    ...a.slice(lo, p).map((l) => " " + l),
    ...a.slice(p, ea).map((l) => "-" + l),
    ...b.slice(p, eb).map((l) => "+" + l),
    ...a.slice(ea, ha).map((l) => " " + l),
  ];
  return [`--- a/${path}`, `+++ b/${path}`, `@@ -${lo + 1},${ha - lo} +${lo + 1},${hb - lo} @@`, ...body].join("\n");
}

export const zetaHistory = (c: Case, s: Step) =>
  s.states.slice(1).map((b, i) => unified(c.path, s.states[i]!, b)).join("\n");

export function zeta(c: Case, s: Step, frozen = false): Built {
  const cur = current(s);
  const n = cur.length, k = s.cursorLine;
  // Geometry copied from the card's sample: two ~15-line regions, cursor near the end of region 1.
  const r1 = clamp(k - 13, 0, k), r2 = clamp(k + 3, k + 1, n), r3 = clamp(k + 16, r2, n);
  const ctx = clamp(r1 - 40, 0, r1);
  const lines = [...cur];
  const L = lines[k]!;
  lines[k] = L.slice(0, s.cursorCol) + "<|user_cursor|>" + L.slice(s.cursorCol);
  const before = lines.slice(ctx, r1).join("\n");
  const reg1 = lines.slice(r1, r2).join("\n");
  const reg2 = lines.slice(r2, r3).join("\n");
  const excerpt = (before ? before + "\n" : "") + "<|marker_1|>" + reg1 + "\n" + (r3 > r2 ? "<|marker_2|>" + reg2 + "<|marker_3|>" : "<|marker_2|>");
  const prompt = `<[fim-suffix]>\n<[fim-prefix]><filename>edit_history\n${zetaHistory(c, frozen ? c.steps[0]! : s)}\n\n<filename>${c.path}\n${excerpt}\n<[fim-middle]>`;
  const bounds = r3 > r2 ? [r1, r2, r3] : [r1, r2];
  return {
    prompt,
    stop: ["<[end▁of▁sentence]>", "<[fim-"],
    nPredict: 512,
    window: [r1, bounds.at(-1)!],
    apply: (out) => {
      // a marker repeated with nothing between (`<|marker_1|><|marker_1|>`) is read as "no edit"
      const re = /<\|marker_(\d+)\|>([\s\S]*?)(?=<\|marker_(\d+)\|>)/g;
      const edits: [number, string[]][] = [];
      for (const m of out.matchAll(re)) {
        const a = Number(m[1]), b = Number(m[3]);
        if (b !== a + 1 || a < 1 || b > bounds.length) continue;
        let body = m[2]!.replace("<|user_cursor|>", "");
        if (body.endsWith("\n")) body = body.slice(0, -1);
        edits.push([a - 1, body.split("\n")]);
      }
      if (!edits.length) return null;
      const result = [...cur];
      for (const [i, body] of edits.sort((x, y) => y[0] - x[0])) result.splice(bounds[i]!, bounds[i + 1]! - bounds[i]!, ...body);
      return result;
    },
  };
}

export function sweep(c: Case, s: Step, diffLast = false, related = false): Built {
  const cur = current(s);
  const n = cur.length, k = s.cursorLine;
  const lo = clamp(k - 10, 0, n), hi = clamp(k + 11, 0, n);
  const prev = s.states.at(-2)!;
  // the window in the state before the most recent change
  const [p, ea, eb] = changed(prev, cur);
  const shift = ea - eb;
  const olo = lo <= p ? lo : clamp(lo + shift, p, prev.length);
  const ohi = hi <= p ? hi : clamp(hi + shift, olo, prev.length);
  const parts = [...(related ? c.related.flatMap((r) => [`<|file_sep|>${r.path}`, r.text]) : []), `<|file_sep|>${c.path}`, cur.slice(clamp(k - 80, 0, lo), lo).join("\n")];
  for (let i = 1; i < s.states.length - (diffLast ? 0 : 1); i++) {
    const a = s.states[i - 1]!, b = s.states[i]!;
    const [q, fa, fb] = changed(a, b);
    parts.push(`<|file_sep|>${c.path}.diff`, "original:", a.slice(Math.max(0, q - 1), fa + 1).join("\n"), "updated:", b.slice(Math.max(0, q - 1), fb + 1).join("\n"));
  }
  parts.push(`<|file_sep|>original/${c.path}`, prev.slice(olo, ohi).join("\n"), `<|file_sep|>current/${c.path}`, cur.slice(lo, hi).join("\n"), `<|file_sep|>updated/${c.path}`);
  return {
    prompt: parts.join("\n"),
    stop: ["<|file_sep|>", "</s>", "<|endoftext|>"],
    nPredict: 512,
    window: [lo, hi],
    apply: (out) => {
      let body = out.replace(/^\n/, "");
      if (body.endsWith("\n")) body = body.slice(0, -1);
      if (!body.trim()) return null;
      return [...cur.slice(0, lo), ...body.split("\n"), ...cur.slice(hi)];
    },
  };
}

export function mellum(c: Case, s: Step, frozen = false, budgetTokens = 2048): Built {
  const cur = current(s);
  const k = s.cursorLine;
  const prefix = [...cur.slice(0, k), cur[k]!.slice(0, s.cursorCol)].join("\n");
  const suffix = [cur[k]!.slice(s.cursorCol), ...cur.slice(k + 1)].join("\n");
  const h = frozen ? c.steps[0]! : s;
  const context = h.states.slice(1).map((b, i) => ({ kind: "editHunk" as const, source: c.path, text: unified(c.path, h.states[i]!, b) }));
  const budget = generationBudget(prefix, 64, 8);
  const built = buildPrompt({
    context, path: c.path, prefix, suffix, model: "mellum", format: "mellum-spm",
    endpoint: { kind: "openai", url: "http://127.0.0.1" }, budgetTokens, maxTokens: budget.maxTokens, maxLines: budget.maxLines,
  });
  return {
    prompt: built.prompt,
    stop: [...built.stop, ...(budget.singleLine ? ["\n"] : [])],
    nPredict: budget.maxTokens,
    window: [k, k + 1],
    apply: (out) => {
      const text = postprocess(out, suffix, built.stop, budget.maxLines);
      if (!text) return null;
      return (prefix + text + suffix).split("\n");
    },
  };
}

export const FORMATS = {
  zeta: (c: Case, s: Step) => zeta(c, s),
  /** edit history snapshotted at the first keystroke of the burst, so the prompt prefix stays cached */
  "zeta-frozen": (c: Case, s: Step) => zeta(c, s, true),
  sweep: (c: Case, s: Step) => sweep(c, s),
  /** experiment: the most recent change also as a .diff block (run_model.py leaves it out) */
  "sweep-difflast": (c: Case, s: Step) => sweep(c, s, true),
  /** card-sized prompt: ~20 KB of sibling files as <|file_sep|> context first */
  "sweep-related": (c: Case, s: Step) => sweep(c, s, false, true),
  mellum: (c: Case, s: Step) => mellum(c, s),
  "mellum-frozen": (c: Case, s: Step) => mellum(c, s, true),
  /** a budget large enough that the prefix is never trimmed at the front, so it stays cached */
  "mellum-frozen-16k": (c: Case, s: Step) => mellum(c, s, true, 16384),
} as const;
export type Format = keyof typeof FORMATS;
