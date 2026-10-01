/**
 * Overview on fixtures (`#review/ov-…`): PR #88's description, a Suzuka summary in its real
 * format, the timeline, commits, checks and the walkthrough in each state, and an Agent
 * Session's prompts. Paths and finding ids match `review/preview/fixtures.ts`.
 */
import { RiskSummaryId, Walkthrough } from "@polaris/protocol";
import type { PullDetailView } from "../../../../../shared/github.ts";
import type { Walkthroughs } from "../data/overview.ts";
import { setTab, type TabId } from "../model/tabs.ts";
import type { CommitView, TimelineItemView } from "../model/types.ts";

const NOW = Date.now();

const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const HOUR = 60;

const DAY = 24 * HOUR;

const person = (login: string, bot = false) => ({ login, bot });

const SUZUKA = person("suzuka", true);

export const DESCRIPTION = `### What
The eligibility form asks for **annual** income instead of monthly, so households paid
yearly or seasonally don't have to do the arithmetic. Limits move to one table in
\`forms/limits.ts\`.

### Why
NJH-412: a third of last quarter's rejected applications had a monthly figure entered as yearly.

### How to test
1. Open \`/apply\` and enter 54,000 for a household of 3.
2. The form should say the household qualifies (limit 74,550).
3. \`bun test forms\`
`;

const BUNDLE_ROWS = Array.from(
  { length: 14 },
  (_, i) =>
    `| chunk-${String(i + 1).padStart(2, "0")}.js | ${(12 + i * 3.1).toFixed(1)} KB | 120 KB | ok |`
).join("\n");

export const SUZUKA_BODY = `<!-- suzuka:summary -->
> [!WARNING]
> **Caution** — work-org/nj-homes-choice-next#88

The form now collects annual income and the limits move to one table. The API client
still multiplies by 12 before sending, so every household is overstated twelvefold; the
old monthly limits in \`forms/form.tsx\` are left unused.

<details><summary>Evidence</summary>

\`api/eligibility.ts:41\` still computes \`income * 12\` after the form switched units.

</details>

## Impact Analysis
- Every submitted application overstates income by 12×.
- Households near a limit are rejected that should qualify.

## Deterministic Checks
head \`4f2c1a9\` · base \`9d81c0a\`

typecheck passed · lint passed · tests passed · bundle passed — 1 schema touched

| Check | Result | Detail |
|---|---|---|
| typecheck | passed | tsc --noEmit · 38s |
| tests | passed | 412 passed · 2 skipped |
| bundle | passed | all chunks within budget |

Bundle budget:

| Chunk | Size | Budget | |
|---|---|---|---|
${BUNDLE_ROWS}

## Findings
1 posted as an inline comment: eligibility.ts:41.

## Cross-module interactions
- forms → api: the unit changed on one side only.

[Full review](https://suzuka.example.dev/r/88) · [Review page](https://suzuka.example.dev/p/88)

Reviewed \`4f2c1a9\` against \`9d81c0a\`. Comment \`/review\` to re-run, \`/retry\` after a failure, or \`/memory <guidance>\` to teach Suzuka.
`;

const HUNK = `@@ -38,4 +38,4 @@ export const submitEligibility = async (form: Form) => {
   const household = form.household;
   const income = form.income;
-  return post("/eligibility", { household, monthly: income });
+  return post("/eligibility", { household, annual: income * 12 });`;

export const COMMITS: ReadonlyArray<CommitView> = [
  {
    oid: "a1f03c2e9b11",
    headline: "Ask for annual income on the form",
    body: "",
    author: person("mchen"),
    at: at(2 * DAY),
    checks: { state: "success", total: 4 },
  },
  {
    oid: "b7e2d4416f02",
    headline: "Move limits into one table",
    body: "",
    author: person("mchen"),
    at: at(2 * DAY - 30),
    checks: { state: "success", total: 4 },
  },
  {
    oid: "4f2c1a9e3b7d",
    headline: "Send annual income to the API",
    body: "",
    author: person("mchen"),
    at: at(26 * HOUR),
    checks: { state: "success", total: 4 },
  },
];

