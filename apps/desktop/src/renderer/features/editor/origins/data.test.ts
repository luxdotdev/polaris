import { afterEach, describe, expect, test } from "bun:test";
import { SessionId, TurnId, WorkspaceId } from "@polaris/protocol";
import type { PolarisApi } from "../../../../shared/api.ts";
import { standInBridge } from "../../bridge.ts";
import { bindOriginsApp, lookupOrigins } from "./data.ts";
import { mergeLine } from "./model.ts";
import { originsAppState, originsScene } from "./preview.ts";

const scene = originsScene("origins");

const query = {
  line: 15,
  path: "desktop/src/orchestrator/session-row.tsx",
  hash: "h",
  commitSha: "8e41d07c2",
  commitTime: 1,
};

const answer = (title: string) => ({
  ok: true,
  value: {
    lines: [
      { line: 15, origins: [{ sessionId: SessionId.make(title), turnIds: [TurnId.make("t")] }] },
    ],
    sessions: [
      {
        sessionId: SessionId.make(title),
        workspaceId: WorkspaceId.make("w"),
        title,
        harness: "claude",
        sessionState: "idle",
        archived: false,
        celestial: null,
        turns: [{ turnId: TurnId.make("t"), number: 3, time: 1, prompt: "" }],
      },
    ],
  },
});

/** Each Host answers through `reply`. */
type Answer = ReturnType<typeof answer>;

const bridgeWith = (reply: (hostKey: string) => Promise<Answer>): PolarisApi => ({
  // SAFETY: Origins only asks `origins.match` here, and `answer` is its success shape.
  request: ((_method: string, input: { hostKey: string }) => reply(input.hostKey)) as never,
  subscribe: () => () => undefined,
  onAppEvent: () => () => undefined,
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => standInBridge(null));

describe("asking every Host", () => {
  test("a Host that fails counts as offline and the others still show; a slow one doesn't hold them", async () => {
    if (scene === null) throw new Error("no fixture");

    bindOriginsApp(() => originsAppState(scene));
    const slow = Promise.withResolvers<Answer>();

    const replies = new Map([
      ["studio", Promise.resolve(answer("Polaris planning"))],
      ["mbp", Promise.reject<Answer>(new Error("connection reset"))],
      ["linux-vm", slow.promise],
    ]);

    standInBridge(bridgeWith((hostKey) => replies.get(hostKey) ?? slow.promise));

    const lookup = lookupOrigins("repo", query, "v1");
    const seen: Array<ReadonlyArray<string>> = [];

    lookup.subscribe(() =>
      seen.push(mergeLine(15, lookup.hosts()).sessions.map((s) => s.session.title))
    );
    await settled();

    const early = mergeLine(15, lookup.hosts());

    expect(early.sessions.map((s) => s.session.title)).toEqual(["Polaris planning"]);
    expect(early.offline).toEqual(["MacBook Pro"]);
    expect(early.pending).toBe(1);

    slow.resolve(answer("From the Linux VM"));
    await settled();

    expect(mergeLine(15, lookup.hosts()).pending).toBe(0);
    expect(seen.at(-1)?.toSorted()).toEqual(["From the Linux VM", "Polaris planning"]);
  });

  test("a Host that isn't connected is never asked and reads as offline", async () => {
    if (scene === null) throw new Error("no fixture");
    const state = originsAppState(scene);
    const asked: Array<string> = [];

    bindOriginsApp(() => ({
      ...state,
      hosts: state.hosts.map((h) =>
        h.key === "linux-vm" ? { ...h, status: { ...h.status, state: "reconnecting" } } : h
      ),
    }));
    standInBridge(
      bridgeWith((hostKey) => {
        asked.push(hostKey);

        return Promise.resolve(answer("Polaris planning"));
      })
    );

    const lookup = lookupOrigins("repo", query, "v2");

    await settled();

    expect(asked.toSorted()).toEqual(["mbp", "studio"]);
    expect(mergeLine(15, lookup.hosts()).offline).toEqual(["Linux VM"]);
  });
});
