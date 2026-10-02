import { InlineRequest, WorkspaceId } from "@polaris/protocol";

export const request = (prompt = "Change it") =>
  InlineRequest.make({
    workspaceId: WorkspaceId.make("w"),
    path: "/repo/file.ts",
    content: "before 😀 after\r\n",
    selection: { from: 7, to: 9 },
    prompt,
    harness: "codex",
    model: "gpt-test",
    effort: "low",
  });