const NEW_COMMITS: ReadonlyArray<CommitView> = [
  ...COMMITS,
  {
    oid: "c90d5e17aa04",
    headline: "Stop multiplying by 12 in the client",
    body: "",
    author: person("mchen"),
    at: at(3 * HOUR),
    checks: { state: "success", total: 4 },
  },
  {
    oid: "5be81f3c0d9e",
    headline: "Drop the old monthly limits",
    body: "",
    author: person("mchen"),
    at: at(3 * HOUR - 4),
    checks: { state: "pending", total: 4 },
  },
];

export const TIMELINE: ReadonlyArray<TimelineItemView> = [
  {
    kind: "push",
    id: "p1",
    at: at(2 * DAY),
    url: "",
    author: person("mchen"),
    commits: COMMITS.slice(0, 2).map((c) => ({ oid: c.oid, headline: c.headline })),
    forced: false,
  },
  {
    kind: "thread",
    id: "t1",
    at: at(DAY + 2 * HOUR),
    url: "",
    threadId: "T1",
    path: "api/eligibility.ts",
    line: 41,
    isResolved: false,
    isOutdated: false,
    resolvedBy: null,
    diffHunk: HUNK,
    comments: [
      {
        id: "c1",
        author: SUZUKA,
        body: "Units: the form already collects **annual** income, so `income * 12` sends twelve years' worth. Send `income` as is.",
        at: at(DAY + 2 * HOUR),
        url: "",
      },
    ],
  },
  {
    kind: "thread",
    id: "t2",
    at: at(DAY + 2 * HOUR),
    url: "",
    threadId: "T2",
    path: "forms/form.tsx",
    line: 14,
    isResolved: false,
    isOutdated: false,
    resolvedBy: null,
    diffHunk:
      "@@ -12,3 +12,3 @@\n const limits = LIMITS;\n-const monthly = MONTHLY_LIMITS;\n+const annual = ANNUAL_LIMITS;",
    comments: [
      {
        id: "c2",
        author: SUZUKA,
        body: "`MONTHLY_LIMITS` is now unused here; `forms/limits.ts` holds the one table.",
        at: at(DAY + 2 * HOUR),
        url: "",
      },
    ],
  },
  {
    kind: "comment",
    id: "c3",
    at: at(20 * HOUR),
    url: "",
    author: person("arossi"),
    body: "Do we need to migrate the applications already in flight? A few were entered monthly last week.",
  },
  {
    kind: "thread",
    id: "t3",
    at: at(18 * HOUR),
    url: "",
    threadId: "T3",
    path: "forms/limits.ts",
    line: 2,
    isResolved: true,
    isOutdated: false,
    resolvedBy: "mchen",
    diffHunk: "@@ -1,2 +1,2 @@\n-export const LIMITS = {\n+export const ANNUAL_LIMITS = {",
    comments: [
      {
        id: "c4",
        author: person("arossi"),
        body: "Name it for the unit?",
        at: at(18 * HOUR),
        url: "",
      },
      { id: "c5", author: person("mchen"), body: "Done.", at: at(17 * HOUR), url: "" },
      { id: "c6", author: person("arossi"), body: "👍", at: at(17 * HOUR), url: "" },
    ],
  },
  {
    kind: "review",
    id: "r1",
    at: at(HOUR),
    url: "",
    author: person("arossi"),
    state: "approved",
    body: "Thanks for catching the unit. Migration can be a follow-up; I opened NJH-430.",
  },
];

const REREVIEW_TIMELINE: ReadonlyArray<TimelineItemView> = [
  ...TIMELINE.slice(0, -1),
  {
    kind: "push",
    id: "p2",
    at: at(3 * HOUR),
    url: "",
    author: person("mchen"),
    commits: NEW_COMMITS.slice(3).map((c) => ({ oid: c.oid, headline: c.headline })),
    forced: false,
  },
  {
    kind: "review",
    id: "r1",
    at: at(HOUR),
    url: "",
    author: person("arossi"),
    state: "approved",
    body: "Thanks for catching the unit. Migration can be a follow-up; I opened NJH-430.",
  },
  {
    kind: "comment",
    id: "c7",
    at: at(40),
    url: "",
    author: person("mchen"),
    body: "Agreed on the migration. Keeping it out of this PR so the form ships before the cycle; NJH-430 adds it.",
  },
];

