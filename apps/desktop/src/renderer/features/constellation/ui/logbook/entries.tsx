/**
 * A Logbook's rows (DESIGN.md, Logbook): the rail line and its dot, then time, author, the
 * faint mono kind lane and the text. Inspections and lost Attempts are sunken cards.
 */
import { cn } from "@polaris/ui";
import { Match } from "effect";
import type { ReactNode } from "react";
import { receiptView } from "../../model/claim.ts";
import { clock, shortSha } from "../../model/copy.ts";
import type { Facts } from "../../model/facts.ts";
import {
  authorWord,
  type AttemptMark,
  boundaryLine,
  claimTail,
  type EntryData,
  entryCaption,
  inspectionRoute,
  kindWord,
  type LogbookLog,
  verdictWord,
} from "../../model/logbook.ts";

type Dot = "plain" | "ring" | "ring-faint" | "filled" | "failed" | "boundary" | "boundary-now";

const dotOf = (entry: EntryData): Dot =>
  Match.value(entry).pipe(
    Match.tag("Claim", () => "ring" as const),
    Match.tag("Review", () => "ring-faint" as const),
    Match.tag("Inspection", () => "filled" as const),
    Match.tag("Lost", () => "failed" as const),
    Match.orElse(() => "plain" as const)
  );

const DOT: Readonly<Record<Dot, string>> = {
  plain: "left-[9px] top-[11px] size-[5px] bg-text-faint",
  ring: "left-[7px] top-[9px] size-[9px] border-[1.5px] border-text-default bg-panel",
  "ring-faint": "left-[7px] top-[9px] size-[9px] border-[1.5px] border-text-faint bg-panel",
  filled: "left-[7px] top-[9px] size-[9px] bg-text-default",
  failed: "left-[7px] top-[9px] size-[9px] bg-failed",
  boundary: "left-[7px] top-1/2 -mt-[4.5px] size-[9px] border-[1.5px] border-text-faint bg-panel",
  "boundary-now":
    "left-[7px] top-1/2 -mt-[4.5px] size-[9px] border-[1.5px] border-text-default bg-panel",
};

/** The rail line's segment beside one row, and the row's dot on it. */
export const Gutter = ({ dot }: { readonly dot: Dot }) => (
  <div aria-hidden className="relative w-6 shrink-0">
    <div className="bg-border-strong/60 absolute inset-y-0 left-[11px] w-px" />
    <div className={cn("absolute rounded-full", DOT[dot])}>
      {dot === "ring" ? (
        <div className="bg-text-default absolute top-1/2 left-1/2 size-[3px] -translate-1/2 rounded-full" />
      ) : null}
    </div>
  </div>
);

const MONO = /(\S+\/\S+|\b[a-z_]+(?:\.[a-z_]+)+\b)/g;

