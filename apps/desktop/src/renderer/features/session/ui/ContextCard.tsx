/**
 * The Session context card (Paper "11 · Session context", DESIGN.md Session
 * context): the header's "Context 62%" opens what fills the window, the
 * latest compaction, the session's spend, and "Compact now".
 */
import {
  Button,
  cn,
  type CssVars,
  DisclosureChevron,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  harnessHue,
  hueVar,
} from "@polaris/ui";
import { type CSSProperties, type FocusEvent, useEffect, useRef, useState } from "react";
import type { SessionData } from "../../../store/plain.ts";
import { age } from "../../../shell/copy.ts";
import { useNow } from "../../../shell/useNow.ts";
import { polaris } from "../../bridge.ts";
import { useHarnessCommands } from "../../composer/index.ts";
import { modelLabel, useHarnessModels } from "../../harness/index.ts";
import { hasCapability, useHost, useSession } from "../hooks.ts";
import {
  compactionLine,
  type ContextCard as Card,
  contextCard,
  rowShare,
  rowTokens,
  type Segment,
  sessionSpend,
  type SessionSpend,
  type Tone,
} from "../model/context.ts";
import type { Details } from "../model/contextDetails.ts";
import { queuedOutgoing } from "../model/outbox.ts";
import { formatTokens } from "../model/meta.ts";
import { turnNumber } from "../model/turnGroups.ts";
import { patchSessionUi, uiKey } from "../state.ts";

export interface ContextReadoutProps {
  readonly hostKey: string;
  readonly session: SessionData;
  /** The header's text: "Context 62%", "Context 84k". */
  readonly label: string;
  readonly detail: string;
  /** The Turn the count is as of (the latest). */
  readonly turnNumber: number | null;
}

const ALPHA: Partial<Record<Tone, number>> = { strong: 100, medium: 60, light: 35 };

const FREE = "bg-[light-dark(#00000014,#ffffff12)]";

const FREE_SWATCH = "bg-[light-dark(#00000014,#ffffff1f)]";

const RESERVE = "border border-[light-dark(#00000029,#ffffff24)]";

const toneStyle = (tone: Tone): CSSProperties | undefined => {
  const alpha = ALPHA[tone];

  return alpha === undefined
    ? undefined
    : { backgroundColor: `color-mix(in srgb, var(--hue) ${alpha}%, transparent)` };
};

const toneClass = (tone: Tone, swatch = false) => {
  if (tone === "free") return swatch ? FREE_SWATCH : FREE;

  return tone === "reserve" ? RESERVE : undefined;
};

const Meter = ({ card, focus }: { readonly card: Card; readonly focus: string | null }) => (
  <div
    className="px-panel grid shrink-0 grid-cols-[repeat(25,11px)] gap-0.5 pb-3.5"
    aria-hidden
    data-testid="context-meter"
  >
    {card.cells.map((cell, i) => (
      <span
        // Cells are positional: 1% of the window each.
        key={i}
        className={cn(
          "size-[11px] transition-opacity duration-120 ease-out",
          toneClass(cell.tone),
          focus !== null && focus !== cell.key && "opacity-35"
        )}
        style={toneStyle(cell.tone)}
      />
    ))}
  </div>
);

const DetailRows = ({ details }: { readonly details: Details }) => (
  <ul className="pl-row pr-session-row flex flex-col pb-1" data-testid="context-details">
    {details.rows.map((d) => (
      <li key={d.key} className="flex h-[22px] shrink-0 items-center gap-1.5">
        <span
          className={cn(
            "text-caption min-w-0 truncate",
            d.mono ? "text-text-default font-mono" : "text-text-subtle"
          )}
        >
          {d.label}
        </span>
        {d.note === null ? null : (
          <span className="text-caption text-text-faint shrink-0">{d.note}</span>
        )}
        <span className="flex-1" />
        <span className="text-caption text-text-subtle tabular shrink-0">
          {rowTokens(d.tokens)}
        </span>
      </li>
    ))}
    {details.footnote === null ? null : (
      <li className="flex h-[22px] shrink-0 items-center">
        <span className="text-caption text-text-faint truncate">{details.footnote.text}</span>
        <span className="flex-1" />
        {details.footnote.tokens === null ? null : (
          <span className="text-caption text-text-faint tabular shrink-0">
            {rowTokens(details.footnote.tokens)}
          </span>
        )}
      </li>
    )}
  </ul>
);