const run = (
  name: string,
  workflow: string | null,
  conclusion: "success" | "failure" | null,
  seconds: number
) => ({
  name,
  workflow,
  status: conclusion === null ? ("in-progress" as const) : ("completed" as const),
  conclusion,
  startedAt: at(26 * HOUR),
  completedAt:
    conclusion === null ? null : new Date(NOW - 26 * HOUR * 60_000 + seconds * 1000).toISOString(),
  durationMs: conclusion === null ? null : seconds * 1000,
  url: "https://github.com/work-org/nj-homes-choice-next/actions/runs/1",
});

export const CHECK_RUNS = [
  run("typecheck", "CI", "success", 38),
  run("test", "CI", "success", 94),
  run("lint", "CI", "success", 21),
  run("bundle", "Budgets", "success", 62),
];

export const WALKTHROUGH_MD = `## Why the change
Applicants were entering yearly figures as monthly, so the form now asks for annual income and checks it against one table of annual limits.

## Special things to note
- The API client still multiplies by 12, so every household is overstated twelvefold. [API client still sends monthly income](finding:f-high)
- \`forms/form.tsx\` keeps its own copy of the old monthly limits, now unused.
- Nothing migrates applications already in flight (NJH-430).

## Change outline
### Where it lands
\`\`\`
api/
  eligibility.ts      sends the household and income
forms/
  limits.ts           one table of annual limits
  form.tsx            asks for annual income
  limits.test.ts      a case for the new unit
\`\`\`

### The eligibility payload \`api/eligibility.ts\`
\`\`\`diff
 POST /eligibility
-  { household, monthly: income }
+  { household, annual: income * 12 }   # ● still × 12
\`\`\`

### The limits
\`\`\`diff
-MONTHLY_LIMITS[size] = annual / 12
+ANNUAL_LIMITS[size]  = 74_550 for 3, 82_800 for 4, …
\`\`\`
`;

const DELTA_MD = `## Why the change
Both review comments are addressed: the client sends annual income unchanged, and the unused monthly limits are gone.

\`\`\`diff
 submitEligibility(form):
-  post("/eligibility", { household, annual: income * 12 })
+  post("/eligibility", { household, annual: income })
 forms/form.tsx:
-  const monthly = MONTHLY_LIMITS
\`\`\`
`;

const walkthrough = (fields: Partial<ConstructorParameters<typeof Walkthrough>[0]>) =>
  new Walkthrough({
    state: "ready",
    markdown: WALKTHROUGH_MD,
    head: "4f2c1a9e3b7d",
    fromHead: null,
    fullSummaryId: null,
    harness: "codex",
    model: "GPT-6.1-Sol",
    effort: "high",
    sessionId: null,
    lines: 34,
    tokensEstimate: null,
    filesRead: 7,
    filesTotal: 7,
    startedAt: null,
    durationMs: 41_000,
    tokens: 38_000,
    reason: null,
    evidence: null,
    ...fields,
  });