/** Paths and dotted names in a note or message set in mono, the rest as prose. */
export const Prose = ({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) => (
  <p
    className={cn(
      "text-body text-text-default whitespace-pre-wrap [overflow-wrap:anywhere]",
      className
    )}
  >
    {text.split(MONO).map((part, n) =>
      n % 2 === 1 ? (
        <span key={n} className="text-code-inline font-mono">
          {part}
        </span>
      ) : (
        part
      )
    )}
  </p>
);

const Caption = ({ children }: { readonly children: ReactNode }) => (
  <p className="text-caption text-text-faint [overflow-wrap:anywhere]">{children}</p>
);

const Card = ({ children }: { readonly children: ReactNode }) => (
  <div className="bg-surface-sunken border-hairline rounded-row px-row-x py-gap flex flex-col gap-1.5 border">
    {children}
  </div>
);

const ClaimBody = ({
  entry,
  facts,
}: {
  readonly entry: Extract<EntryData, { _tag: "Claim" }>;
  readonly facts: Facts;
}) => (
  <div className="text-caption gap-x-row-x flex min-h-[18px] flex-wrap items-center gap-y-0.5">
    <span className="text-code-inline text-text-subtle font-mono">
      {shortSha(entry.claim.head)}
    </span>
    {entry.claim.receipts.map((receipt, n) => {
      const view = receiptView(receipt, facts);

      return (
        <span key={n} className={view.ok === false ? "text-failed-text" : "text-text-subtle"}>
          {view.ok === false ? "✗" : "✓"} {view.label}
        </span>
      );
    })}
    <span className="text-text-faint">{claimTail(entry)}</span>
  </div>
);

const Inspection = ({ entry }: { readonly entry: Extract<EntryData, { _tag: "Inspection" }> }) => (
  <Card>
    <span className="text-body text-text-strong font-medium">{verdictWord(entry)}</span>
    <Prose text={entry.text} />
    <Caption>{inspectionRoute(entry)}</Caption>
  </Card>
);

const Lost = ({ entry }: { readonly entry: Extract<EntryData, { _tag: "Lost" }> }) => (
  <Card>
    <p className="text-body text-text-default [overflow-wrap:anywhere]">
      <span className="text-failed-text font-medium">
        Attempt {entry.attempt ?? ""} {entry.outcome}
      </span>{" "}
      {entry.text}
    </p>
  </Card>
);

const Body = ({
  entry,
  log,
  facts,
}: {
  readonly entry: EntryData;
  readonly log: LogbookLog;
  readonly facts: Facts;
}) =>
  Match.value(entry).pipe(
    Match.tag("Claim", (e) => <ClaimBody entry={e} facts={facts} />),
    Match.tag("Inspection", (e) => <Inspection entry={e} />),
    Match.tag("Lost", (e) => <Lost entry={e} />),
    Match.orElse((e) => {
      const caption = entryCaption(e, log);

      return (
        <>
          <Prose text={e.text} />
          {caption === null ? null : <Caption>{caption}</Caption>}
        </>
      );
    })
  );

/** One entry: oldest first in a Task's Logbook, so its time is the clock time. */
export const EntryRow = ({
  entry,
  log,
  facts,
  last,
}: {
  readonly entry: EntryData;
  readonly log: LogbookLog;
  readonly facts: Facts;
  readonly last: boolean;
}) => {
  const author = authorWord(entry);

  return (
    <div className="flex" data-testid="logbook-entry" data-kind={entry._tag}>
      <Gutter dot={dotOf(entry)} />
      <div className={cn("flex min-w-0 grow items-start py-1", last && "pb-1.5")}>
        <time
          dateTime={entry.at}
          className="text-micro text-text-faint w-13 shrink-0 font-mono leading-[18px]"
        >
          {clock(entry.at)}
        </time>
        <span
          className={cn(
            "text-caption w-17 shrink-0 truncate leading-[18px]",
            author.id ? "text-text-subtle font-mono" : "text-text-subtle",
            entry.author === "you" && "text-text-default"
          )}
        >
          {author.text}
        </span>
        <span className="text-micro text-text-faint w-19 shrink-0 truncate font-mono leading-[18px]">
          {kindWord(entry)}
        </span>
        <div className="flex min-w-0 grow basis-0 flex-col gap-0.5">
          <Body entry={entry} log={log} facts={facts} />
        </div>
      </div>
    </div>
  );
};

/** The row that starts an Attempt; it sticks to the top while its entries scroll under it. */
export const Boundary = ({
  attempt,
  current,
  hidden,
  onShow,
}: {
  readonly attempt: AttemptMark;
  readonly current: boolean;
  /** Entries folded away, with the button that shows them; 0 when open. */
  readonly hidden: number;
  readonly onShow: () => void;
}) => (
  <div
    className="bg-panel sticky top-0 z-10 flex"
    data-testid="logbook-boundary"
    data-attempt={attempt.number}
  >
    <Gutter dot={current ? "boundary-now" : "boundary"} />
    <div className="gap-gap flex min-w-0 grow items-center py-1.5">
      <span
        className={cn(
          "text-caption shrink-0 font-medium",
          current ? "text-text-strong" : "text-text-default"
        )}
      >
        Attempt {attempt.number}
      </span>
      <span className="text-caption text-text-faint min-w-0 truncate">
        {boundaryLine(attempt, clock)}
      </span>
      <span className="bg-hairline h-px min-w-4 grow" />
      {hidden === 0 ? null : (
        <button
          type="button"
          onClick={onShow}
          className="text-caption text-text-subtle hover:text-text-default shrink-0 cursor-default"
        >
          Show {hidden} {hidden === 1 ? "entry" : "entries"}
        </button>
      )}
    </div>
  </div>
);
