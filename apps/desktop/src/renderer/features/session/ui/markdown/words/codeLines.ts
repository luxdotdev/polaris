/**
 * Which lines of Markdown are code: fenced (nested in quotes and list items, or still open while
 * streaming) or indented. A CommonMark approximation that errs towards code when unsure.
 */

const QUOTE = /^ {0,3}> ?/;

const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?: +|$)/;

const FENCE = /^(`{3,}|~{3,})(.*)$/;

interface Line {
  /** How many quotes (`>`) contain it. */
  readonly depth: number;
  /** Columns of indentation inside its quotes, tabs as four. */
  readonly indent: number;
  /** The line without its quotes and indentation. */
  readonly body: string;
}

interface Fence {
  readonly marker: string;
  readonly depth: number;
  /** The content column of the list item that holds it; 0 outside lists. */
  readonly indent: number;
}

const expand = (text: string) => text.replace(/^[ \t]+/, (space) => space.replaceAll("\t", "    "));

const parse = (raw: string): Line => {
  let rest = expand(raw);
  let depth = 0;

  for (let quote = QUOTE.exec(rest); quote !== null; quote = QUOTE.exec(rest)) {
    rest = expand(rest.slice(quote[0].length));
    depth += 1;
  }

  const body = rest.trimStart();

  return { depth, indent: rest.length - body.length, body };
};

const closes = (body: string, fence: Fence): boolean => {
  const match = FENCE.exec(body);

  return (
    match !== null &&
    match[1]?.[0] === fence.marker[0] &&
    (match[1]?.length ?? 0) >= fence.marker.length &&
    (match[2] ?? "").trim() === ""
  );
};

/** Feed it the lines in order; it says which are code. */
export class CodeLines {
  private fence: Fence | null = null;
  /** The content column of the open list item; 0 outside lists. */
  private list = 0;
  /** After a blank line or a block that can't continue (a fence): no paragraph is open. */
  private afterBlank = true;
  private inIndentedCode = false;

  isCode(raw: string): boolean {
    const line = parse(raw);
    const blank = line.body === "";

    if (this.fence !== null && this.stillFenced(line, blank)) {
      this.afterBlank = true;

      return true;
    }

    const code = blank ? this.inIndentedCode : this.classify(line);
    this.afterBlank = blank;

    return code;
  }

  /** In an open fence: true while it holds this line, closing it on its closing marker. */
  private stillFenced(line: Line, blank: boolean): boolean {
    const fence = this.fence;

    if (fence === null) return false;

    // The quote or list item that held the fence has ended, and the fence with it.
    if (line.depth < fence.depth || (!blank && line.indent < fence.indent)) {
      this.fence = null;

      return false;
    }

    if (closes(line.body, fence)) this.fence = null;

    return true;
  }

  private classify(line: Line): boolean {
    if (line.indent >= this.list + 4 && (this.afterBlank || this.inIndentedCode)) {
      this.inIndentedCode = true;

      return true;
    }

    this.inIndentedCode = false;
    const item = LIST_ITEM.exec(line.body);

    if (item !== null) this.list = line.indent + item[0].length;
    else if (this.afterBlank && line.indent < this.list) this.list = 0;

    const content = item === null ? line.body : line.body.slice(item[0].length).trimStart();
    const marker = FENCE.exec(content)?.[1];

    if (marker === undefined || (marker[0] === "`" && content.slice(marker.length).includes("`")))
      return false;

    this.fence = { marker, depth: line.depth, indent: this.list };

    return true;
  }
}
