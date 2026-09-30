import { describe, expect, test } from "bun:test";
import { ApprovalRequest, RequestId, TurnItem } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import { hostModel, hostView } from "../routes/fixtures.testing.ts";
import { approval, seq, turn } from "../store/fixtures.testing.ts";
import type { SessionEntry } from "../store/hostModel.ts";
import type { SessionModel } from "../store/sessionModel.ts";
import { activityOf, sessionLine } from "./copy.ts";
import { hostSentence, isSlowLink, SLOW_LINK_MS } from "./hostCopy.ts";

const base = (() => {
  const found = [
    ...hostModel([{ id: "w", sessions: [{ id: "s", state: "working" }] }]).sessions.values(),
  ][0];

  if (found === undefined) throw new Error("fixture has no session");

  return found;
})();

const entry = (pendingApprovals: SessionEntry["pendingApprovals"] = []): SessionEntry => ({
  ...base,
  pendingApprovals,
});

const question = new ApprovalRequest({
  id: RequestId.make("q1"),
  sessionId: approval.sessionId,
  turnId: approval.turnId,
  kind: "question",
  title: "Should Compact keep the Harness tile at 20px?",
  detail: null,
  options: [],
  openedAt: approval.openedAt,
});

const working = (item: TurnItem | null, text = ""): SessionModel => ({
  sequence: seq(1),
  synchronized: true,
  session: null,
  pendingApprovals: [],
  turns: [{ turn, items: [], live: new Map([["x", { item, text, output: "" }]]) }],
});

describe("session row line", () => {
  test("a question is the ask itself, not 'Wants to …' (V1 B1)", () => {
    expect(sessionLine(entry([question]))).toBe("Should Compact keep the Harness tile at 20px?");
    expect(sessionLine(entry([approval]))).toBe("Wants to run bun test");
  });

  test("Working says the current step when the feed has one, else the turn", () => {
    const cmd = TurnItem.cases.CommandExecution.make({
      id: "c",
      command: "cargo build --release",
      cwd: "/",
      output: "",
      exitCode: null,
      status: "running",
    });

    expect(sessionLine(entry(), activityOf(working(cmd)))).toBe("Running cargo build --release");
    expect(sessionLine(entry(), activityOf(working(null, "Sure")))).toBe("Writing a reply…");
    expect(sessionLine(entry(), activityOf(undefined))).toBe("Working · turn 1");
  });
});

const failing = (state: HostView["status"]["state"], reason: string): HostView => {
  const view = hostView("vm", state);

  return {
    ...view,
    label: "Linux VM",
    status: {
      ...view.status,
      failure: { kind: "transient", reason, detail: "/var/folders/x/daemon.sock" },
    },
  };
};

describe("host copy", () => {
  test("says what happened in words, never the raw error or a path", () => {
    const reconnecting = hostSentence(failing("reconnecting", "connection-lost"), "12s");

    expect(reconnecting).toBe(
      "The connection to Linux VM dropped. Reconnecting for 12s; its sessions are kept."
    );
    expect(reconnecting).not.toContain("/var/");
    expect(hostSentence(failing("needs-attention", "host-key-unknown"), undefined)).toBe(
      "Linux VM's host key isn't trusted yet."
    );
    expect(hostSentence(failing("offline", "unreachable"), "09:14")).toContain(
      "Offline since 09:14"
    );
  });

  test("a connected Host with a slow round trip is a slow link", () => {
    const view = hostView("pi");

    expect(isSlowLink({ ...view, status: { ...view.status, latencyMs: SLOW_LINK_MS } })).toBe(true);
    expect(isSlowLink({ ...view, status: { ...view.status, latencyMs: 20 } })).toBe(false);
    expect(isSlowLink(view)).toBe(false);
  });
});
