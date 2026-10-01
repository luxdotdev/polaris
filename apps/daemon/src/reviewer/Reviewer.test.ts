/**
 * The Reviewer end to end: the real Engine, store and Review Checkout git over
 * a local code host, with a fake Harness answering as the bench Reviewer does
 * (schema output on the first added line). The Rules are stubbed; their own
 * tests run the scanners.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  DomainEvent,
  HarnessAvailability,
  HostHarnesses,
  PullRequestRef,
  type RiskSummary,
  type RiskSummaryId,
  ReviewCheckoutId,
  ReviewContext,
  ReviewSubject,
  RiskSummaryRef,
  RequestId,
  SessionId,
  TurnId,
  TurnItem,
  type Workspace,
  WorkspaceId,
} from "@polaris/protocol";
import { Effect, Layer, Option, Predicate, Stream } from "effect";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../engine/testing.ts";
import { ReviewCheckoutGitLive } from "../git/ReviewCheckoutGit.ts";
import {
  BASE_REPO,
  contributor,
  createForge,
  publishPullRequest,
  userClone,
} from "../git/review/testing.ts";
import { commitAll, removeDir, write } from "../git/testing.ts";
import { Availability } from "../harness/availability/index.ts";
import { benchReviewReply } from "../harness/bench/review.ts";
import { HarnessEvent, type TurnInput } from "../harness/HarnessDriver.ts";
import { Rules } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import {
  automaticRun,
  Reviewer,
  ReviewerLive,
  ReviewerPolicyLive,
  ReviewerSessions,
} from "./index.ts";
import { REVIEWER_MARKER } from "./prompt.ts";
import { RULES_ONLY_NOTE } from "./settings.ts";

type Env = Engine | EventStore | Reviewer;

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

/** The Reviewer's Turn: two approvals (one allowed, one not), then the bench reply. */
const reviewerTurn = (input: TurnInput) => [
  HarnessEvent.CursorAssigned({ cursor: "reviewer-cursor" }),
  HarnessEvent.TurnStarted({ turnId: input.turnId, prompt: input.prompt }),
  HarnessEvent.ApprovalRequested({
    turnId: input.turnId,
    requestId: RequestId.make(`ok-${input.turnId}`),
    kind: "command",
    title: "Show the diff",
    detail: "git diff HEAD~1 --stat",
    options: [],
  }),
  HarnessEvent.ApprovalRequested({
    turnId: input.turnId,
    requestId: RequestId.make(`no-${input.turnId}`),
    kind: "file-change",
    title: "Edit a file",
    detail: "feature.txt",
    options: [],
  }),
  HarnessEvent.ItemCompleted({
    turnId: input.turnId,
    item: TurnItem.cases.AssistantMessage.make({
      id: `msg-${input.turnId}`,
      text: benchReviewReply(input.prompt),
    }),
  }),
  HarnessEvent.TurnEnded({ turnId: input.turnId, status: "completed", error: null }),
];

const availability = (ready: boolean) =>
  Layer.succeed(Availability)({
    get: () =>
      Effect.succeed(
        HostHarnesses.make({
          harnesses: [
            HarnessAvailability.make({
              harness: "claude",
              status: ready ? "ready" : "not-installed",
              version: null,
              minVersion: "0.0.0",
              olderThanTested: null,
              signInKind: null,
              signInArgv: [],
              detail: null,
            }),
          ],
          checkedAt: new Date(0).toISOString(),
        })
      ),
    changes: Stream.empty,
  });

const noRules = Layer.succeed(Rules)({
  run: () => Effect.succeed({ findings: [], notes: [], ok: true }),
});

