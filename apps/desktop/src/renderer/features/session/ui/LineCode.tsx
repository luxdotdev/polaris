/**
 * A Changes line's code: plain until its file's colours are ready, then the same text in
 * spans coloured by the syntax tokens (DESIGN.md, rule/syntax-is-moonlit), so nothing moves.
 * Unwrapped, it is clipped at the card's edge and moved by its file's sideways scroll
 * (fileScroll.ts); View → Word wrap wraps it onto more rows instead.
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
  /** Unwrapped, the code span the file's sideways scroll moves; returns its cleanup. */
  readonly onCode: (span: HTMLElement) => () => void;
}

export const LineCode = ({ text, runs, wrap, onCode }: LineCodeProps) => {
  const code = runs === undefined ? text : <SyntaxRuns runs={runs} />;

  if (wrap)
    return (
      <span className="text-text-default min-w-0 flex-1 wrap-break-word whitespace-pre-wrap">
        {code}
      </span>
    );

  return (
    <span className="min-w-0 flex-1 overflow-clip">
      <span ref={onCode} className="text-text-default inline-block whitespace-pre">
        {code}
      </span>
    </span>
  );
};
