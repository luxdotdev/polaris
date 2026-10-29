/**
 * The Risk Summary card's readout well (Paper X-G): one cell per Severity with its shape,
 * label and count; the Critical cell tinted while any is listed.
 */
import type { Severity } from "@polaris/protocol";
import { cn, KICKER, SEVERITIES, SEVERITY_LABELS, SeverityGlyph } from "@polaris/ui";

const CRITICAL_TINT =
  "bg-[color-mix(in_oklab,var(--color-severity-critical)_12%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-severity-critical)_20%,transparent)]";

export const Readout = ({ tally }: { readonly tally: Readonly<Record<Severity, number>> }) => (
  <div className="flex shrink-0 px-3" data-testid="risk-tally">
    <div className="bg-well border-hairline flex flex-1 gap-1 rounded-[12px] border p-1">
      {SEVERITIES.map((severity) => {
        const n = tally[severity];
        const lit = n > 0;

        return (
          <div
            key={severity}
            data-severity={severity}
            className={cn(
              "flex flex-1 flex-col gap-1.5 rounded-[9px] pt-2.5 pr-2 pb-2 pl-2.5",
              lit && severity === "critical" && CRITICAL_TINT
            )}
            style={lit ? { color: `var(--color-severity-${severity}-text)` } : undefined}
          >
            <span className={cn(KICKER, "flex items-center gap-1", lit && "text-current")}>
              <SeverityGlyph
                severity={severity}
                tone="text"
                className={lit ? "" : "opacity-40 grayscale"}
              />
              {SEVERITY_LABELS[severity]}
            </span>
            <span
              className={cn(
                "tabular text-[20px] leading-6 font-medium",
                lit
                  ? severity === "critical"
                    ? "text-current"
                    : "text-text-strong"
                  : "text-text-faint"
              )}
            >
              {n}
            </span>
          </div>
        );
      })}
    </div>
  </div>
);
