/** Splits a sheet's children into the pinned header and footer and the body that scrolls. */
import { Children, isValidElement, type ReactNode } from "react";
import type { ThemeName } from "../theme";
import { SheetHeader, StatusFooter } from "./parts.tsx";

export interface SheetSections {
  readonly header: ReactNode[];
  readonly body: ReactNode[];
  readonly footer: ReactNode[];
}

export const sections = (children: ReactNode): SheetSections => {
  const header: ReactNode[] = [];
  const body: ReactNode[] = [];
  const footer: ReactNode[] = [];

  for (const child of Children.toArray(children)) {
    if (isValidElement(child) && child.type === SheetHeader) header.push(child);
    else if (isValidElement(child) && child.type === StatusFooter) footer.push(child);
    else body.push(child);
  }

  return { header, body, footer };
};

/** MX-H's dim behind the sheet, per theme. */
export const SCRIM: Record<ThemeName, string> = {
  midnight: "#000000a6",
  moonlit: "#0b0c0eb3",
};

/** The sheet's top edge and grabber: white at 12% and 20% (MX-H). */
export const SHEET_EDGE = "#ffffff1f";

export const GRABBER = "#ffffff33";
