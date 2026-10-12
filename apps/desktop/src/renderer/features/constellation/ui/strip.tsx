/** The progress strip, proportional bars and receipt checks, each state in its own colour. */
import { cn, hueVar, Tooltip, TooltipContent, TooltipTrigger } from "@polaris/ui";
import {
  bar,
  type BarPart,
  type ReceiptView,
  type Segment,
  STRIP_SEGMENTS_MAX,
  type StripTone,
} from "../model/index.ts";

const FILL: Readonly<Record<Exclude<StripTone, "working">, string>> = {
  accepted: "var(--color-accepted)",
  review: "var(--color-text-default)",
  "needs-you": "var(--color-needs-you)",
  failed: "var(--color-failed)",
  waiting: "color-mix(in oklab, var(--color-text-faint) 45%, transparent)",
  blocked:
    "repeating-linear-gradient(135deg, var(--color-text-subtle) 0 1.5px, transparent 1.5px 3px)",
};

const fillOf = (tone: StripTone, harness: Segment["harness"]) =>
  tone === "working"
    ? harness === null
      ? "var(--color-text-subtle)"
      : hueVar(harness)
    : FILL[tone];

/** A 10×4px segment on a taller hover target; its tooltip names the Task and its state. */
const StripSegment = ({ segment }: { readonly segment: Segment }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="flex py-1.5" data-testid="strip-segment" data-task={segment.key}>
        <span
          className="h-1 w-2.5 rounded-[1px]"
          style={{ background: fillOf(segment.tone, segment.harness) }}
        />
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-80">
      <span className="text-code-inline text-text-strong shrink-0 font-mono">{segment.key}</span>
      {segment.title === "" ? null : <span className="min-w-0 truncate">{segment.title}</span>}
      <span className="text-text-subtle shrink-0">{segment.word}</span>
    </TooltipContent>
  </Tooltip>
);

/** One 10×4px segment per Task, or past 40 Tasks one proportional bar. */
export const ProgressStrip = ({ segments }: { readonly segments: ReadonlyArray<Segment> }) => {
  if (segments.length === 0) return null;

  if (segments.length > STRIP_SEGMENTS_MAX) return <StripBar parts={bar(segments)} width={220} />;

  // Hidden from assistive tech: the rows below carry every Task, its title and state.
  return (
    <span className="flex shrink-0 items-center gap-[2px]" data-testid="progress-strip" aria-hidden>
      {segments.map((s) => (
        <StripSegment key={s.key} segment={s} />
      ))}
    </span>
  );
};

/** A proportional bar on a faint track (a group's 120px bar, the large strip). */
export const StripBar = ({
  parts,
  width,
}: {
  readonly parts: ReadonlyArray<BarPart>;
  readonly width: number;
}) => (
  <span
    className="bg-text-faint/25 flex h-1 shrink-0 overflow-hidden rounded-full"
    style={{ width }}
    aria-hidden
  >
    {parts.map((p) => (
      <span
        key={p.tone}
        className="h-full"
        style={{ width: `${p.share * 100}%`, background: fillOf(p.tone, null) }}
      />
    ))}
  </span>
);

/** ✓ passed (accepted), ✗ failed (failed-text), ○ reported or not known. */
export const CheckMark = ({ check }: { readonly check: Pick<ReceiptView, "ok" | "tier"> }) => {
  if (check.ok === true) return <span className="text-accepted-text">✓</span>;

  if (check.ok === false) return <span className="text-failed-text">✗</span>;

  return <span className="text-text-subtle">○</span>;
};

export const Checks = ({
  checks,
  reportedHollow = false,
}: {
  readonly checks: ReadonlyArray<ReceiptView>;
  /** A Gate's receipts: reported ones are ○ with "(reported)", whatever their exit code. */
  readonly reportedHollow?: boolean;
}) => (
  <>
    {checks.map((c, n) => {
      const hollow = reportedHollow && c.tier === "reported";

      return (
        <span
          key={`${c.label}${n}`}
          className={cn(
            "flex shrink-0 items-center gap-1",
            c.ok === true && !hollow && "text-accepted-text",
            c.ok === false && "text-failed-text"
          )}
        >
          <CheckMark check={hollow ? { ok: null, tier: c.tier } : c} />
          {c.label}
          {hollow ? <span className="text-text-subtle">(reported)</span> : null}
        </span>
      );
    })}
  </>
);
