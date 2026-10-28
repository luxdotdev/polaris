/**
 * A synthetic Turn for the diff bench: a git patch of TypeScript-like files totalling `lines`
 * diff lines (context, added and removed, some long enough to wrap on a phone), and a Risk
 * Summary with one finding per severity. Deterministic, so runs compare.
 */
import {
  ReviewSubject,
  RiskFinding,
  RiskFindingId,
  RiskSummary,
  RiskSummaryId,
  RiskSummaryKey,
  RiskSummaryLayers,
  SessionId,
  WorkspaceId,
  LineRange,
  LayerRun,
} from "@polaris/protocol";

const WORDS = [
  "const",
  "session",
  "await",
  "return",
  "summary",
  "finding",
  "publish",
  "artifact",
  "export",
  "connection",
  "review",
  "turn",
];

/** A seeded PRNG (mulberry32), so every run gets the same patch. */
const random = (seed: number) => {
  let a = seed;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const codeLine = (next: () => number, n: number) => {
  const indent = "  ".repeat(Math.floor(next() * 4));
  // About one line in eight runs long enough to wrap twice on an iPhone.
  const words = next() < 0.12 ? 18 + Math.floor(next() * 10) : 3 + Math.floor(next() * 6);

  const body = Array.from({ length: words }, () => WORDS[Math.floor(next() * WORDS.length)]).join(
    " "
  );

  return `${indent}${body}; // ${n}`;
};

export interface BenchPatch {
  readonly patch: string;
  readonly files: number;
  /** Diff lines: context, added and removed. */
  readonly lines: number;
}

const HUNK = 50;

const FILES = 10;

/** `lines` diff lines over ten files of hunks of fifty. */
export const benchPatch = (lines = 2000): BenchPatch => {
  const next = random(458);
  const perFile = Math.ceil(lines / FILES);
  const parts: Array<string> = [];
  let written = 0;

  for (let f = 0; f < FILES && written < lines; f += 1) {
    const path = `src/feature${f}/module${f}.ts`;
    parts.push(
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}`
    );
    let oldLine = 1;
    let newLine = 1;

    for (let inFile = 0; inFile < perFile && written < lines;) {
      const size = Math.min(HUNK, perFile - inFile, lines - written);
      const body: Array<string> = [];
      let oldCount = 0;
      let newCount = 0;

      for (let i = 0; i < size; i += 1) {
        const roll = next();
        const text = codeLine(next, written + i);

        if (roll < 0.55) {
          body.push(` ${text}`);
          oldCount += 1;
          newCount += 1;
        } else if (roll < 0.8) {
          body.push(`+${text}`);
          newCount += 1;
        } else {
          body.push(`-${text}`);
          oldCount += 1;
        }
      }

      parts.push(
        `@@ -${oldLine},${oldCount} +${newLine},${newCount} @@ function step${inFile}()`,
        ...body
      );
      oldLine += oldCount + 20;
      newLine += newCount + 20;
      inFile += size;
      written += size;
    }
  }

  return { patch: `${parts.join("\n")}\n`, files: FILES, lines: written };
};

const finding = (
  id: string,
  severity: RiskFinding["severity"],
  path: string,
  line: number,
  title: string,
  reason: string,
  confidence: number
) =>
  new RiskFinding({
    id: RiskFindingId.make(id),
    identity: id,
    source: severity === "critical" ? "rule" : "agent",
    ruleId: severity === "critical" ? "secrets.anthropic-key" : null,
    path,
    lines: new LineRange({ start: line, end: line, side: "new" }),
    severity,
    confidence,
    title,
    reason,
    suggestion: null,
    status: "open",
    resolution: null,
  });

export const benchSummary = (): RiskSummary =>
  new RiskSummary({
    id: RiskSummaryId.make("bench-summary"),
    key: new RiskSummaryKey({
      repo: "/bench",
      mergeBase: "0".repeat(40),
      head: "9be04d".padEnd(40, "0"),
      since: null,
    }),
    workspaceId: WorkspaceId.make("bench-workspace"),
    subject: ReviewSubject.cases.SessionTurns.make({
      sessionId: SessionId.make("bench-session"),
      firstTurnId: null,
      lastTurnId: null,
    }),
    checkoutId: null,
    status: "completed",
    layers: new RiskSummaryLayers({
      rules: new LayerRun({ status: "completed", note: null }),
      agent: new LayerRun({ status: "completed", note: null }),
    }),
    reviewer: null,
    cost: null,
    note: null,
    findings: [
      finding(
        "c1",
        "critical",
        "src/feature0/module0.ts",
        4,
        "Secret-like value committed",
        "An Anthropic API key is hard-coded and will ship. Read it from the environment.",
        0.97
      ),
      finding(
        "h1",
        "high",
        "src/feature3/module3.ts",
        40,
        "Unbounded retry loop",
        "The loop retries without a limit or backoff when the Host refuses.",
        0.81
      ),
      finding(
        "m1",
        "medium",
        "src/feature6/module6.ts",
        12,
        "Error swallowed",
        "The catch drops the failure, so the caller never learns the publish failed.",
        0.62
      ),
      finding(
        "l1",
        "low",
        "src/feature9/module9.ts",
        30,
        "Magic number",
        "The 150 ms debounce is repeated; name it once.",
        0.4
      ),
    ],
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    endedAt: new Date(Date.now() - 55_000).toISOString(),
  });