const labelTone = (quiet: boolean, focused: boolean) => {
  if (quiet) return "text-text-subtle";

  return focused ? "text-text-strong" : "text-text-default";
};

const Row = ({
  segment,
  window,
  focused,
  open,
  onFocus,
  onToggle,
}: {
  readonly segment: Segment;
  readonly window: number;
  readonly focused: boolean;
  readonly open: boolean;
  readonly onFocus: (key: string | null) => void;
  readonly onToggle: (key: string) => void;
}) => {
  const quiet = segment.tone === "free" || segment.tone === "reserve";
  const { details } = segment;
  const opens = details.rows.length > 0 || details.footnote !== null;

  const line = (
    <>
      <span
        className={cn("size-gap shrink-0", toneClass(segment.tone, true))}
        style={toneStyle(segment.tone)}
      />
      <span className={cn("text-body truncate", labelTone(quiet, focused))}>{segment.label}</span>
      {details.count === null ? null : (
        <span className="text-caption text-text-subtle shrink-0">{details.count}</span>
      )}
      {opens ? <DisclosureChevron open={open} className="text-text-faint" /> : null}
      <span className="flex-1" />
      <span
        className={cn("text-caption tabular", quiet ? "text-text-subtle" : "text-text-default")}
      >
        {rowTokens(segment.tokens)}
      </span>
      <span className="text-caption text-text-subtle w-row tabular shrink-0 text-right">
        {rowShare(segment.tokens, window)}
      </span>
    </>
  );

  const rowClass = cn(
    "h-tree-row px-gap gap-gap rounded-control flex w-full shrink-0 items-center text-left",
    focused && "bg-fill-selected"
  );

  return (
    <li
      className="flex flex-col"
      data-testid="context-row"
      data-key={segment.key}
      onPointerEnter={() => onFocus(segment.key)}
      onPointerLeave={() => onFocus(null)}
    >
      {opens ? (
        <button
          type="button"
          aria-expanded={open}
          className={cn(
            rowClass,
            "focus-visible:outline-starlight cursor-default outline-none focus-visible:outline-2"
          )}
          onClick={() => onToggle(segment.key)}
          onFocus={() => onFocus(segment.key)}
          onBlur={() => onFocus(null)}
        >
          {line}
        </button>
      ) : (
        <div className={rowClass}>{line}</div>
      )}
      {opens && open ? <DetailRows details={details} /> : null}
    </li>
  );
};

/**
 * The session's Usage since it started, asked again each time `asked` moves (the pointer
 * reaches the readout); null before the first answer or where the Host doesn't report it.
 */
const useSessionSpend = (hostKey: string, session: SessionData, asked: number) => {
  const reports = hasCapability(useHost(hostKey), "usage");
  const [spend, setSpend] = useState<SessionSpend | null>(null);

  useEffect(() => {
    if (asked === 0 || !reports) return undefined;
    let live = true;

    void polaris()
      .request("usage.query", {
        hostKey,
        from: session.createdAt,
        to: new Date().toISOString(),
        harness: null,
        sessionId: session.id,
      })
      .then((result) => {
        if (!live || !result.ok) return;
        const { report, estimates } = result.value;
        setSpend(
          sessionSpend(
            report.buckets.map((b, i) => ({
              tokens: b.tokens,
              reportedCost: b.reportedCost,
              estimate: estimates[i],
            }))
          )
        );
      });

    return () => {
      live = false;
    };
  }, [asked, reports, hostKey, session.id, session.createdAt]);

  return spend;
};

