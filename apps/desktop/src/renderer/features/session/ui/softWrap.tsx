/**
 * Text with a `<wbr>` every 64 characters inside long unbroken runs (hashes,
 * URLs, base64, minified JSON). `overflow-wrap: break-word` lays such a run out
 * by trying break points one by one: 6 KB costs ~25 ms, with the breaks ~1 ms.
 * Copying the text is unchanged: `<wbr>` adds no characters.
 */
import { Fragment, type ReactNode } from "react";

const RUN = 64;

const LONG_RUN = /\S{65,}/g;

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The text cut where a `<wbr>` goes; one piece when nothing needs breaking. */
export const softBreaks = (text: string): ReadonlyArray<string> => {
  const pieces: Array<string> = [];
  let from = 0;

  for (const match of text.matchAll(LONG_RUN)) {
    const runEnd = match.index + match[0].length;

    for (let cut = match.index + RUN; cut < runEnd; cut += RUN) {
      // Never between the halves of a surrogate pair.
      const at = isLowSurrogate(text.charCodeAt(cut)) ? cut - 1 : cut;

      pieces.push(text.slice(from, at));
      from = at;
    }
  }

  pieces.push(text.slice(from));

  return pieces;
};

export const softWrap = (text: string): ReactNode => {
  const pieces = softBreaks(text);

  if (pieces.length === 1) return text;

  return pieces.map((piece, n) => (
    <Fragment key={n}>
      {n > 0 ? <wbr /> : null}
      {piece}
    </Fragment>
  ));
};
