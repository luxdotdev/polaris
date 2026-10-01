/** The checkout menu's building blocks (Paper R4 89C-0): sections, headings, wells, rows. */
import { Button, cn } from "@polaris/ui";
import type { ReactNode } from "react";

export const Section = ({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId: string;
}) => (
  <div data-testid={testId} className="gap-row-x flex flex-col p-3.5">
    {children}
  </div>
);

export const Heading = ({ title, fact }: { readonly title: string; readonly fact: string }) => (
  <div className="flex flex-col gap-0.5">
    <p className="text-body text-text-strong font-medium">{title}</p>
    <p className="text-caption text-text-subtle">{fact}</p>
  </div>
);

export const Well = ({ children }: { readonly children: ReactNode }) => (
  <div className="bg-surface-sunken px-row-x py-gap flex flex-col gap-1 rounded-[8px]">
    {children}
  </div>
);

export const WellLine = ({ text }: { readonly text: string }) => (
  <p className="text-text-default font-mono text-[11px] leading-4 break-all">{text}</p>
);

export const Primary = ({
  label,
  onClick,
  testId,
  after,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
  readonly after: string | null;
}) => (
  <div className="gap-row-x flex items-center">
    <Button size="sm" variant="primary" data-testid={testId} onClick={onClick} className="shrink-0">
      {label}
    </Button>
    {after !== null && <p className="text-caption text-text-subtle">{after}</p>}
  </div>
);

/** A menu row: density's row height, a 16px glyph lane, then the words. */
export const ROW =
  "px-gap gap-row-x flex h-row w-full shrink-0 items-center rounded-control text-left outline-hidden";

export const HOVER = "hover:bg-fill-hover focus-visible:bg-fill-hover";

export const RowGlyph = ({ children }: { readonly children?: ReactNode }) => (
  <span className="text-text-subtle w-panel flex shrink-0 justify-center">{children}</span>
);

export const Group = ({
  title,
  children,
  testId,
}: {
  readonly title: string | null;
  readonly children: ReactNode;
  readonly testId?: string;
}) => (
  <div
    data-testid={testId}
    className={cn(
      "border-hairline flex flex-col gap-0.5 border-t px-1.5 first:border-t-0",
      title === null ? "py-1.5" : "pt-row-x pb-gap"
    )}
  >
    {title !== null && <p className="text-caption text-text-faint px-gap pt-0.5 pb-1.5">{title}</p>}
    {children}
  </div>
);
