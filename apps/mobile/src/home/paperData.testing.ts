/** Paper MX-C's Home as Hosts: the same sessions, Hosts and workspaces, for side-by-side checks. */
import type { ConnectionState, HostStreamItem } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "./feed/fold.ts";
import {
  commandApproval,
  constellation,
  question,
  type SessionInput,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "./fixtures.testing.ts";
import type { HomeHost } from "./model/home.ts";

const host = (
  hostId: string,
  name: string,
  items: ReadonlyArray<HostStreamItem>,
  connection: ConnectionState = "connected"
): HomeHost => ({
  hostId,
  name,
  connection,
  followed: { state: items.reduce(applyHostItem, emptyHostFeed), seen: true, error: null },
});

/** Ages read as in MX-C ("42m"), so they count back from the launch, not the tests' fixed now. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const at = (input: SessionInput & { readonly minutes: number }) =>
  session({ ...input, updatedAt: minutesAgo(input.minutes) });

const NAMES = ["polaris", "nj-homes", "docs", "site", "bench", "spec", "sdk", "ui", "raycast"];

const studio = host("studio", "mac-studio", [
  snapshot({
    workspaces: NAMES.map((name, n) => workspace(`w${n + 1}`, name)),
    sessions: [
      summary(
        at({
          id: "spike",
          title: "Spike GPUI review screen",
          harness: "codex",
          state: "needs-you",
          minutes: 42,
        }),
        [commandApproval("spike", "r1", "cargo build --release", minutesAgo(42))]
      ),
      summary(
        at({
          id: "eligibility",
          title: "Fix eligibility form validation",
          workspaceId: "w2",
          state: "needs-you",
          minutes: 18,
        }),
        [
          question(
            "eligibility",
            "r2",
            "Keep the old ZIP check?",
            ["Keep it", "Drop it"],
            minutesAgo(18)
          ),
        ]
      ),
      summary(
        at({
          id: "planning",
          title: "Polaris planning",
          state: "working",
          turnCount: 24,
          minutes: 1,
          lastReplyPreview: "Writing index.html",
        })
      ),
      summary(at({ id: "lead", title: "Orchestrator overhaul", state: "working", minutes: 0 })),
      summary(
        at({
          id: "relay",
          title: "Route hosts through the Polaris Relay",
          harness: "codex",
          state: "working",
          turnCount: 9,
          minutes: 4,
          lastReplyPreview: "Running bun test apps/daemon",
        })
      ),
      summary(
        at({
          id: "docs",
          title: "Write the relay README",
          workspaceId: "w3",
          turnCount: 6,
          minutes: 90,
        })
      ),
    ],
    constellations: [constellation("Orchestrator overhaul", "lead")],
  }),
  synchronized(),
]);

const quiet = (
  hostId: string,
  name: string,
  connection: ConnectionState,
  names: ReadonlyArray<string>
) =>
  host(
    hostId,
    name,
    [snapshot({ workspaces: names.map((n) => workspace(`${hostId}-${n}`, n)) }), synchronized()],
    connection
  );

export const paperHomeHosts: ReadonlyArray<HomeHost> = [
  studio,
  quiet("rpi", "lucas-rpi", "reconnecting", ["pi-bench"]),
  quiet("vm", "build-vm", "connected", []),
  quiet("air", "lucas-air", "connected", ["notes"]),
];
