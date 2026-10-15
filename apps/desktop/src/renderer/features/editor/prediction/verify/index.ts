/**
 * The diagnostics verifier (docs/research/next-edit-spike.md, "Diagnostics verifier"): before a
 * model Final shows, the file's language server checks the edited text on a shadow document and
 * the prediction is suppressed if it adds an error. The language coordinator provides
 * `diagnosticsVerifier` per view; without one, or without a capable server, nothing is checked.
 */
import { Facet, type Text } from "@codemirror/state";
import type { DiagnosticsVerdict } from "@polaris/predict";
import type { PredictedEdit } from "@polaris/protocol";

/** Measured in the live Editor; see the research doc's "Wiring" section. */
export const VERIFY_DEADLINE_MS = 1000;

export interface VerifyInput {
  /** The buffer the prediction was made for; the user's document must still be at it. */
  readonly doc: Text;
  readonly edits: ReadonlyArray<PredictedEdit>;
  readonly cursor: number;
}

export interface DiagnosticsVerifier {
  /** A server that can check this buffer is attached, so a check that cannot finish fails closed. */
  readonly attached: (doc: Text) => boolean;
  /** The verdict, or null when the server failed rather than ran late (the check fails open). */
  readonly verify: (input: VerifyInput, signal: AbortSignal) => Promise<DiagnosticsVerdict | null>;
}

export const diagnosticsVerifier = Facet.define<DiagnosticsVerifier, DiagnosticsVerifier | null>({
  combine: (values) => values[0] ?? null,
});

/** How long a Final waits for the check; past it, an attached server's silence suppresses. */
export const verifyDeadline = Facet.define<number, number>({
  combine: (values) => values[0] ?? VERIFY_DEADLINE_MS,
});

/** `cancelled` when `signal` aborted first: the caller drops the prediction without a record. */
export type VerifyOutcome = "allow" | "diagnostics" | "diagnostics-deadline" | "cancelled";

/** Runs the check under the deadline; the verifier's own work is aborted however it ends. */
export const verifyPrediction = async (
  verifier: DiagnosticsVerifier | null,
  input: VerifyInput,
  signal: AbortSignal,
  deadlineMs: number
): Promise<VerifyOutcome> => {
  if (signal.aborted) return "cancelled";

  if (verifier === null || !verifier.attached(input.doc)) return "allow";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};

  const late = new Promise<"diagnostics-deadline">((resolve) => {
    timer = setTimeout(() => resolve("diagnostics-deadline"), deadlineMs);
  });

  const cancelled = new Promise<"cancelled">((resolve) => {
    cancel = () => resolve("cancelled");
    signal.addEventListener("abort", cancel, { once: true });
  });

  const checked = verifier.verify(input, controller.signal).then(
    (verdict): VerifyOutcome => (verdict === null || verdict.allow ? "allow" : "diagnostics"),
    (): VerifyOutcome => "allow"
  );

  try {
    return await Promise.race([checked, late, cancelled]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    controller.abort();
  }
};
