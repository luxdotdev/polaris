import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";
import type { CssVars } from "../../lib/css";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** ◆ ▲ ● ○: every Severity has its own shape (rule/severity-is-a-badge). */
export type SeverityMark = "diamond" | "triangle" | "circle" | "ring";

export const SEVERITY_MARKS: Record<Severity, SeverityMark> = {
  critical: "diamond",
  high: "triangle",
  medium: "circle",
  low: "ring",
};

const MARKS: Record<SeverityMark, ReactNode> = {
  diamond: <path d="M4 0.5L7.5 4L4 7.5L0.5 4Z" fill="currentColor" />,
  triangle: <path d="M4 0.8L7.6 7.2H0.4Z" fill="currentColor" />,
  circle: <circle cx="4" cy="4" r="3.25" fill="currentColor" />,
  ring: <circle cx="4" cy="4" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.25" />,
};

export interface SeverityGlyphProps {
  readonly severity: Severity;
  readonly size?: number;
  readonly className?: string;
}

/** The bare shape, for a diff gutter or a tally cell. Always beside a label or count. */
export function SeverityGlyph({ severity, size = 8, className }: SeverityGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      aria-hidden="true"
      data-mark={SEVERITY_MARKS[severity]}
      className={cn("shrink-0", className)}
      style={{ color: `var(--color-severity-${severity})` }}
    >
      {MARKS[SEVERITY_MARKS[severity]]}
    </svg>
  );
}

export interface SeverityBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly severity: Severity;
  /** A count instead of the label, as in "▲ 1" on a queue row. */
  readonly count?: number;
  /** Non-Critical Findings under 50% confidence render at reduced emphasis. */
  readonly lowConfidence?: boolean;
}

/**
 * A Severity: a filled badge with shape, label and colour (DESIGN.md, Risk Findings).
 * It never shares a form with a Session State indicator, and a Critical is never dimmed.
 */
export function SeverityBadge({
  severity,
  count,
  lowConfidence = false,
  className,
  style,
  ...props
}: SeverityBadgeProps) {
  const dimmed = lowConfidence && severity !== "critical";
  const vars: CssVars = { "--severity": `var(--color-severity-${severity})`, ...style };

  return (
    <span
      data-slot="severity-badge"
      data-severity={severity}
      data-dimmed={dimmed ? "" : undefined}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-[5px] rounded-control px-1.5 text-caption font-medium tabular",
        "bg-[color-mix(in_oklab,var(--severity)_16%,transparent)] text-(--severity)",
        dimmed && "opacity-60",
        className
      )}
      style={vars}
      {...props}
    >
      <SeverityGlyph severity={severity} />
      {count === undefined ? (
        SEVERITY_LABELS[severity]
      ) : (
        <>
          <span className="sr-only">{SEVERITY_LABELS[severity]}</span>
          {count}
        </>
      )}
    </span>
  );
}