const WALKTHROUGHS = {
  ready: { full: walkthrough({}), delta: null, prompts: [] },
  writing: {
    full: walkthrough({
      state: "writing",
      markdown: WALKTHROUGH_MD.slice(0, WALKTHROUGH_MD.indexOf("## Special")),
      filesRead: 4,
      filesTotal: 7,
      durationMs: null,
      tokens: null,
    }),
    delta: null,
    prompts: [],
  },
  waiting: {
    full: walkthrough({
      state: "waiting",
      markdown: "",
      lines: 4812,
      tokensEstimate: 120_000,
      durationMs: null,
      tokens: null,
    }),
    delta: null,
    prompts: [],
  },
  failed: {
    full: walkthrough({
      state: "failed",
      markdown: "",
      reason: "Codex on Linux VM needs you to sign in again.",
      evidence: "codex: not signed in (401) · run `codex login` on lucas-vm",
    }),
    delta: null,
    prompts: [],
  },
  rereview: {
    full: walkthrough({}),
    delta: walkthrough({
      markdown: DELTA_MD,
      head: "5be81f3c0d9e",
      fromHead: "4f2c1a9e3b7d",
      fullSummaryId: RiskSummaryId.make("rs-88"),
      durationMs: 14_000,
    }),
    prompts: [],
  },
  session: {
    full: walkthrough({
      harness: "claude",
      model: "Opus 5.5",
      markdown: `## Why the change
A throwaway prototype of the Orchestrator layouts, published so they can be reviewed away from the desk; plus the glossary and docs it needed.

## Special things to note
- The publish script embeds an API token in source, and the artifact URL is public.
- No app code changed: everything lives under \`prototypes/\` and \`docs/\`.

## Change outline
\`\`\`diff
 publish():
-  url = env.ARTIFACT_URL
+  url = "https://claude.ai/artifact/…"
+  token = "sk-ant-api03-…"   # ◆ in source
   upload(index.html, url, token)
\`\`\`
`,
      durationMs: 26_000,
    }),
    delta: null,
    prompts: [
      { turnIndex: 21, prompt: "Record the glossary terms for Review.", files: 1 },
      { turnIndex: 22, prompt: "Write the Review workflow section.", files: 1 },
      {
        turnIndex: 23,
        prompt:
          "Let's go on to 177. Prototype the Orchestrator layouts, then publish them so I can review on my phone.",
        files: 2,
      },
    ],
  },
} satisfies Record<string, Walkthroughs>;

const SCENES = new Map(Object.entries(WALKTHROUGHS));

/** The scene's walkthroughs, by its name: `ov-writing`, `ov-rereview`, `session-ov`… */
export const walkthroughsFor = (scene: string): Walkthroughs => {
  if (scene.startsWith("session")) return WALKTHROUGHS.session;

  return SCENES.get(scene.replace(/^ov-?/, "").split("-")[0] ?? "") ?? WALKTHROUGHS.ready;
};

/** PR #88's detail with Overview's fields, per scene. */
export const overviewDetail = (base: PullDetailView, scene: string): PullDetailView => {
  const rereview = scene.includes("rereview");
  const own = scene.includes("own");

  return {
    ...base,
    body: own ? "" : DESCRIPTION,
    author: own ? { login: base.viewerLogin, avatarUrl: "" } : base.author,
    commits: rereview ? NEW_COMMITS.length : COMMITS.length,
    headRefOid: rereview ? "5be81f3c0d9e" : base.headRefOid,
    timeline: rereview ? REREVIEW_TIMELINE : TIMELINE,
    commitList: rereview ? NEW_COMMITS : COMMITS,
    checkRuns: rereview
      ? [...CHECK_RUNS.slice(0, 3), run("bundle", "Budgets", null, 0)]
      : CHECK_RUNS,
    botSummary: {
      bot: "suzuka",
      commentId: "IC_1",
      url: "https://github.com/work-org/nj-homes-choice-next/pull/88#issuecomment-1",
      body: SUZUKA_BODY,
      verdict: { alert: "warning", word: "Caution" },
      reviewedHead: "4f2c1a9",
      reviewedBase: "9d81c0a",
      updatedAt: at(3 * HOUR),
    },
    viewerLastReview: rereview ? { at: at(5 * HOUR), commitOid: "4f2c1a9e3b7d" } : null,
    published: null,
  };
};

/** The tab a scene opens on: `ov-conversation`, `ov-commits`, `ov-checks`. */
export const openSceneTab = (scene: string, subjectKey: string) => {
  const tab = (["conversation", "commits", "checks", "changes"] as const).find((t) =>
    scene.endsWith(t)
  );

  setTab(subjectKey, (tab ?? "overview") satisfies TabId);
};
