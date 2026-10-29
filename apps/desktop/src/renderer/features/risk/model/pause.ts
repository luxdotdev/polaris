/**
 * Submit review pauses once while a Critical finding is open (DESIGN.md, Chrome redesign →
 * Review): it names the finding; choosing Submit review settles that set of open criticals,
 * and only a new one asks again. Pure, so it is tested.
 */
import type { FindingInfo } from "../../review/model/findings.ts";

export const openCriticals = (findings: ReadonlyArray<FindingInfo>) =>
  findings.filter((f) => f.severity === "critical" && f.status === "open");

/** The set the user said to submit past, as one key. */
export const pauseKey = (criticals: ReadonlyArray<FindingInfo>) =>
  criticals
    .map((f) => f.id)
    .toSorted()
    .join(",");

/** True while some open critical hasn't been submitted past. */
export const shouldPause = (criticals: ReadonlyArray<FindingInfo>, settled: string | null) =>
  criticals.length > 0 && pauseKey(criticals) !== settled;

/** "1 critical finding is open", "2 critical findings are open". */
export const pauseTitle = (count: number) =>
  count === 1 ? "1 critical finding is open" : `${count} critical findings are open`;
