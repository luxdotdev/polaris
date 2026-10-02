/**
 * One inline card's life, as pure transitions: a draft prompt, a request running against the
 * exact buffer it sent, then a proposal (with changes), an answer (no changes), a failure, or
 * stale when the buffer moved on before the proposal could apply.
 */
import type { InlineRequest } from "@polaris/protocol";
import {
  changesLabel,
  checkedReplacements,
  hunksOf,
  type InlinePatch,
  statsOf,
  thoughtLabel,
} from "./patch.ts";

export type InlineHarness = "codex" | "claude";

export const INLINE_HARNESSES: ReadonlyArray<InlineHarness> = ["claude", "codex"];

export const isInlineHarness = (kind: string): kind is InlineHarness =>
  INLINE_HARNESSES.some((h) => h === kind);

/** What `inline.propose` is sent: the exact buffer, the selection as UTF-16 offsets into it. */
export type { InlineRequest };

export type CardPhase =
  | { readonly kind: "draft" }
  | {
      readonly kind: "running";
      readonly request: InlineRequest;
      /** The card's buffer version the request was made at. */
      readonly version: number;
      readonly startedAt: number;
      /** Provisional Harness text, shown while it thinks; never applied. */
      readonly text: string;
    }
  | {
      readonly kind: "proposed";
      readonly request: InlineRequest;
      readonly patch: InlinePatch;
      readonly thoughtMs: number;
    }
  | { readonly kind: "failed"; readonly message: string; readonly request: InlineRequest | null }
  | { readonly kind: "stale"; readonly request: InlineRequest };

export interface CardSession {
  readonly prompt: string;
  readonly harness: InlineHarness;
  readonly model: string | null;
  readonly effort: string | null;
  readonly phase: CardPhase;
}

export const draftCard = (harness: InlineHarness): CardSession => ({
  prompt: "",
  harness,
  model: null,
  effort: null,
  phase: { kind: "draft" },
});

/** Why a proposal can't apply to the request's buffer, or null when it can. */
export const patchProblem = (request: InlineRequest, patch: InlinePatch): string | null => {
  const replacements = checkedReplacements(patch, request.content.length);

  if (replacements === null) return "The proposal's changes overlap or run past the file";
  const { from, to } = request.selection;

  if (replacements.some((r) => r.from < from || r.to > to))
    return "The proposal reached outside the selected lines";

  return null;
};

/** The proposal as it lands: checked against the buffer it was made for. */
export const landed = (
  phase: Extract<CardPhase, { kind: "running" }>,
  patch: InlinePatch,
  thoughtMs: number,
  currentVersion: number | null
): CardPhase => {
  if (currentVersion !== phase.version) return { kind: "stale", request: phase.request };
  const problem = patchProblem(phase.request, patch);

  if (problem !== null) return { kind: "failed", message: problem, request: phase.request };

  return { kind: "proposed", request: phase.request, patch, thoughtMs };
};

export interface Footer {
  /** "1 change", "No changes". */
  readonly changes: string;
  readonly added: number;
  readonly removed: number;
  /** "Thought for 4s". */
  readonly thought: string;
}

export const footerOf = (phase: Extract<CardPhase, { kind: "proposed" }>): Footer => {
  const replacements = checkedReplacements(phase.patch, phase.request.content.length) ?? [];
  const stats = statsOf(hunksOf(phase.request.content, replacements));

  return {
    changes: stats.changes === 0 ? "No changes" : changesLabel(stats.changes),
    added: stats.added,
    removed: stats.removed,
    thought: thoughtLabel(phase.thoughtMs),
  };
};

/** A proposal with no changes is an answer: the card shows its summary instead of a diff. */
export const isAnswer = (phase: CardPhase) =>
  phase.kind === "proposed" && phase.patch.replacements.length === 0;
