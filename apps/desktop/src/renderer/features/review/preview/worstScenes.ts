/**
 * The break-UI pass (ENG-499) on Review: `#review/worst…` on #88 with worst-case data. A
 * 256-character title and long branches, 200 files, 60 findings of every Severity, a 10-layer
 * stack and no Reviewer (`worst`); the Reviewer's long code answers (`worst-chat`); no files
 * or findings (`worst-empty`); every layer merged (`worst-merged`); its Host Offline (`worst-offline`).
 */
import { RiskFinding, RiskFindingId, TurnItem } from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import type { PullDetailView, StackView } from "../../../../shared/github.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import type { Summary } from "../../risk/model/summary.ts";
import { askStore } from "../../risk/data/actions.ts";
import { setChatting } from "../../risk/data/ui.ts";
import { turn, view } from "../../session/preview/fixtures.ts";
import { REVIEWER_SESSION } from "./xgScenes.ts";

export const isWorst = (scene: string) => scene.startsWith("worst");

/** GitHub's limit on a pull request title is 256 characters. */
const TITLE =
  "feat(eligibility): collect annual household income instead of monthly, validate it against the per-household-size limits table shared with the vacant-land programme, and migrate every saved draft application (ENG-1843, ENG-1845, ENG-1846, ENG-1847)";

const HEAD =
  "aleksandra.wisniewska-kowalczyk/eng-1843-annual-household-income-eligibility-migration";

const BASE = "release/2026.11-nj-homes-choice-next-eligibility-hardening-candidate";

const DIRS = [
  "apps/eligibility/src/features/household-income/validation/annual",
  "packages/limits",
  "docs",
  "apps/eligibility/src/features/household-income/migrations/2026-11-drafts",
];

const pathOf = (n: number) =>
  `${DIRS[n % DIRS.length] ?? ""}/${n % 7 === 0 ? "householdIncomeAnnualisationAndLimitsValidation" : "f"}${n}.ts`;

const files = (count: number): PullDetailView["files"] =>
  Array.from({ length: count }, (_, n) => ({
    path: pathOf(n),
    additions: n === 0 ? 12_408 : n * 3,
    deletions: n % 3 === 0 ? 0 : n,
    changeType: n % 11 === 0 ? "ADDED" : "MODIFIED",
    viewed: n % 5 === 0 ? "viewed" : "unviewed",
  }));

const STATUSES = [
  "merged",
  "merged",
  "merged",
  "open",
  "open",
  "open",
  "open",
  "draft",
  "closed",
  "open",
] as const;

/** #88 as layer 4 of 10, every branch long. */
const stack = (merged: boolean): StackView => ({
  source: "github",
  number: 1843,
  trunk: BASE,
  position: 4,
  size: 10,
  members: Array.from({ length: 10 }, (_, i) => ({
    id: `PR_${80 + i}`,
    number: i === 3 ? 88 : 1840 + i,
    title:
      i === 3
        ? TITLE
        : `feat(eligibility): layer ${i + 1} of the annual income migration, with its own very long title`,
    url: "",
    headRefName: i === 3 ? HEAD : `${HEAD}-layer-${i + 1}`,
    status: merged ? "merged" : (STATUSES[i] ?? "open"),
    additions: 12_408 - i * 1000,
    deletions: 3_201,
    checks: i % 2 === 0 ? { state: "failure", total: 148 } : null,
  })),
});

export const worstDetail = (base: PullDetailView, scene: string): PullDetailView => {
  const merged = scene === "worst-merged";

  return {
    ...base,
    title: TITLE,
    author: null,
    headRefName: HEAD,
    baseRefName: BASE,
    commits: 1_204,
    state: merged ? "merged" : "open",
    files: files(scene === "worst-empty" ? 0 : 200),
    checks: { state: "failure", total: 148 },
    stack: stack(merged),
  };
};

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const REASON =
  "submitEligibility multiplies the annual figure by 12 before sending it, so every household of more than one person is overstated and fails the limit; the fallback only runs when the field is missing.";

/** 60 findings, every Severity, long titles and paths, some with no reason. */
export const WORST_FINDINGS = Array.from(
  { length: 60 },
  (_, n) =>
    new RiskFinding({
      id: RiskFindingId.make(`w-${n}`),
      identity: `w-${n}`,
      source: n % 3 === 0 ? "rule" : "agent",
      ruleId: n % 3 === 0 ? "polaris/trusted-input-from-request-body" : null,
      path: pathOf(n),
      lines: { start: 10_000 + n, end: 10_040 + n, side: "new" },
      severity: SEVERITIES[n % SEVERITIES.length] ?? "low",
      confidence: n % 10 === 0 ? 1 : 0.07 + (n % 9) / 10,
      title:
        n % 4 === 1
          ? "The income limit is read from the request body, so anyone can post a higher limit and pass"
          : `Finding ${n + 1}`,
      reason: n % 2 === 0 ? REASON : "",
      suggestion: null,
      status: n % 13 === 0 ? "dismissed" : "open",
      resolution: null,
    })
);

