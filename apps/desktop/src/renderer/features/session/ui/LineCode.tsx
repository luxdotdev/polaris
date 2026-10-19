/**
 * A Changes line's code: plain until its file's colours are ready, then the same text in
 * spans coloured by the syntax tokens (DESIGN.md, rule/syntax-is-moonlit), so nothing moves.
 */
import type { LineRuns, SyntaxGroup } from "../diffSyntax.ts";

const COLOUR: Record<SyntaxGroup, string> = {
  keyword: "text-syntax-keyword",
  string: "text-syntax-string",
  type: "text-syntax-type",
  function: "text-syntax-function",
  comment: "text-syntax-comment",
  punctuation: "text-syntax-punctuation",
};

export const LineCode = ({ text, runs }: { text: string; runs: LineRuns | undefined }) => (
  <span className="text-text-default flex-1 truncate whitespace-pre">
    {runs === undefined
      ? text
      : runs.map((run, i) =>
          run.group === null ? (
            run.text
          ) : (
            <span key={i} className={COLOUR[run.group]}>
              {run.text}
            </span>
          )
        )}
  </span>
);
