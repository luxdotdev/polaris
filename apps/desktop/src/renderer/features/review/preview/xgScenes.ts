/**
 * `#review/xg`, `#review/xg-chat`: Paper X-G's states on #88. A critical finding open (for the
 * readout and Submit review's pause), #88 as layer 2 of a stack with merged, open and draft
 * layers, and for `xg-chat` a conversation with the Reviewer, one answer still streaming.
 */
import { RiskFinding, RiskFindingId, SessionId, TurnItem } from "@polaris/protocol";
import type { PullDetailView, StackView } from "../../../../shared/github.ts";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { STACK } from "../../pulls/preview/stack.ts";
import { askStore } from "../../risk/data/actions.ts";
import { setChatting } from "../../risk/data/ui.ts";
import { turn, view } from "../../session/preview/fixtures.ts";
import { PULL_FINDINGS } from "./fixtures.ts";

export const isXg = (scene: string) => scene.startsWith("xg");

const CRITICAL = new RiskFinding({
  id: RiskFindingId.make("f-critical"),
  identity: "f-critical",
  source: "rule",
  ruleId: "polaris/trusted-input",
  path: "api/eligibility.ts",
  lines: { start: 38, end: 38, side: "new" },
  severity: "critical",
  confidence: 0.97,
  title: "Income limit read from the request",
  reason: "req.body.limit wins whenever it's sent: anyone can post a higher limit and pass.",
  suggestion: null,
  status: "open",
  resolution: null,
});

export const XG_FINDINGS = [CRITICAL, ...PULL_FINDINGS];

const STATUSES = ["merged", "open", "open", "draft"] as const;

/** #88 as layer 2 of 4: merged under it, open over it, a draft on top. */
export const xgDetail = (base: PullDetailView): PullDetailView => {
  const members: StackView["members"] = STACK.members.map((m, i) =>
    i === STACK.position - 1
      ? { ...m, number: base.number, title: base.title, status: "open" }
      : { ...m, status: STATUSES[i] ?? "open" }
  );

  return { ...base, stack: { ...STACK, members } };
};

const REVIEWER = SessionId.make("s-reviewer");

const reply = (answer: string) => `\`\`\`json\n${JSON.stringify({ answer })}\n\`\`\``;

/** The Reviewer's session: the first question answered, the second still running. */
export const reviewerSession = (): SessionModel => {
  const first = turn(REVIEWER, 1, "Why is the critical one critical?", "completed");
  const second = turn(REVIEWER, 2, "Does anything else read the limit from the client?", "working");

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
            "Because `req.body.limit` wins whenever it's sent. Anyone can post a higher limit and pass the check; the fallback only runs when the field is missing.\n\nThe limit should come from `incomeLimit(household)` alone."
          ),
        }),
      ]),
      view(second, []),
    ],
    pendingApprovals: [],
  };
};

export const REVIEWER_SESSION = REVIEWER;

/** `xg-chat`: two questions on #88's summary, the conversation in place of the findings. */
export const setUpXg = (scene: string, subjectKey: string, summaryId: string) => {
  if (scene !== "xg-chat") return;

  const sent = (n: number) => ({
    kind: "sent" as const,
    sessionId: REVIEWER,
    turnId: turn(REVIEWER, n, "", "completed").id,
  });

  askStore.setState({
    [summaryId]: [
      {
        id: "ask-1",
        question: "Why is the critical one critical? The fallback still calls incomeLimit.",
        findingId: null,
        state: sent(1),
      },
      {
        id: "ask-2",
        question: "Does anything else read the limit from the client?",
        findingId: null,
        state: sent(2),
      },
    ],
  });
  setChatting(subjectKey, true);
};
