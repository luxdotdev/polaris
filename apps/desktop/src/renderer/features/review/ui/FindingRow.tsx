/**
 * A Risk Finding's reason under the line it flags (ENG-230: the row stays beside the gutter
 * mark): its Severity badge, title and reason, indented to the code like Paper R1's
 * pending comment. Low-confidence findings are dimmed; a Critical one never is.
 */
import { cn, SeverityBadge } from "@polaris/ui";
import { memo } from "react";
import { type FindingInfo, isDimmed } from "../model/findings.ts";

const Row = ({ finding }: { readonly finding: FindingInfo }) => (
  <div
    data-testid="finding-row"
    data-finding={finding.id}
    className={cn(
      "flex py-1.5 pr-panel pl-[78px] font-sans",
      isDimmed(finding) && "opacity-(--opacity-dimmed)"
    )}
  >
    <div className="border-hairline bg-surface-raised rounded-row gap-row-x flex min-w-0 flex-1 items-start border px-3 py-2">
      <SeverityBadge severity={finding.severity} lowConfidence={finding.confidence < 0.5} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body text-text-strong font-medium">{finding.title}</span>
        {finding.reason !== "" && (
          <span className="text-caption text-text-subtle">{finding.reason}</span>
        )}
      </div>
    </div>
  </div>
);

/** Memoised: Pierre re-renders every mounted annotation as files mount. */
export const FindingRow = memo(Row);
