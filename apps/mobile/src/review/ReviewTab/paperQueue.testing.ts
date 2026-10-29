/** Paper MX-K's queue with MX-M's clean turn, as Hosts and read turns, for side-by-side checks. */
import { RiskFinding } from "@polaris/protocol";
import { Struct } from "effect";
import { applyHostItem, emptyHostFeed } from "../../home/feed/fold.ts";
import {
  type SessionInput,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "../../home/fixtures.testing.ts";
import type { HomeHost } from "../../home/model/home.ts";
import { finding, summary as riskSummary } from "../review.testing.ts";
import type { QueueTurn } from "./queue.ts";

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const at = (input: SessionInput & { readonly minutes: number }) =>
  session({ ...input, updatedAt: minutesAgo(input.minutes), acceptedThroughIndex: null });

const host = (
  hostId: string,
  name: string,
  sessions: ReadonlyArray<SessionInput & { readonly minutes: number }>
): HomeHost => ({
  hostId,
  name,
  connection: "connected",
  followed: {
    state: [
      snapshot({
        workspaces: [
          workspace("w1", "polaris"),
          workspace("w2", "nj-homes"),
          workspace("w3", "dcai"),
        ],
        sessions: sessions.map((s) => summary(at(s))),
      }),
      synchronized(),
    ].reduce(applyHostItem, emptyHostFeed),
    seen: true,
    error: null,
  },
});

export const paperQueueHosts: ReadonlyArray<HomeHost> = [
  host("studio", "mac-studio", [
    { id: "artifact", title: "Artifact upload for prototypes", turnCount: 24, minutes: 6 },
    {
      id: "relay",
      title: "Route hosts through the Relay",
      harness: "codex",
      turnCount: 9,
      minutes: 14,
    },
    {
      id: "gpui",
      title: "Spike GPUI review screen",
      harness: "codex",
      workspaceId: "w3",
      turnCount: 12,
      minutes: 60,
    },
  ]),
  host("rpi", "lucas-rpi", [
    {
      id: "eligibility",
      title: "Fix eligibility form validation",
      workspaceId: "w2",
      turnCount: 3,
      minutes: 31,
    },
  ]),
];

const secret = RiskFinding.make({
  ...Struct.pick(finding("secret", "critical", { path: "src/serve.ts", line: 4 }), [
    "id",
    "identity",
    "source",
    "ruleId",
    "path",
    "lines",
    "severity",
    "confidence",
    "suggestion",
    "status",
    "resolution",
  ]),
  title: "Secret-like value committed",
  reason: "An Anthropic API key is hard-coded and will ship with the prototype.",
});

const turn = (
  number: number,
  files: QueueTurn["files"],
  findings: ReadonlyArray<RiskFinding>
): QueueTurn => ({
  turnId: `t${number}`,
  number,
  files,
  risk: { kind: "summary", summary: riskSummary("completed", findings) },
});

/** Read turns by `turnKey`. */
export const paperQueueTurns: ReadonlyMap<string, QueueTurn> = new Map([
  [
    "studio/artifact:24",
    turn(24, { count: 3, added: 88, removed: 14 }, [
      secret,
      finding("h", "high"),
      finding("m1", "medium"),
      finding("m2", "medium"),
    ]),
  ],
  [
    "studio/relay:9",
    turn(9, { count: 6, added: 140, removed: 32 }, [
      finding("r1", "high"),
      finding("r2", "high"),
      finding("r3", "medium"),
    ]),
  ],
  ["rpi/eligibility:3", turn(3, { count: 2, added: 12, removed: 5 }, [finding("e", "medium")])],
  ["studio/gpui:12", turn(12, { count: 4, added: 61, removed: 9 }, [])],
]);
