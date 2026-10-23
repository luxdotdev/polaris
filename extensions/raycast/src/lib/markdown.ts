/**
 * Markdown from text an agent or a Host wrote: escaped so it can't become an
 * image, a link or HTML (an image would load a URL as soon as it is shown).
 */
const SPECIAL = /[\\`*_{}[\]()#+\-.!|<>~&]/g;

/** One line of plain text: markdown escaped, newlines folded to spaces. */
export const plain = (text: string): string =>
  text.replaceAll(/\s*\n\s*/g, " ").replaceAll(SPECIAL, (char) => `\\${char}`);

/** A block quote of plain text, line by line. */
export const quote = (text: string): string =>
  text
    .split("\n")
    .map((line) => `> ${line.replaceAll(SPECIAL, (char) => `\\${char}`)}`)
    .join("\n");

/** A code block whose fence is longer than any run of backticks inside it. */
export const fence = (text: string): string => {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(Math.max(3, longest + 1));

  return `${ticks}text\n${text}\n${ticks}`;
};
