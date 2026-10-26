/**
 * Fenced code blocks in Markdown, read line by line as CommonMark does: an opening fence
 * (any info string) closes only at a bare fence of the same character, at least as long.
 * Agents reply with a JSON document in one; finding it by regex mis-pairs fences (ENG-447).
 */

export interface FencedBlock {
  /** The info string's first word, e.g. "json"; "" when there is none. */
  readonly lang: string;
  readonly body: string;
  /** The block's span in the text, fences included. */
  readonly start: number;
  readonly end: number;
}

const OPENING = /^ {0,3}(`{3,}|~{3,})([^`]*)$/;

const closes = (line: string, fence: string) => {
  const trimmed = line.trim();

  return (
    line.search(/\S/) <= 3 &&
    trimmed.length >= fence.length &&
    trimmed === (fence[0] ?? "").repeat(trimmed.length)
  );
};

interface Open {
  readonly fence: string;
  readonly lang: string;
  readonly start: number;
  readonly bodyStart: number;
}

/** Every fenced block in the text, in order; one left open runs to the end. */
export const fencedBlocks = (text: string): Array<FencedBlock> => {
  const blocks: Array<FencedBlock> = [];
  let open: Open | null = null;
  let offset = 0;

  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;

    if (open === null) {
      const match = OPENING.exec(line);

      if (match !== null) {
        const lang = (match[2] ?? "").trim().split(/\s+/)[0] ?? "";

        open = { fence: match[1] ?? "", lang, start: offset, bodyStart: lineEnd + 1 };
      }
    } else if (closes(line, open.fence)) {
      blocks.push({
        lang: open.lang,
        body: text.slice(open.bodyStart, Math.max(open.bodyStart, offset - 1)),
        start: open.start,
        end: lineEnd,
      });
      open = null;
    }

    offset = lineEnd + 1;
  }

  if (open !== null) {
    blocks.push({
      lang: open.lang,
      body: text.slice(Math.min(open.bodyStart, text.length)),
      start: open.start,
      end: text.length,
    });
  }

  return blocks;
};
