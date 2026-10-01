/**
 * What other Review slices plug into the view (M2-F findings and comments, M2-K the Review
 * Checkout chip, M2-A accepting Turns), and what the view tells them. The view owns layout,
 * the diff and the file list; each slot owns what renders inside it.
 */
import type { ReviewCheckout, RiskFinding } from "@polaris/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import type { Plain } from "../../store/plain.ts";
import type { ReviewSubject } from "../../routes/review.ts";
import type { ReviewFile } from "./model/layout.ts";

/** What every slot gets: the subject, and the checkout behind a pull request's diff. */
export interface ReviewSlotProps {
  readonly subject: ReviewSubject;
  /** Null for an Agent Session, or a pull request with no Review Checkout yet. */
  readonly checkout: { readonly hostKey: string; readonly checkout: Plain<ReviewCheckout> } | null;
}

/** A line or range in the diff, as Pierre selects it. */
export interface DiffRange {
  readonly path: string;
  readonly side: "new" | "old";
  readonly start: number;
  readonly end: number;
}

/** A selection with the code it covers, as the diff shows it (quoted in feedback). */
export interface DiffSelection extends DiffRange {
  readonly code: string;
}

/**
 * The inset of a row under a line: indented to the code, and clear of the file card's
 * right edge (Pierre's annotation slot runs 12px past the card, under the page padding).
 */
export const ANNOTATION_INSET = "pl-[78px] pr-[calc(var(--spacing-panel)+12px)]";

/** A row under a line in the diff (a comment thread, a draft, a composer). */
export interface ReviewAnnotation {
  /** Stable across renders. */
  readonly id: string;
  readonly path: string;
  readonly side: "new" | "old";
  /** 0 is file-level. */
  readonly line: number;
  readonly render: () => ReactNode;
}

export interface ReviewSlots {
  /** Header, right: the Review Checkout chip and its menu (Paper R4, R5; M2-K). */
  readonly CheckoutChip: ComponentType<ReviewSlotProps>;
  /** Header, far right: the one primary action ("Submit review", "Accept and open PR"). */
  readonly PrimaryAction: ComponentType<ReviewSlotProps>;
  /** The risk column above the file list: the Risk Summary and its findings (M2-F). */
  readonly RiskColumn: ComponentType<ReviewSlotProps>;
  /** The risk column's foot: "Ask the reviewer", feedback for the next Turn (M2-F). */
  readonly RiskFooter: ComponentType<ReviewSlotProps>;
}

const Nothing = () => null;

/** The primary action per subject kind: M2-F's "Submit review" for a pull request, M2-A's accept. */
const primaryActions: Partial<Record<ReviewSubject["kind"], ComponentType<ReviewSlotProps>>> = {};

/** Renders the primary action registered for the subject's kind. */
const PrimaryAction = (props: ReviewSlotProps) => {
  const Action = primaryActions[props.subject.kind];

  return Action === undefined ? null : createElement(Action, props);
};

/** Registers one kind's primary action without replacing the other's. */
export const fillPrimaryAction = (
  kind: ReviewSubject["kind"],
  Action: ComponentType<ReviewSlotProps>
) => {
  primaryActions[kind] = Action;
};

/** Defaults until the slices land; a slice swaps its own in with `fillReviewSlots`. */
interface SlotRegistry {
  current: ReviewSlots;
}

export const reviewSlots: SlotRegistry = {
  current: {
    CheckoutChip: Nothing,
    PrimaryAction,
    RiskColumn: Nothing,
    RiskFooter: Nothing,
  },
};

export const fillReviewSlots = (slots: Partial<ReviewSlots>) => {
  reviewSlots.current = { ...reviewSlots.current, ...slots };
};

/**
 * What a slice shows in the diff, per Review subject (`subjectKey`): Risk Findings (gutter
 * marks, reason rows, header badges) and annotations. The view reads it; slices write it.
 */
export interface ReviewSurface {
  readonly findings: ReadonlyArray<Plain<RiskFinding>>;
  readonly annotations: ReadonlyArray<ReviewAnnotation>;
  /** The finding the risk column selected; the diff scrolls to it and expands its reason. */
  readonly selectedFinding: string | null;
  /** Lines the user selected in the diff (the composer opens under them, M2-F). */
  readonly selection: DiffSelection | null;
  /** The code of a range in the diff as it shows it (lines it doesn't hold are skipped). */
  readonly quote: ((range: DiffRange) => string) | null;
}

const emptySurface: ReviewSurface = {
  findings: [],
  annotations: [],
  selectedFinding: null,
  selection: null,
  quote: null,
};

export const surfaceStore = createStore<Readonly<Record<string, ReviewSurface>>>(() => ({}));

export const surfaceOf = (key: string): ReviewSurface =>
  surfaceStore.getState()[key] ?? emptySurface;

export const updateSurface = (key: string, patch: Partial<ReviewSurface>) =>
  surfaceStore.setState((s) => ({ [key]: { ...(s[key] ?? emptySurface), ...patch } }));

export { emptySurface };

/** A Review subject's key in the surface store and the Viewed book. */
export const subjectKey = (subject: ReviewSubject) =>
  subject.kind === "pull"
    ? `pull:${subject.pull.repo.owner}/${subject.pull.repo.name}#${subject.pull.number}`.toLowerCase()
    : `session:${subject.hostKey}:${subject.sessionId}`;

/** Asks the diff to show a place: the file opens and scrolls there. */
export interface RevealRequest {
  readonly path: string;
  readonly side: "new" | "old";
  readonly line: number;
  /** Bumped per request, so asking for the same place twice scrolls again. */
  readonly nonce: number;
}

export const revealStore = createStore<{ readonly request: RevealRequest | null }>(() => ({
  request: null,
}));

let nonce = 0;

/** Scrolls the open Review's diff to `path:line` (a finding or comment clicked in the risk column). */
export const revealInDiff = (path: string, line: number, side: "new" | "old" = "new") => {
  nonce += 1;
  revealStore.setState({ request: { path, side, line, nonce } });
};

/** The files of the open Review, for the risk column (file:line links, counts). */
export type { ReviewFile };
