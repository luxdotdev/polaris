/**
 * Link another Mac's sheet (Paper MX-AU) as Hosts opens and closes it. Each opening is a new
 * round, so a sheet that linked or failed before starts again at the scanner.
 */
import { useState } from "react";

export interface LinkAnother {
  readonly open: boolean;
  /** Keys the scan sheet: a new round mounts a fresh one. */
  readonly round: number;
}

export const CLOSED: LinkAnother = { open: false, round: 0 };

export const opened = ({ open, round }: LinkAnother): LinkAnother =>
  open ? { open, round } : { open: true, round: round + 1 };

export const closed = ({ round }: LinkAnother): LinkAnother => ({ open: false, round });

export const useLinkAnother = (initiallyOpen: boolean) => {
  const [sheet, setSheet] = useState(initiallyOpen ? opened(CLOSED) : CLOSED);

  return {
    sheet,
    open: () => setSheet(opened),
    close: () => setSheet(closed),
  };
};