/** The Harness's own `/compact`, when it lists one; queued so it never interrupts a Turn. */
const useCompact = (hostKey: string, session: SessionData) => {
  const listed = hasCapability(useHost(hostKey), "harness.commands");
  const commands = useHarnessCommands(hostKey, session.harness, session.cwd, listed);

  const can =
    session.state !== "archived" &&
    commands.options.some((o) => o.sigil === "/" && o.name === "compact" && o.run !== "polaris");

  const compact = () =>
    patchSessionUi(uiKey(hostKey, session.id), (ui) => ({
      outbox: [...ui.outbox, queuedOutgoing("/compact", [])],
    }));

  return { can, compact, want: commands.want };
};

const Compacted = ({
  hostKey,
  session,
}: {
  readonly hostKey: string;
  readonly session: SessionData;
}) => {
  const now = useNow();
  const { turns } = useSession(hostKey, session.id);
  const compaction = session.lastCompaction;

  if (compaction === null) return null;
  const number = turnNumber(turns, compaction.turnId);
  const when = age(compaction.at, now);

  return (
    <div
      className="px-panel gap-gap flex shrink-0 items-center pb-3"
      data-testid="context-compaction"
    >
      <CompactGlyph />
      <span className="text-caption text-text-default min-w-0 truncate">
        {compactionLine(compaction, number)}
      </span>
      <span className="flex-1" />
      <span className="text-caption text-text-subtle shrink-0">
        {when === "now" ? "just now" : `${when} ago`}
      </span>
    </div>
  );
};

const CompactGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="text-text-subtle shrink-0">
    <path
      d="M3 2.5h8M3 11.5h8M7 4v2.5M5.5 5L7 6.5L8.5 5M7 10V7.5M5.5 9L7 7.5L8.5 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Summary = ({ card, caption }: { readonly card: Card; readonly caption: string }) => (
  <div className="px-panel pt-panel flex shrink-0 flex-col gap-1 pb-3">
    <div className="flex items-baseline gap-1.5">
      <span className="text-display text-text-strong tabular font-medium tracking-[-0.01em]">
        {formatTokens(card.used)}
      </span>
      <span className="text-body text-text-subtle">
        {card.window === null ? "tokens in context" : `of ${formatTokens(card.window)} tokens`}
      </span>
      <span className="flex-1" />
      {card.percent === null ? null : (
        <span className="text-body text-text-default tabular font-medium">
          {card.nearlyFull ? `${card.percent}% · nearly full` : `${card.percent}%`}
        </span>
      )}
    </div>
    <span className="text-caption text-text-subtle truncate">{caption}</span>
  </div>
);

const Breakdown = ({ card, harness }: { readonly card: Card; readonly harness: string }) => {
  const [focus, setFocus] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);

      if (!next.delete(key)) next.add(key);

      return next;
    });

  if (card.window === null) return null;

  return (
    <>
      <Meter card={card} focus={focus} />
      <ul
        className="flex min-h-0 flex-col overflow-y-auto px-2 pb-2.5"
        data-testid="context-breakdown"
      >
        {card.legend.map((segment) => (
          <Row
            key={segment.key}
            segment={segment}
            window={card.window ?? 1}
            focused={focus === segment.key}
            open={open.has(segment.key)}
            onFocus={setFocus}
            onToggle={toggle}
          />
        ))}
        {card.totalsOnly ? (
          <li className="text-caption text-text-subtle px-gap pt-1.5">
            {harness} reports the total only, not what fills it.
          </li>
        ) : null}
        {card.nearlyFull ? (
          <li className="text-caption text-text-subtle px-gap pt-1.5">
            Compacting summarises earlier turns to make room.
          </li>
        ) : null}
      </ul>
    </>
  );
};

