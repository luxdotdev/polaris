/**
 * Fixtures for the Review preview, after Paper R1 (1SM-0: pull request #88) and R2 (223-0:
 * an Agent Session's Turns 22–24), plus synthetic large Reviews for the 2,000 and 10,000
 * file thresholds. Patches are real git output shapes, so they go through the same parser.
 */
import {
  AgentSession,
  ReviewCheckout,
  ReviewCheckoutId,
  RiskFinding,
  RiskFindingId,
  SessionId,
  Turn,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import type { ReviewSubject } from "@polaris/protocol";
import { Data } from "effect";
import type { PullDetailView } from "../../../../shared/github.ts";
import type { SessionModel, TurnView } from "../../../store/sessionModel.ts";

const Subjects = Data.taggedEnum<ReviewSubject>();

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const file = (
  path: string,
  hunks: ReadonlyArray<string>,
  header = "index 1111111..2222222 100644"
) =>
  [`diff --git a/${path} b/${path}`, header, `--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");

export const PULL_PATCH = `${[
  file("api/eligibility.ts", [
    "@@ -36,7 +36,8 @@ export async function submitEligibility(form: EligibilityForm) {",
    " export async function submitEligibility(form: EligibilityForm) {",
    "   const household = form.members.length;",
    "-  const income = form.monthlyIncome * 12;",
    "+  const income = form.annualIncome;",
    "+  const limit = incomeLimit(household);",
    " ",
    '-  return api.post("/eligibility", { household, income });',
    '+  return api.post("/eligibility", { household, income: income * 12, limit });',
    " }",
  ]),
  file("forms/limits.ts", [
    "@@ -1,6 +1,12 @@",
    " // Income limits by household size, from the 2026 program rules.",
    "-export const LIMITS = [0, 41_000, 47_000, 53_000];",
    "+export const LIMITS: ReadonlyArray<number> = [",
    "+  0, 41_000, 47_000, 53_000, 58_500, 63_000, 67_500, 72_000, 76_500,",
    "+];",
    "+",
    "+export const incomeLimit = (household: number): number =>",
    "+  LIMITS[Math.min(household, LIMITS.length - 1)] ?? 0;",
    " ",
    " export const MAX_HOUSEHOLD = 8;",
  ]),
  file("forms/form.tsx", [
    "@@ -12,7 +12,9 @@ export function EligibilityForm() {",
    "   return (",
    "     <form onSubmit={submit}>",
    '-      <Field name="monthlyIncome" label="Monthly income" />',
    "+      {/* Annual income replaces monthly income */}",
    '+      <Field name="annualIncome" label="Annual income" />',
    "+      <Hint>Before taxes, for everyone in the household.</Hint>",
    "       <Members />",
    "     </form>",
    "   );",
  ]),
  file("forms/limits.test.ts", [
    "@@ -1,4 +1,8 @@",
    ' import { expect, test } from "bun:test";',
    '+import { incomeLimit } from "./limits.ts";',
    " ",
    ' test("limits grow with the household", () => {',
    "+  expect(incomeLimit(2)).toBeGreaterThan(incomeLimit(1));",
    "+  expect(incomeLimit(99)).toBe(76_500);",
    " });",
  ]),
  file("README.md", [
    "@@ -3,3 +3,3 @@",
    " ## Eligibility",
    "-Monthly income, times twelve.",
    "+Annual income.",
    " ",
  ]),
  file("api/types.ts", [
    "@@ -8,3 +8,3 @@",
    " export interface EligibilityForm {",
    "-  monthlyIncome: number;",
    "+  annualIncome: number;",
    "   members: ReadonlyArray<Member>;",
  ]),
  file("CHANGELOG.md", [
    "@@ -1,2 +1,3 @@",
    " # Changelog",
    "+- Eligibility asks for annual income.",
    " ",
  ]),
].join("\n")}\n`;

const HEAD = "4f2c1a9e3b7d";

const BASE = "9d81c0a4e2f1";

export const PULL_DETAIL: PullDetailView = {
  id: "PR_88",
  number: 88,
  title: "Eligibility: annual income field",
  body: "",
  url: "https://github.com/work-org/nj-homes-choice-next/pull/88",
  repo: "work-org/nj-homes-choice-next",
  state: "open",
  isDraft: false,
  author: { login: "mchen", avatarUrl: "" },
  viewerLogin: "lucasdoell",
  viewerCanApprove: true,
  headRefName: "eligibility-annual",
  headRefOid: HEAD,
  baseRefName: "nightly",
  baseRefOid: BASE,
  files: [
    ["api/eligibility.ts", 6, 3, "unviewed"],
    ["forms/limits.ts", 22, 4, "unviewed"],
    ["forms/form.tsx", 3, 1, "unviewed"],
    ["forms/limits.test.ts", 2, 0, "unviewed"],
    ["README.md", 1, 1, "viewed"],
    ["api/types.ts", 1, 1, "viewed"],
    ["CHANGELOG.md", 1, 0, "viewed"],
  ].map(([path, additions, deletions, viewed]) => ({
    path: String(path),
    additions: Number(additions),
    deletions: Number(deletions),
    changeType: "MODIFIED",
    viewed: viewed === "viewed" ? "viewed" : "unviewed",
  })),
  threads: [],
  pendingReview: null,
  accountId: 2,
};

export const CHECKOUT = new ReviewCheckout({
  id: ReviewCheckoutId.make("rc-88"),
  workspaceId: WorkspaceId.make("w-nj"),
  subject: Subjects.PullRequest({
    pullRequest: {
      repo: { host: "github.com", owner: "work-org", name: "nj-homes-choice-next" },
      number: 88,
    },
    baseRef: "nightly",
  }),
  path: "/Users/lucas/code/nj-homes.worktrees/.review/pr-88",
  state: "ready",
  blocked: null,
  head: HEAD,
  mergeBase: BASE,
  latestHead: HEAD,
  latestBase: BASE,
  reviewedHead: null,
  reviewedMergeBase: null,
  openedAt: ago(30),
  updatedAt: ago(1),
});

const finding = (
  id: string,
  path: string,
  line: number,
  severity: RiskFinding["severity"],
  confidence: number,
  title: string,
  reason: string,
  source: RiskFinding["source"] = "agent"
) =>
  new RiskFinding({
    id: RiskFindingId.make(id),
    identity: id,
    source,
    ruleId: source === "rule" ? "polaris/duplicate-table" : null,
    path,
    lines: { start: line, end: line, side: "new" },
    severity,
    confidence,
    title,
    reason,
    suggestion: null,
    status: "open",
    resolution: null,
  });

export const PULL_FINDINGS = [
  finding(
    "f-high",
    "api/eligibility.ts",
    41,
    "high",
    0.86,
    "API client still sends monthly income",
    "The form now collects annual income, but submitEligibility multiplies by 12 before sending, so every household is overstated."
  ),
  finding(
    "f-med",
    "forms/limits.ts",
    2,
    "medium",
    0.64,
    "Limits table duplicated in 2 files",
    "forms/form.tsx keeps its own copy.",
    "rule"
  ),
  finding(
    "f-med2",
    "forms/limits.test.ts",
    6,
    "medium",
    0.71,
    "No test covers the 1-person limit",
    ""
  ),
  finding("f-low", "forms/form.tsx", 14, "low", 0.34, "Comment restates the code", ""),
];

// ── Agent Session (R2) ──────────────────────────────────────────────────────

export const SESSION_ID = SessionId.make("s-layout");

const turn = (index: number, prompt: string) =>
  new Turn({
    id: TurnId.make(`t${index}`),
    sessionId: SESSION_ID,
    index,
    prompt,
    attachments: [],
    model: "opus",
    effort: "high",
    status: "completed",
    feedback: null,
    checkpointBefore: `refs/polaris/checkpoints/s-layout/${index}/before`,
    checkpointAfter: `refs/polaris/checkpoints/s-layout/${index}/after`,
    startedAt: ago(90 - index),
    endedAt: ago(80 - index),
  });

const TURNS = [
  turn(21, "Record the glossary terms for Review"),
  turn(22, "Write the Review workflow section"),
  turn(23, "Let's go on to 177. Prototype the Orchestrator layouts, then publish them"),
];

export const TURN_PATCHES = new Map(
  Object.entries({
    t21: `${file("CONTEXT.md", ["@@ -40,2 +40,4 @@", " ## Review", "+**Review Checkout**: a detached worktree on the Host.", "+**Risk Finding**: one flagged place.", " "])}\n`,
    t22: `${file("docs/review.md", ["@@ -1,1 +1,3 @@", " # Review", "+", "+One Review view, two kinds of subject."])}\n`,
    t23: `${[
      file("prototypes/orchestrator-layout/serve.ts", [
        "@@ -1,5 +1,8 @@",
        ' import { publish } from "./publish.ts";',
        "-const ARTIFACT_URL = process.env.ARTIFACT_URL;",
        '+const ARTIFACT_URL = "https://claude.ai/artifact/V6EMS2kK78BdQSRSFFQzgr";',
        '+const API_TOKEN = "sk-ant-api03-Xk2P…m9fQ";',
        " ",
        "+export async function main() {",
        "+  await publish(ARTIFACT_URL, { token: API_TOKEN });",
        "+}",
      ]),
      file("prototypes/orchestrator-layout/index.html", [
        "@@ -1,3 +1,6 @@",
        " <!doctype html>",
        "-<title>Layout</title>",
        "+<title>Orchestrator layout</title>",
        '+<main class="zones">',
        '+  <aside class="input"></aside><section class="intent"></section>',
        "+</main>",
      ]),
    ].join("\n")}\n`,
  })
);

export const SESSION_FINDINGS = [
  finding(
    "f-crit",
    "prototypes/orchestrator-layout/serve.ts",
    3,
    "critical",
    0.97,
    "API key committed in serve.ts",
    "Accepting is paused until this is fixed or you override it. No rule can hide a critical finding.",
    "rule"
  ),
  finding(
    "f-high-2",
    "prototypes/orchestrator-layout/index.html",
    4,
    "high",
    0.7,
    "Inline layout skips the shell’s zones",
    ""
  ),
];

export const SESSION = new AgentSession({
  id: SESSION_ID,
  workspaceId: WorkspaceId.make("w-polaris"),
  harness: "claude",
  title: "Orchestrator layout prototype",
  cwd: "/Users/lucas/code/polaris",
  worktreeId: null,
  state: "idle",
  permissionMode: "auto-edits",
  model: "opus",
  effort: "high",
  parentSessionId: null,
  forkedFromTurnId: null,
  harnessCursor: null,
  turnCount: 24,
  contextUsage: null,
  lastError: null,
  acceptedThroughIndex: 20,
  pullRequest: null,
  createdAt: ago(600),
  updatedAt: ago(5),
});

export const sessionModel = (): SessionModel => ({
  // SAFETY: a fixture sequence; any positive number is a valid one.
  sequence: 400 as SessionModel["sequence"],
  synchronized: true,
  session: SESSION,
  turns: TURNS.map((t): TurnView => ({ turn: t, items: [], live: new Map(), subagents: [] })),
  pendingApprovals: [],
});

// ── Large Reviews ───────────────────────────────────────────────────────────

/** `files` small TypeScript files, as git would diff them. */
export const manyFilesPatch = (files: number) => {
  const out: Array<string> = [];

  for (let f = 0; f < files; f++) {
    out.push(
      file(`src/module${Math.floor(f / 50)}/file${f}.ts`, [
        "@@ -1,4 +1,5 @@",
        ` export function handler${f}(input: Request): Promise<Response> {`,
        `-  const value = await fetch("https://example.com/${f}");`,
        `+  const next = await fetch("https://example.com/v2/${f}");`,
        `+  if (!next.ok) throw new Error("bad ${f}");`,
        "   return new Response(JSON.stringify({ ok: true }));",
        " }",
      ])
    );
  }

  return `${out.join("\n")}\n`;
};
