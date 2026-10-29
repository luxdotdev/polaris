/**
 * Instrument cards (DESIGN.md, Menus and popovers; Paper X-F): every rich popover is a header,
 * an optional hero picture, one or two inset wells and a footer status line. Only the body
 * between header and footer scrolls (rule/popover-fits-window).
 */
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { FLOAT_EDGE } from "../../lib/float";
import { KICKER } from "../../lib/menu";
import { HoverCardContent } from "../ui/hover-card";
import { PopoverContent } from "../ui/popover";

export interface KickerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Joined with " · " ("As of 22:25", "revision 37" → "AS OF 22:25 · REVISION 37"). */
  readonly parts?: ReadonlyArray<string | number>;
}

/** Mono caps with `·` separators, for data labels only, never actions or prose. */
export function Kicker({ parts, className, children, ...props }: KickerProps) {
  return (
    <span data-slot="kicker" className={cn(KICKER, className)} {...props}>
      {parts === undefined ? children : parts.join(" · ")}
    </span>
  );
}

export interface InstrumentHeaderSlot {
  readonly title: ReactNode;
  /** A small glyph before the title (a Harness mark, the Constellation mark). */
  readonly mark?: ReactNode | undefined;
  /** One state word or count after the title, in mono ("6 workers"). */
  readonly state?: ReactNode | undefined;
  /** At most one control, at the trailing edge (a segmented control, a switch). */
  readonly control?: ReactNode | undefined;
}

export interface InstrumentFooterSlot {
  /** The mono status line, set as a Kicker. */
  readonly status: ReactNode;
  /** At most one action, at the trailing edge. */
  readonly action?: ReactNode | undefined;
}

export interface InstrumentSlots {
  readonly header: InstrumentHeaderSlot;
  /** The picture: full width at the top in its own well, never a thumbnail. */
  readonly hero?: ReactNode | undefined;
  /** The hero's height cap in px; past it the hero scrolls. Default 160. */
  readonly heroMaxHeight?: number | undefined;
  readonly wells: readonly [ReactNode] | readonly [ReactNode, ReactNode];
  readonly footer?: InstrumentFooterSlot | undefined;
}

export const HERO_MAX_HEIGHT = 160;

const WELL = "rounded-[12px] border border-hairline bg-well";

const Well = ({ children }: { readonly children: ReactNode }) => (
  <div data-slot="instrument-well" className={cn(WELL, "shrink-0 overflow-hidden")}>
    {children}
  </div>
);

function Header({ title, mark, state, control }: InstrumentHeaderSlot) {
  return (
    <header data-slot="instrument-header" className="flex shrink-0 items-center gap-2 px-3 pt-3">
      {mark === undefined ? null : <span className="flex shrink-0 items-center">{mark}</span>}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-label text-text-strong min-w-0 truncate">{title}</span>
        {state === undefined ? null : (
          <span className="text-text-subtle tabular shrink-0 font-mono text-[11px] leading-[14px]">
            {state}
          </span>
        )}
      </div>
      {control}
    </header>
  );
}

function Footer({ status, action }: InstrumentFooterSlot) {
  return (
    <footer
      data-slot="instrument-footer"
      className="border-hairline flex min-h-9 shrink-0 items-center gap-2 border-t px-4 py-1.5"
    >
      <Kicker className="min-w-0 flex-1 truncate">{status}</Kicker>
      {action}
    </footer>
  );
}

/** Header, scrolling body and footer; the container gives it a height cap. */
function InstrumentLayout({ header, hero, heroMaxHeight, wells, footer }: InstrumentSlots) {
  return (
    <>
      <Header {...header} />
      <div
        data-slot="instrument-body"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2"
      >
        {hero === undefined ? null : (
          <div
            data-slot="instrument-hero"
            className={cn(WELL, "relative shrink-0 overflow-x-hidden overflow-y-auto")}
            style={{ maxHeight: heroMaxHeight ?? HERO_MAX_HEIGHT }}
          >
            {hero}
          </div>
        )}
        <Well>{wells[0]}</Well>
        {wells.length === 2 ? <Well>{wells[1]}</Well> : null}
      </div>
      {footer === undefined ? null : <Footer {...footer} />}
    </>
  );
}

const CARD = "flex min-h-0 w-[400px] flex-col overflow-hidden rounded-card border border-hairline";

export type InstrumentCardProps = InstrumentSlots &
  Omit<HTMLAttributes<HTMLDivElement>, "children">;

/** An instrument card in place (Settings' usage, a completion summary). */
export function InstrumentCard({
  header,
  hero,
  heroMaxHeight,
  wells,
  footer,
  className,
  ...props
}: InstrumentCardProps) {
  return (
    <div
      data-slot="instrument-card"
      data-surface="raised"
      className={cn(CARD, "bg-raised text-text-default", className)}
      {...props}
    >
      <InstrumentLayout {...{ header, hero, heroMaxHeight, wells, footer }} />
    </div>
  );
}

export type InstrumentPopoverContentProps = InstrumentSlots &
  Omit<ComponentProps<typeof PopoverContent>, "children">;

/** A popover that is an instrument card, sized to the room its trigger leaves. */
export function InstrumentPopoverContent({
  header,
  hero,
  heroMaxHeight,
  wells,
  footer,
  className,
  ...props
}: InstrumentPopoverContentProps) {
  return (
    <PopoverContent
      data-slot="instrument-card"
      data-surface="raised"
      className={cn(CARD, "bg-raised p-0", className)}
      {...props}
    >
      <InstrumentLayout {...{ header, hero, heroMaxHeight, wells, footer }} />
    </PopoverContent>
  );
}

export type InstrumentHoverCardContentProps = InstrumentSlots &
  Omit<ComponentProps<typeof HoverCardContent>, "children">;

/** A hover card that is an instrument card (the session context card), sized like the popover. */
export function InstrumentHoverCardContent({
  header,
  hero,
  heroMaxHeight,
  wells,
  footer,
  className,
  collisionPadding = FLOAT_EDGE,
  ...props
}: InstrumentHoverCardContentProps) {
  return (
    <HoverCardContent
      data-slot="instrument-card"
      data-surface="raised"
      collisionPadding={collisionPadding}
      className={cn(
        CARD,
        "bg-raised max-h-(--radix-hover-card-content-available-height) p-0",
        className
      )}
      {...props}
    >
      <InstrumentLayout {...{ header, hero, heroMaxHeight, wells, footer }} />
    </HoverCardContent>
  );
}