const Footer = ({
  spend,
  compact,
}: {
  readonly spend: SessionSpend | null;
  readonly compact: (() => void) | null;
}) => {
  if (spend === null && compact === null) return null;

  return (
    <div className="px-panel py-row-pad gap-gap border-hairline flex shrink-0 items-center border-t bg-[light-dark(#f7f7f9,#1e1f22)]">
      <div className="flex min-w-0 flex-1 flex-col">
        {spend === null ? null : (
          <>
            <span className="text-caption text-text-default truncate">{spend.line}</span>
            {spend.detail === null ? null : (
              <span className="text-caption text-text-subtle truncate">{spend.detail}</span>
            )}
          </>
        )}
      </div>
      {compact === null ? null : (
        <Button size="sm" onClick={compact} data-testid="context-compact">
          Compact now
        </Button>
      )}
    </div>
  );
};

const captionOf = (parts: ReadonlyArray<string | null>) =>
  parts.filter((p): p is string => p !== null && p !== "").join(" · ");

export const ContextReadout = (props: ContextReadoutProps) => {
  const { hostKey, session, label, detail, turnNumber } = props;
  const [open, setOpen] = useState(false);
  // Click or ↵ opens it at once and moves focus in; hover leaves focus where it was.
  const [focusIn, setFocusIn] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  // Armed when the pointer or focus first reaches the readout: the footer's data is in by the open.
  const [armed, setArmed] = useState(0);
  const spend = useSessionSpend(hostKey, session, armed);
  const { can, compact, want } = useCompact(hostKey, session);
  const models = useHarnessModels(hostKey, session.harness, open);
  const usage = session.contextUsage;

  useEffect(() => {
    if (open && focusIn) content.current?.focus();
  }, [open, focusIn]);

  // Focus moving into the card isn't leaving it; Radix closes a hover card on the trigger's blur.
  const within = (event: FocusEvent) =>
    event.relatedTarget instanceof Node && content.current?.contains(event.relatedTarget) === true;

  const arm = () => {
    want();

    // Once per approach, not on the open that follows it.
    if (!open) setArmed((n) => n + 1);
  };

  if (usage === null) return null;
  const card = contextCard(usage);
  const name = harnessHue(session.harness).name;

  const caption = captionOf([
    session.model === null ? null : modelLabel(models.models, session.model, null),
    turnNumber === null ? null : `as of turn ${turnNumber}`,
    `${name}'s count`,
  ]);

  const hue: CssVars = { "--hue": hueVar(session.harness) };

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        if (next) arm();
        else setFocusIn(false);
        setOpen(next);
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="text-caption text-text-subtle hover:text-text-default tabular min-w-0 cursor-default truncate"
          aria-label={`${label}: ${detail}`}
          aria-expanded={open}
          data-testid="session-context"
          onPointerEnter={() => arm()}
          onFocus={() => arm()}
          onBlur={(event) => {
            if (within(event)) event.preventDefault();
          }}
          onClick={() => {
            arm();
            setFocusIn(true);
            setOpen(true);
          }}
        >
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        style={hue}
        data-testid="context-card"
        tabIndex={-1}
        ref={content}
        onBlur={(event) => {
          if (!within(event)) setOpen(false);
        }}
        // The breakdown scrolls when open rows outgrow the window.
        className="flex max-h-[calc(var(--radix-hover-card-content-available-height)-12px)] w-[360px] flex-col outline-none"
      >
        <Summary card={card} caption={caption} />
        <Compacted hostKey={hostKey} session={session} />
        {card.window === null ? (
          <p className="text-caption text-text-subtle px-panel pb-3">
            {name} hasn't said how large this model's window is, so there's no percentage.
          </p>
        ) : (
          <Breakdown card={card} harness={name} />
        )}
        <Footer
          spend={spend}
          compact={
            can
              ? () => {
                  compact();
                  setOpen(false);
                }
              : null
          }
        />
      </HoverCardContent>
    </HoverCard>
  );
};
