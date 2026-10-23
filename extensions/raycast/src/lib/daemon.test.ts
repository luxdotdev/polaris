/**
 * The extension's model of what it shows, against the real Daemon through the
 * SDK: sections and approvals as a session asks and is answered, refusals that
 * name the missing Grant, and each Connection State a pairing can be in.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPolaris, encodePairing, type HostView, type PolarisClient } from "@polaris/sdk";
import { launchDaemon, type TestDaemon } from "@polaris/sdk/testing";
import { availability, connectionState } from "./connection.ts";
import { describeFailure, unavailableMarkdown } from "./copy.ts";
import { approvalRows, sessionKey, sessionSections } from "./rows.ts";

let daemon: TestDaemon;

const opened: Array<PolarisClient> = [];

beforeAll(async () => {
  daemon = await launchDaemon();
  // Local pairings open `$POLARIS_HOME/daemon.sock`.
  process.env.POLARIS_HOME = daemon.home;
}, 60_000);

afterAll(async () => {
  await Promise.all(opened.map((client) => client.close()));
  await daemon.stop();
});

const client = async (...pairings: ReadonlyArray<string>) => {
  const polaris = await createPolaris({ pairings, clientName: "Raycast" });

  opened.push(polaris);

  return polaris;
};

/** The first views that satisfy `done`; fails after `ms`. */
const until = async <A>(feed: AsyncIterable<A>, done: (item: A) => boolean, ms = 20_000) => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timed out waiting for the feed")), ms)
  );

  const first = (async () => {
    for await (const item of feed) if (done(item)) return item;
    throw new Error("the feed ended");
  })();

  return Promise.race([first, timeout]);
};

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: Error) => error
  );

/** A bench Harness Turn: one item, behind an approval, no pacing. */
const APPROVAL_PROMPT = 'bench:{"items":1,"approvalEvery":1,"deltaIntervalMs":0}';

const browsing = { host: null, pinned: new Set<string>(), searching: false };

const sectionOf = (views: ReadonlyArray<HostView>, key: string) =>
  sessionSections(views, browsing).find((s) => s.rows.some((row) => row.key === key))?.title;

describe("a session that asks for approval", () => {
  test("leads under Needs You and in Pending Approvals, then moves to Idle once approved", async () => {
    const workspaceId = await daemon.registerWorkspace();
    const polaris = await client(await daemon.pair("Raycast", ["read", "approve", "start"]));

    const sessionId = await polaris.startSession(daemon.hostId, {
      workspaceId,
      harness: "claude",
      prompt: APPROVAL_PROMPT,
    });

    const key = sessionKey(daemon.hostId, sessionId);

    const asking = await until(polaris.subscribeHosts(), (views) =>
      approvalRows(views, null).some((row) => row.session.key === key)
    );

    expect(sectionOf(asking, key)).toBe("Needs You");

    const [row] = approvalRows(asking, daemon.hostId);

    if (row === undefined) throw new Error("no approval row");
    expect(row.session.workspaceName).toStartWith("sdk-repo-");

    await polaris.respondToApproval(daemon.hostId, sessionId, row.approval.id, { kind: "allow" });

    const answered = await until(
      polaris.subscribeHosts(),
      (views) => sectionOf(views, key) === "Idle"
    );

    expect(approvalRows(answered, null)).toEqual([]);
  }, 60_000);
});

type ReaderCall = (polaris: PolarisClient, workspaceId: string) => Promise<void>;

const READER_CALLS: ReadonlyArray<readonly [string, ReaderCall, string, string]> = [
  [
    "send a turn",
    (polaris) => polaris.sendTurn(daemon.hostId, "missing", "hi"),
    "This pairing can't send turns",
    "“Send turns”",
  ],
  [
    "approve",
    (polaris) => polaris.respondToApproval(daemon.hostId, "missing", "r1", { kind: "allow" }),
    "This pairing can't answer approvals",
    "“Approve”",
  ],
  [
    "start a session",
    (polaris, workspaceId) =>
      polaris
        .startSession(daemon.hostId, { workspaceId, harness: "claude", prompt: "hi" })
        .then(() => undefined),
    "This pairing can't start agent sessions",
    "“Start agent sessions”",
  ],
];

describe("a pairing that may only read", () => {
  test.each(READER_CALLS)(
    "is told which Grant it lacks when it tries to %s",
    async (what, call, title, grant) => {
      const polaris = await client(await daemon.pair("Reader", ["read"]));
      const workspaceId = await daemon.registerWorkspace();
      const failure = describeFailure(await failureOf(call(polaris, workspaceId)), what);

      expect(failure.title).toBe(title);
      expect(failure.message).toContain(`pair Raycast again with ${grant} on`);
    },
    30_000
  );
});

describe("Connection States", () => {
  test("a revoked pairing Needs Attention and says it was revoked", async () => {
    const pairing = await daemon.pair("Revoked", ["read"]);

    await daemon.revoke(pairing);
    const [view] = await until((await client(pairing)).subscribeHosts(), () => true);

    if (view === undefined) throw new Error("no view");
    expect(connectionState(view)).toBe("needs-attention");
    expect(describeFailure(view.error, "connect").title).toBe("This pairing was revoked");
  }, 30_000);

  test("a Host nothing answers for is Offline, and the command shows why instead of its list", async () => {
    const nowhere = encodePairing({
      hostId: "studio",
      hostName: "Mac Studio",
      url: "ws://127.0.0.1:9/polaris/rpc",
      token: "pol_ext_nothing",
      name: "Raycast",
    });

    const polaris = await client(nowhere);
    const views = await until(polaris.subscribeHosts(), () => true);

    expect(views.map(connectionState)).toEqual(["offline"]);
    expect(availability(views, polaris.hosts.length)).toBe("unavailable");
    expect(unavailableMarkdown(views)).toContain("**Mac Studio**: Can't reach Mac Studio.");
  }, 30_000);

  test("one reachable Host is enough to show the command", async () => {
    const nowhere = encodePairing({
      hostId: "studio",
      hostName: "Mac Studio",
      url: "ws://127.0.0.1:9/polaris/rpc",
      token: "pol_ext_nothing",
      name: "Raycast",
    });

    const polaris = await client(await daemon.pair("Raycast", ["read"]), nowhere);
    const views = await until(polaris.subscribeHosts(), (v) => v.length === 2);

    expect(availability(views, polaris.hosts.length)).toBe("available");
  }, 30_000);

  test("a Daemon restart reads Reconnecting, then Connected again", async () => {
    const polaris = await client(await daemon.pair("Restarts", ["read"]));
    const feed = polaris.subscribeHosts()[Symbol.asyncIterator]();

    const next = async () => {
      const result = await feed.next();

      if (result.done === true) throw new Error("the feed ended");
      const [view] = result.value;

      if (view === undefined) throw new Error("no view");

      return connectionState(view);
    };

    expect(await next()).toBe("connected");
    await daemon.restart();
    expect(await next()).toBe("reconnecting");
    let after = await next();

    // Each retry re-emits the last view, still Reconnecting.
    while (after === "reconnecting") after = await next();
    expect(after).toBe("connected");
    await feed.return?.();
  }, 60_000);
});