const reviewerLayer = (options: { readonly ready: boolean }) => {
  const dir = tempDir();
  cleanup.push(dir);
  const driver = makeFakeDriver("claude", { onTurn: reviewerTurn });

  const engine = engineLayer({
    filename: join(dir, "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
    reviewCheckoutGit: ReviewCheckoutGitLive,
  }).pipe(Layer.provide(ReviewerPolicyLive), Layer.provideMerge(ReviewerSessions.layer));

  const layer = ReviewerLive({ settingsPath: join(dir, "reviewer-settings.json") }).pipe(
    Layer.provideMerge(engine),
    Layer.provide(Layer.mergeAll(noRules, ReviewCheckoutGitLive, availability(options.ready)))
  );

  return { layer, driver };
};

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const checkoutId = ReviewCheckoutId.make("rc-7");

const subject = ReviewSubject.cases.PullRequest.make({
  pullRequest: new PullRequestRef({ repo: BASE_REPO, number: 7 }),
  baseRef: "main",
});

const context = ReviewContext.make({ title: "Add the feature", body: "Adds feature.txt." });

const scenario = async () => {
  const forge = await createForge();
  const author = await contributor(forge, forge.mainCommits[1] ?? "main");
  write(author, "feature.txt", "v1\n");
  await commitAll(author, "feature v1");
  const v1 = await publishPullRequest(forge, author, 7);
  const user = await userClone(forge);
  cleanup.push(forge.root, user, `${user}.worktrees`, author);

  return { forge, author, user, v1 };
};

const openReview = (user: string, head: string) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: user, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === user));
    // SAFETY: waitFor returned once a Workspace at `user` was registered.
    const workspace = [...model.workspaces.values()].find((w) => w.path === user) as Workspace;
    yield* dispatch(
      Command.cases.OpenReviewCheckout.make({
        checkoutId,
        workspaceId: workspace.id,
        subject,
        head,
        base: "",
      })
    );
    yield* waitFor((m) => m.reviewCheckouts.get(checkoutId)?.state === "ready", 15_000);

    return workspace;
  });

/** The summary once `done` holds, polled from the store. */
const summaryWhen = (summaryId: RiskSummaryId, done: (summary: RiskSummary) => boolean) =>
  Effect.gen(function* () {
    const store = yield* EventStore;

    for (let i = 0; i < 750; i++) {
      const summary = yield* store.review.riskSummary(
        RiskSummaryRef.cases.ById.make({ summaryId })
      );

      if (summary !== null && done(summary)) return summary;
      yield* Effect.sleep("20 millis");
    }

    return yield* Effect.die(new Error(`summary ${summaryId} never got there`));
  });

const ended = (summary: RiskSummary) => summary.status !== "running";

