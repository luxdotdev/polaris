/**
 * A terminal's output as plain text for the line-mode terminal: escape
 * sequences (colours, cursor moves, titles) dropped, CRLF as a newline, and a
 * lone carriage return starting its line over, as a progress line does.
 */

const ESC = String.fromCharCode(27);

const BEL = String.fromCharCode(7);

const OSC = `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`;

const CSI = `${ESC}\\[[0-?]*[ -/]*[@-~]`;

const SHORT = `${ESC}[@-Z\\\\-_]`;

const ESCAPES = new RegExp(`${OSC}|${CSI}|${SHORT}`, "g");

/** An escape cut off at the end of the output so far; the next chunk completes it. */
const UNFINISHED = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*|\\][^${BEL}${ESC}]*)?$`);

export const plainText = (raw: string): string =>
  raw
    .replace(ESCAPES, "")
    .replace(UNFINISHED, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1))
    .join("\n");