export const worstFindings = (scene: string) => (scene === "worst-empty" ? [] : WORST_FINDINGS);

/** No Reviewer on the Host: only the rules ran, as the Daemon reports it. */
export const worstSummary = (summary: Summary, scene: string): Summary =>
  scene === "worst-chat"
    ? summary
    : {
        ...summary,
        reviewer: null,
        cost: null,
        layers: {
          rules: summary.layers.rules,
          agent: { status: "skipped", note: "Rules only: no Reviewer is available on this Host." },
        },
      };

/** `count` files at the paths the detail lists, each with one long unbroken line. */
export const worstPatch = (count: number) =>
  `${Array.from({ length: count }, (_, n) =>
    [
      `diff --git a/${pathOf(n)} b/${pathOf(n)}`,
      "index 1111111..2222222 100644",
      `--- a/${pathOf(n)}`,
      `+++ b/${pathOf(n)}`,
      `@@ -10${n},2 +10${n},3 @@`,
      " export const limits = LIMITS;",
      `+export const incomeLimitForHouseholdOfSize${n} = (household: HouseholdWithAnnualIncomeAndDependants): number => LIMITS_BY_HOUSEHOLD_SIZE[Math.min(household.size, LIMITS_BY_HOUSEHOLD_SIZE.length - 1)] ?? 0;`,
      " export default limits;",
    ].join("\n")
  ).join("\n")}\n`;

/** Studio, where #88's Review Checkout is, gone Offline. */
export const worstHosts = (hosts: ReadonlyArray<HostView>, scene: string) =>
  scene === "worst-offline"
    ? hosts.map((h) =>
        h.key === "studio" ? { ...h, status: { ...h.status, state: "offline" as const } } : h
      )
    : hosts;

const CODE = Array.from(
  { length: 40 },
  (_, n) =>
    `export const incomeLimitForHouseholdOfSize${n} = (household: HouseholdWithAnnualIncomeAndDependants): number => LIMITS_BY_HOUSEHOLD_SIZE[Math.min(household.size, LIMITS_BY_HOUSEHOLD_SIZE.length - 1)] ?? 0;`
).join("\n");

const reply = (answer: string) => `\`\`\`json\n${JSON.stringify({ answer })}\n\`\`\``;

/** The Reviewer's session: a 40-line answer with unbroken long lines, then one still running. */
export const worstReviewerSession = (): SessionModel => {
  const first = turn(REVIEWER_SESSION, 1, "Show me every place that reads the limit", "completed");
  const second = turn(REVIEWER_SESSION, 2, "And the tests?", "working");

  return {
    // SAFETY: a fixture sequence; any positive number is a valid one.
    sequence: 12 as SessionModel["sequence"],
    synchronized: true,
    session: null,
    turns: [
      view(first, [
        TurnItem.cases.AssistantMessage.make({
          id: "a1",
          text: reply(
            `Every one of these reads it, and https://github.com/work-org/nj-homes-choice-next/blob/aleksandra.wisniewska-kowalczyk/eng-1843-annual-household-income-eligibility-migration/apps/eligibility/src/features/household-income/validation/annual/limits.ts is where they meet:\n\n\`\`\`ts\n${CODE}\n\`\`\`\n\nThe fix is \`incomeLimitForHouseholdOfSize(household)\` alone.`
          ),
        }),
      ]),
      view(second, []),
    ],
    pendingApprovals: [],
  };
};

export const setUpWorst = (scene: string, subjectKey: string, summaryId: string) => {
  if (scene !== "worst-chat") return;

  const sent = (n: number) => ({
    kind: "sent" as const,
    sessionId: REVIEWER_SESSION,
    turnId: turn(REVIEWER_SESSION, n, "", "completed").id,
  });

  askStore.setState({
    [summaryId]: [
      {
        id: "ask-1",
        question:
          "Show me every place that reads the limit, including the migrations under apps/eligibility/src/features/household-income/migrations/2026-11-drafts",
        findingId: null,
        state: sent(1),
      },
      { id: "ask-2", question: "And the tests?", findingId: null, state: sent(2) },
    ],
  });
  setChatting(subjectKey, true);
};