describe("the Reviewer", () => {
  test("reviews a pull request in its own read-only session, then answers a follow-up", async () => {
    const s = await scenario();
    const { layer, driver } = reviewerLayer({ ready: true });

    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* openReview(s.user, s.v1);
        const reviewer = yield* Reviewer;

        const started = yield* reviewer.run({
          workspaceId: workspace.id,
          subject,
          checkoutId,
          since: null,
          refresh: false,
          context,
        });

        expect(started.status).toBe("running");

        const done = yield* summaryWhen(started.id, ended);
        expect(done.status).toBe("completed");
        expect(done.layers.rules.status).toBe("completed");
        expect(done.layers.agent.status).toBe("completed");
        expect(done.reviewer).toMatchObject({
          harness: "claude",
          model: "claude-opus-5-5",
          effort: "high",
        });
        expect(done.findings).toHaveLength(1);
        expect(done.findings[0]).toMatchObject({
          source: "agent",
          path: "feature.txt",
          lines: { start: 1, end: 1, side: "new" },
          severity: "medium",
        });

        // The session: in the checkout, titled, supervised; its approvals answered by policy.
        const sessionId = done.reviewer?.sessionId;
        expect(sessionId).toBeTruthy();
        const model = yield* (yield* EventStore).model;
        const record = model.sessions.get(sessionId!);
        expect(record?.session).toMatchObject({
          title: "Reviewer · Pull request #7",
          cwd: model.reviewCheckouts.get(checkoutId)?.path,
          permissionMode: "supervised",
          state: "idle",
        });
        const harness = driver.latest(sessionId!);
        expect(harness?.turns[0]?.prompt.startsWith(REVIEWER_MARKER)).toBe(true);
        expect(harness?.turns[0]?.prompt).toContain("Add the feature");
        expect(harness?.turns[0]?.prompt).toContain("+v1");
        expect(harness?.responses.map((r) => r.decision._tag).toSorted()).toEqual([
          "Allow",
          "Deny",
        ]);

        const events = yield* (yield* EventStore).readEvents({
          after: 0,
          upTo: model.sequence,
          sessionId: sessionId!,
        });

        expect(events.some((e) => DomainEvent.guards.ApprovalRequested(e.event))).toBe(false);

        // The checkout records what was reviewed; a second run answers the cached summary.
        yield* waitFor((m) => m.reviewCheckouts.get(checkoutId)?.reviewedHead === s.v1);

        const again = yield* reviewer.run({
          workspaceId: workspace.id,
          subject,
          checkoutId,
          since: null,
          refresh: false,
          context,
        });

        expect(again.id).toBe(done.id);

        // A follow-up continues the same session and can withdraw the Finding.
        const finding = done.findings[0]!;
        const asked = yield* reviewer.ask(done.id, finding.id, "Is this real? Please withdraw it.");
        expect(asked.sessionId).toBe(sessionId!);

        const withdrawn = yield* summaryWhen(
          done.id,
          (summary) => summary.findings[0]?.status === "resolved"
        );

        expect(withdrawn.findings[0]?.resolution).toBe("withdrawn");
        expect(driver.latest(sessionId!)?.turns[1]?.prompt).toContain(finding.id);
      })
    );
  }, 60_000);

  test("new commits after an update are reviewed on their own, in the same session", async () => {
    const s = await scenario();
    const { layer, driver } = reviewerLayer({ ready: true });

    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* openReview(s.user, s.v1);
        const reviewer = yield* Reviewer;

        const first = yield* reviewer.run({
          workspaceId: workspace.id,
          subject,
          checkoutId,
          since: null,
          refresh: false,
          context,
        });

        const done = yield* summaryWhen(first.id, ended);
        yield* waitFor((m) => m.reviewCheckouts.get(checkoutId)?.reviewedHead === s.v1);

        const store = yield* EventStore;

        const next = yield* Effect.scoped(
          Effect.gen(function* () {
            const live = yield* store.subscribe({
              filter: (item) =>
                Predicate.isTagged(item, "Event") &&
                DomainEvent.guards.RiskSummaryStarted(item.envelope.event),
            });

            write(s.author, "second.txt", "added later\n");
            yield* Effect.promise(() => commitAll(s.author, "second"));
            const v2 = yield* Effect.promise(() => publishPullRequest(s.forge, s.author, 7));
            yield* dispatch(
              Command.cases.ReportReviewHead.make({ checkoutId, head: v2, base: "" })
            );
            yield* dispatch(
              Command.cases.UpdateReviewCheckout.make({ checkoutId, discardChanges: false })
            );

            const item = yield* Stream.runHead(live);

            return Option.isSome(item) &&
              Predicate.isTagged(item.value, "Event") &&
              DomainEvent.guards.RiskSummaryStarted(item.value.envelope.event)
              ? item.value.envelope.event.summary
              : null;
          })
        );

        expect(next?.key.since).toBe(s.v1);
        const incremental = yield* summaryWhen(next!.id, ended);
        expect(incremental.status).toBe("completed");
        expect(incremental.findings.map((f) => f.path)).toEqual(["second.txt"]);
        expect(incremental.reviewer?.sessionId).toBe(done.reviewer?.sessionId);
        const prompt = driver.latest(done.reviewer!.sessionId!)?.turns.at(-1)?.prompt ?? "";
        expect(prompt).toContain("Only the new changes");
        expect(prompt).not.toContain("+v1");
      })
    );
  }, 60_000);

  test("without a Reviewer the summary is Rules only, with a note", async () => {
    const s = await scenario();
    const { layer } = reviewerLayer({ ready: false });

    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* openReview(s.user, s.v1);
        const reviewer = yield* Reviewer;

        const started = yield* reviewer.run({
          workspaceId: workspace.id,
          subject,
          checkoutId,
          since: null,
          refresh: false,
          context: null,
        });

        const done = yield* summaryWhen(started.id, ended);

        expect(done).toMatchObject({ status: "completed", reviewer: null, note: RULES_ONLY_NOTE });
        expect(done.layers.agent).toMatchObject({ status: "skipped", note: RULES_ONLY_NOTE });
        expect((yield* (yield* EventStore).model).sessions.size).toBe(0);
      })
    );
  }, 60_000);
});

describe("automatic runs", () => {
  test("accepting Turns reviews the session through the accepted Turn", () => {
    const event = DomainEvent.cases.TurnsAccepted.make({
      sessionId: SessionId.make("ses-1"),
      throughTurnId: TurnId.make("turn-3"),
      throughIndex: 2,
      revertLaterTurns: false,
      acceptedBy: "MacBook",
    });

    const request = automaticRun(
      event,
      () => undefined,
      () => WorkspaceId.make("ws-1")
    );

    expect(request?.subject).toEqual(
      ReviewSubject.cases.SessionTurns.make({
        sessionId: SessionId.make("ses-1"),
        firstTurnId: null,
        lastTurnId: TurnId.make("turn-3"),
      })
    );
    expect(
      automaticRun(
        event,
        () => undefined,
        () => null
      )
    ).toBeNull();
  });
});
