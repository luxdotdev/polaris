// oxlint JS plugin: Polaris's own rules, shared by every workspace.
// See packages/lint-config/README.md.

const MAX_PROSE_LINES = 2;

// Pointer lines carry no prose, so they don't count toward the cap.
const REFERENCE = /^\s*(?:See|Ref|Refs?:)\s|docs\/adr\/|https?:\/\/|^\s*[A-Z]{2,}-\d+\b/;

// Tooling directives are machine-readable, not prose.
const DIRECTIVE =
  /^\s*(?:eslint-|oxlint-|@ts-|prettier-ignore|oxfmt-ignore|v8 ignore|c8 ignore|istanbul |SAFETY\s*:)/;

const COMMENT_MARKER = /^\s*(?:\/\/+|\/\*+|\*+\/?|\*)\s?/;

const MESSAGE =
  `Comment carries more than ${MAX_PROSE_LINES} lines of prose. ` +
  "Source comments say what the code does or warn about a trap at this call site; " +
  "why it is this way belongs in an ADR. Move it to docs/adr/ and leave a one-line pointer.";

/** Whether one comment line carries prose: not blank, not a directive, not a reference. */
function isProse(line) {
  const text = line.replace(COMMENT_MARKER, "").trim();

  return text !== "" && !DIRECTIVE.test(text) && !REFERENCE.test(text);
}

/** Maps source offsets to 1-based line numbers. */
function lineIndex(text) {
  const starts = [0];

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }

  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;

    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;

      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }

    return lo + 1;
  };

  const ownsLine = (offset) => text.slice(starts[lineOf(offset) - 1], offset).trim() === "";

  return { lineOf, ownsLine };
}

/**
 * Groups a file's comments: each own-line block comment is a group, and so is
 * each unbroken run of own-line `//` comments. JSDoc and trailing comments
 * (code before them on the line) are never grouped.
 */
function commentGroups(text, comments) {
  const { lineOf, ownsLine } = lineIndex(text);
  const groups = [];
  let run = null;

  // A hashbang is neither a line nor a block comment.
  for (const comment of comments.filter((c) => c.type === "Line" || c.type === "Block")) {
    const [start, end] = comment.range;
    const startLine = lineOf(start);
    const isJsDoc = comment.type === "Block" && text.startsWith("/**", start);

    if (comment.type === "Block" || !ownsLine(start)) run = null;

    if (isJsDoc || !ownsLine(start)) continue;

    if (comment.type === "Block") {
      groups.push({ lines: comment.value.split("\n"), startLine, endLine: lineOf(end) });
    } else if (run !== null && startLine === run.endLine + 1) {
      run.lines.push(comment.value);
      run.endLine = startLine;
    } else {
      run = { lines: [comment.value], startLine, endLine: startLine };
      groups.push(run);
    }
  }

  return groups;
}

function checkFile(context) {
  const sourceCode = context.sourceCode;
  const comments = sourceCode.getAllComments() ?? [];

  for (const group of commentGroups(sourceCode.getText(), comments)) {
    if (group.lines.filter(isProse).length <= MAX_PROSE_LINES) continue;

    context.report({
      message: MESSAGE,
      loc: {
        start: { line: group.startLine, column: 0 },
        end: { line: group.endLine, column: 1 },
      },
    });
  }
}

export default {
  meta: { name: "polaris" },
  rules: {
    "no-long-comment": {
      meta: {
        type: "suggestion",
        docs: {
          description: `Cap source comments at ${MAX_PROSE_LINES} lines of prose; longer rationale belongs in an ADR.`,
        },
      },
      create(context) {
        return {
          Program() {
            checkFile(context);
          },
        };
      },
    },
  },
};
