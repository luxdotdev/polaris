/**
 * The Session context card (Paper X-F 02, DESIGN.md Session context card, redesigned): the
 * header's "Context 62%" opens an instrument card of what fills the window, what each category
 * holds, the prompt cache, the latest compaction and "Compact now".
 */
import {
  Button,
  type CssVars,
  HoverCard,
  HoverCardTrigger,
  harnessHue,
  hueVar,
  InstrumentHoverCardContent,
} from "@polaris/ui";
import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from "react";
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
  sessionSpend,
  type SessionSpend,
} from "../model/context.ts";
import { queuedOutgoing } from "../model/outbox.ts";
import { ContentsWell, UsageWell, useContextFocus } from "./contextWells.tsx";
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
    <div className="gap-gap flex shrink-0 items-center" data-testid="context-compaction">
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

const Notes = ({
  card,
  harness,
  compaction,
}: {
  readonly card: Card;
  readonly harness: string;
  readonly compaction: ReactNode;
}) => (
  <>
    {compaction}
    {card.window === null ? (
      <p className="text-caption text-text-subtle">
        {harness} hasn't said how large this model's window is, so there's no percentage.
      </p>
    ) : null}
    {card.totalsOnly && card.window !== null ? (
      <p className="text-caption text-text-subtle">
        {harness} reports the total only, not what fills it.
      </p>
    ) : null}
    {card.nearlyFull ? (
      <p className="text-caption text-text-subtle">
        Compacting summarises earlier turns to make room.
      </p>
    ) : null}
  </>
);

const join = (parts: ReadonlyArray<string | null>) =>
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

  const card = usage === null ? null : contextCard(usage);
  const focus = useContextFocus(card);

  if (card === null) return null;
  const name = harnessHue(session.harness).name;
  const model = session.model === null ? null : modelLabel(models.models, session.model, null);
  const asOf = turnNumber === null ? null : `as of turn ${turnNumber}`;
  const full = card.percent === null ? null : `${card.percent}% full`;
  const hue: CssVars = { "--hue": hueVar(session.harness) };

  const usageWell = (
    <UsageWell
      key="usage"
      card={card}
      kicker={full === null && model === null ? [asOf ?? "", null] : [join([full, model]), asOf]}
      spend={spend}
      focus={focus}
      notes={
        <Notes
          card={card}
          harness={name}
          compaction={<Compacted hostKey={hostKey} session={session} />}
        />
      }
    />
  );

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
      <InstrumentHoverCardContent
        align="end"
        style={hue}
        data-testid="context-card"
        tabIndex={-1}
        ref={content}
        onBlur={(event) => {
          if (!within(event)) setOpen(false);
        }}
        className="outline-none"
        header={{ title: "Context", state: card.nearlyFull ? "nearly full" : undefined }}
        wells={
          focus.tab === null
            ? [usageWell]
            : [usageWell, <ContentsWell key="contents" card={card} focus={focus} />]
        }
        footer={{
          status: join([name, turnNumber === null ? null : `turn ${turnNumber}`, session.title]),
          action: can ? (
            <Button
              size="sm"
              className="rounded-full"
              data-testid="context-compact"
              onClick={() => {
                compact();
                setOpen(false);
              }}
            >
              Compact now
            </Button>
          ) : undefined,
        }}
      />
    </HoverCard>
  );
};
