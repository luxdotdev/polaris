/**
 * The Reviewer in the smoke test, through the typed IPC bridge: the Reviewer
 * settings, a Risk Summary of the smoke session's Turns (the bench Harness
 * reviews them with schema output), the cached answer, and a follow-up.
 */
import type { Page } from "playwright-core";

const source = () => `(async () => {
  const api = window.polaris;
  const hostKey = "local";
  const must = (result, what) => {
    if (!result.ok) throw new Error(what + ": " + result.error.code + " " + result.error.message);
    return result.value;
  };
  // A cached Snapshot may predate the smoke session; the events after it bring it.
  const sessions = await new Promise((resolve) => {
    const seen = [];
    const close = api.subscribe("host", { hostKey }, { items: (items) => {
      for (const i of items) {
        if (i._tag === "Snapshot") seen.push(...i.sessions.map((s) => s.session));
        if (i._tag === "Event" && i.envelope.event._tag === "SessionCreated") seen.push(i.envelope.event.session);
        if (i._tag === "Synchronized") { close(); resolve(seen); return; }
      }
    } });
  });
  const session = sessions.find((s) => s.cwd.endsWith("/smoke-repo"));
  if (!session) throw new Error("no session in the smoke repo among " + sessions.map((s) => s.cwd).join(", "));
  const { workspaceId, id: sessionId } = session;

  const before = must(await api.request("review.reviewerSettings", { hostKey, workspaceId }), "review.reviewerSettings");
  const sol = { harness: "codex", model: "gpt-6.1-sol", effort: "high" };
  must(await api.request("review.setReviewerSettings", { hostKey, settings: { default: null, workspaces: { [workspaceId]: sol } } }), "review.setReviewerSettings");
  const overridden = must(await api.request("review.reviewerSettings", { hostKey, workspaceId }), "review.reviewerSettings");
  must(await api.request("review.setReviewerSettings", { hostKey, settings: before.settings }), "review.setReviewerSettings");

  const request = {
    hostKey, workspaceId, checkoutId: null, since: null, refresh: false, context: null,
    subject: { _tag: "SessionTurns", sessionId, firstTurnId: null, lastTurnId: null },
  };
  const started = must(await api.request("review.runRiskSummary", request), "review.runRiskSummary");
  let summary = started;
  for (let i = 0; i < 200 && summary.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 100));
    summary = must(await api.request("review.riskSummary", { hostKey, ref: { _tag: "ById", summaryId: started.id } }), "review.riskSummary");
  }
  const cached = must(await api.request("review.runRiskSummary", request), "review.runRiskSummary");
  const asked = must(await api.request("review.askFinding", { hostKey, summaryId: summary.id, findingId: null, question: "Anything else worth a look?" }), "review.askFinding");

  return {
    auto: before.resolved.choice && before.resolved.choice.harness,
    override: overridden.resolved.source + ":" + overridden.resolved.choice.model,
    status: summary.status,
    rules: summary.layers.rules.status,
    agent: summary.layers.agent.status,
    findings: summary.findings.map((f) => f.source + " " + f.path + ":" + f.lines.start),
    reviewerSession: summary.reviewer && summary.reviewer.sessionId,
    cached: cached.id === summary.id,
    followUp: asked.sessionId === (summary.reviewer && summary.reviewer.sessionId),
  };
})()`;

export const reviewerFlow = async ({
  page,
  step,
}: {
  readonly page: Page;
  readonly step: (line: string) => void;
}) => {
  // SAFETY: the evaluated source returns exactly this object, or throws.
  const result = (await page.evaluate(source())) as {
    readonly auto: string | null;
    readonly override: string;
    readonly status: string;
    readonly agent: string;
    readonly findings: ReadonlyArray<string>;
    readonly reviewerSession: string | null;
    readonly cached: boolean;
    readonly followUp: boolean;
  };

  step(`Reviewer: ${JSON.stringify(result)}`);

  const ok =
    result.auto !== null &&
    result.override === "workspace:gpt-6.1-sol" &&
    result.status === "completed" &&
    result.agent === "completed" &&
    result.findings.some((f) => f.startsWith("agent ")) &&
    result.reviewerSession !== null &&
    result.cached &&
    result.followUp;

  if (!ok) throw new Error("the Reviewer flow didn't complete as expected");
};
