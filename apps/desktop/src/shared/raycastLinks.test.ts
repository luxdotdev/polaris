import { expect, test } from "bun:test";
import { parseDeepLink } from "./deepLink.ts";
import { HostId, SessionId, WorkspaceId } from "@polaris/protocol";
import { sessionLink, workspaceLink } from "../../../../extensions/raycast/src/lib/links.ts";

test.each([
  ["plain ids", "host-1", "abc123"],
  ["ids with spaces, ? and # and non-ASCII", "mac studio", "sitzung ü #1?"],
])("the Desktop App opens the session and workspace links made from %s", (_, hostId, id) => {
  expect(parseDeepLink(sessionLink(hostId, id))).toEqual({
    link: { target: "session", hostId: HostId.make(hostId), sessionId: SessionId.make(id) },
  });
  expect(parseDeepLink(workspaceLink(hostId, id))).toEqual({
    link: {
      target: "workspace",
      hostId: HostId.make(hostId),
      workspaceId: WorkspaceId.make(id),
    },
  });
});
