/** A file's own indentation, guessed from its leading whitespace, for new lines and the status bar. */

export interface Indent {
  readonly tabs: boolean;
  /** Spaces per level, or the tab width. */
  readonly width: number;
}

const SAMPLE_LINES = 2000;

/** Most-used indent step among the first lines; two spaces when nothing is indented. */
export const detectIndent = (text: string): Indent => {
  const lines = text.split("\n", SAMPLE_LINES);
  let tabs = 0;
  let spaces = 0;
  const steps = new Map<number, number>();
  let previous = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    if (line.startsWith("\t")) {
      tabs++;
      continue;
    }

    const width = line.length - line.trimStart().length;

    if (width > 0) spaces++;
    const step = Math.abs(width - previous);

    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = width;
  }

  if (tabs > spaces) return { tabs: true, width: 4 };
  let best = 2;
  let count = 0;

  for (const [step, n] of steps) {
    if (n > count || (n === count && step < best)) {
      best = step;
      count = n;
    }
  }

  return { tabs: false, width: best };
};

/** The status bar's words: "Spaces 2", "Tabs". */
export const indentLabel = (indent: Indent) => (indent.tabs ? "Tabs" : `Spaces ${indent.width}`);

export const lineSeparatorOf = (text: string): "\r\n" | "\n" => {
  const lf = text.indexOf("\n");

  return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
};
