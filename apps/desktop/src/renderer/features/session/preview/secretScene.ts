/** Secret Requests (ADR 0089): one waiting for its value, and one already saved (`#preview/secret`). */
import { ApprovalRequest, RequestId, TurnItem } from "@polaris/protocol";
import type { SessionModel } from "../../../store/sessionModel.ts";
import { ago, model, session, turn, view } from "./fixtures.ts";

const I = TurnItem.cases;

const SAVED =
  "Saved. The secret is in /Users/lucas/.polaris/secrets/sessions/s-secret/8f2c1a, readable by your commands for 24 hours.";

const askFor = (id: string, label: string, output: string | null) =>
  I.ToolCall.make({
    id,
    name: "mcp__polaris__request_secret",
    input: { label, reason: "" },
    output,
    status: output === null ? "running" : "completed",
  });

export const secret = (): SessionModel => {
  const s = session("s-secret", {
    title: "Join the Pi to the tailnet",
    state: "needs-you",
    turnCount: 4,
  });

  const before = turn(s.id, 3, "Set up the staging deploy on Fly", "completed");
  const now = turn(s.id, 4, "Join the Raspberry Pi to the tailnet", "working");

  const saved = new ApprovalRequest({
    id: RequestId.make("r-fly"),
    sessionId: s.id,
    turnId: before.id,
    kind: "secret",
    title: "Fly.io deploy token",
    detail: "To deploy staging with flyctl. Create one at fly.io/user/personal_access_tokens.",
    options: [],
    placeholder: "FlyV1 fm2_…",
    expiresAt: null,
    openedAt: ago(40 * 60),
  });

  const waiting = new ApprovalRequest({
    id: RequestId.make("r-tailscale"),
    sessionId: s.id,
    turnId: now.id,
    kind: "secret",
    title: "Tailscale auth key",
    detail:
      "To join the Pi to your tailnet with tailscale up. Generate a reusable key under Settings → Keys in the Tailscale admin console.",
    options: [],
    placeholder: "tskey-auth-…",
    expiresAt: new Date(Date.now() + 8 * 60_000).toISOString(),
    openedAt: ago(2 * 60),
  });

  return model({
    session: s,
    turns: [
      view(before, [
        I.AssistantMessage.make({
          id: "m3",
          text: "The Fly app is configured. Deploying needs a token only you have.",
        }),
        askFor("t3", saved.title, SAVED),
        I.AssistantMessage.make({ id: "m3b", text: "Deployed staging." }),
      ]),
      view(now, [
        I.AssistantMessage.make({
          id: "m4",
          text: "Tailscale is installed on the Pi. Joining the tailnet needs an auth key.",
        }),
        askFor("t4", waiting.title, null),
      ]),
    ],
    pendingApprovals: [waiting],
    settledSecrets: [{ request: saved, outcome: "provided" }],
  });
};
