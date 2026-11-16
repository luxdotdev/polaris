/**
 * A Changes line's code: plain until its file's colours are ready, then the same text in
 * spans coloured by the syntax tokens (DESIGN.md, rule/syntax-is-moonlit), so nothing moves.
 * Unwrapped, the list scrolls sideways to its end; View → Word wrap wraps it onto more rows.
 */
import { cn } from "@polaris/ui";
import type { LineRuns, SyntaxGroup } from "../diffSyntax.ts";

const COLOUR: Record<SyntaxGroup, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  type: "text-syntax-type",
  function: "text-syntax-function",
  comment: "text-syntax-comment",
  punctuation: "text-syntax-punctuation",
};

/** Runs as coloured spans; plain runs stay bare text. */
export const SyntaxRuns = ({ runs }: { readonly runs: LineRuns }) =>
  runs.map((run, i) =>
    run.group === null ? (
      run.text
    ) : (
      <span key={i} className={COLOUR[run.group]}>
        {run.text}
      </span>
    )
  );

interface LineCodeProps {
  readonly text: string;
  readonly runs: LineRuns | undefined;
  readonly wrap: boolean;
}

export const LineCode = ({ text, runs, wrap }: LineCodeProps) => (
  <span
    className={cn(
      "text-text-default flex-1",
      wrap ? "wrap-break-word min-w-0 whitespace-pre-wrap" : "whitespace-pre"
    )}
  >
    {runs === undefined ? text : <SyntaxRuns runs={runs} />}
  </span>
);
