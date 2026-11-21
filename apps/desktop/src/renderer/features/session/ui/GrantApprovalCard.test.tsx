import { ApprovalDecision, ApprovalRequest, RequestId, SessionId, TurnId } from "@polaris/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { GrantApprovalCard } from "./GrantApprovalCard.tsx";

afterEach(cleanup);

const request = (rememberable: boolean) =>
  new ApprovalRequest({
    id: RequestId.make("grant"),
    sessionId: SessionId.make("session"),
    turnId: TurnId.make("turn"),
    kind: "grant",
    title: "Allow this session to start a session?",
    detail: "Start a session on this host",
    options: [],
    openedAt: "2026-11-20T00:00:00Z",
    grant: { kind: "start", action: "dispatch:StartSession", targetSessionId: null, rememberable },
  });

test("the user chooses once, this session, or this workspace with distinct authority", () => {
  const answers: Array<ApprovalDecision> = [];
  render(
    <GrantApprovalCard
      request={request(true)}
      theirs={false}
      onRespond={(answer) => answers.push(answer)}
    />
  );

  for (const label of [
    "Allow once",
    "Always for this session",
    "Always for this workspace",
    "Deny",
  ])
    fireEvent.click(screen.getByText(label));
  expect(answers).toEqual([
    ApprovalDecision.cases.Allow.make({ remember: false }),
    ApprovalDecision.cases.Allow.make({ remember: true, grantScope: "session" }),
    ApprovalDecision.cases.Allow.make({ remember: true, grantScope: "workspace" }),
    ApprovalDecision.cases.Deny.make({ reason: null }),
  ]);
});

test("an action outside the Starter chain offers no remembered scope", () => {
  render(<GrantApprovalCard request={request(false)} theirs={false} onRespond={() => {}} />);
  expect(screen.queryByText("Always for this session")).toBeNull();
  expect(screen.queryByText("Always for this workspace")).toBeNull();
  expect(screen.getByText("Allow once").hasAttribute("disabled")).toBe(false);
});

test("a Teammate cannot grant session authority", () => {
  render(<GrantApprovalCard request={request(true)} theirs={true} onRespond={() => {}} />);
  expect(screen.getByText("Allow once").hasAttribute("disabled")).toBe(true);
  expect(screen.queryByText("Always for this workspace")).toBeNull();
});
