/**
 * Handlers the transport owns (`hello`) and placeholders for every other RPC,
 * so a Daemon is runnable end to end before the store, files, git and terminal
 * modules land. `server.ts` layers real handlers over these.
 */
import {
  type Capability,
  CommandRejected,
  ConstellationRejected,
  ConstellationFinding,
  FileError,
  GitError,
  type HostInfo,
  NotFound,
  PROTOCOL_VERSION,
  Sequence,
  Unsupported,
} from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { ClientCapabilities, DeviceLabel } from "../engine/rpc.ts";
import { BlobChannel } from "../services.ts";
import { ServerRpcs } from "./rpcs.ts";

const constellationUnavailable = () =>
  new ConstellationRejected({
    findings: [
      new ConstellationFinding({
        code: "E-UNAVAILABLE",
        message: "Constellations are not available on this Daemon yet",
        fix: "Connect to a Daemon with the constellation capability",
      }),
    ],
    graph: null,
    revision: 0,
  });

const notYet = (what: string) => `${what} is not available on this Daemon yet`;

const fileError = (path: string, what: string) =>
  new FileError({ path, code: "ENOTSUP", message: notYet(what) });

export const defaultHandlers = (options: {
  readonly hostInfo: HostInfo;
  readonly capabilities: ReadonlyArray<Capability>;
}) =>
  ServerRpcs.toLayer({
    "constellation.plan": () => Effect.fail(constellationUnavailable()),
    "constellation.dispatch": () => Effect.fail(constellationUnavailable()),
    "constellation.review": () => Effect.fail(constellationUnavailable()),
    "constellation.answer": () => Effect.fail(constellationUnavailable()),
    "constellation.message": () => Effect.fail(constellationUnavailable()),
    "constellation.status": () => Effect.fail(constellationUnavailable()),
    "constellation.set_state": () => Effect.fail(constellationUnavailable()),
    "constellation.worker.claim": () => Effect.fail(constellationUnavailable()),
    "constellation.worker.ask": () => Effect.fail(constellationUnavailable()),
    "constellation.worker.progress": () => Effect.fail(constellationUnavailable()),
    "constellation.worker.propose": () => Effect.fail(constellationUnavailable()),
    "constellation.worker.message": () => Effect.fail(constellationUnavailable()),
    "constellation.subscribe": () => Stream.fail(constellationUnavailable()),
    // Record which device this connection is (for ApprovalResolved.resolvedBy) and
    // what it understands (e.g. whether to send it ItemProgress).
    hello: ({ deviceLabel, capabilities }, { client }) =>
      Effect.sync(() => {
        client.annotate(DeviceLabel, deviceLabel);
        client.annotate(ClientCapabilities, capabilities);
      }).pipe(
        Effect.as({
          host: options.hostInfo,
          protocolVersion: PROTOCOL_VERSION,
          capabilities: options.capabilities,
        })
      ),

    dispatch: ({ commandId }) =>
      Effect.fail(new CommandRejected({ commandId, reason: notYet("the event store") })),

    // An empty Host: a snapshot at sequence 0, then nothing.
    subscribeHost: () =>
      Stream.concat(
        Stream.fromIterable([
          {
            _tag: "Snapshot" as const,
            sequence: Sequence.make(0),
            workspaces: [],
            worktrees: [],
            sessions: [],
            reviewCheckouts: [],
          },
          { _tag: "Synchronized" as const, sequence: Sequence.make(0) },
        ]),
        Stream.never
      ),

    subscribeSession: ({ sessionId }) =>
      Stream.fail(new NotFound({ what: "session", id: sessionId })),
    "session.terminalCommand": ({ sessionId }) =>
      Effect.fail(new NotFound({ what: "session", id: sessionId })),

    "harness.models": () => Effect.fail(new Unsupported({ capability: "harness.models" })),
    "harness.commands": () => Effect.fail(new Unsupported({ capability: "harness.commands" })),
    "harness.spinnerVerbs": () => Effect.succeed(null),
    "harness.availability": () =>
      Effect.fail(new Unsupported({ capability: "harness.availability" })),
    "harness.watchAvailability": () =>
      Stream.fail(new Unsupported({ capability: "harness.availability" })),
    "usage.query": () => Effect.fail(new Unsupported({ capability: "usage" })),
    "usage.watch": () => Stream.fail(new Unsupported({ capability: "usage" })),

    "files.listDir": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.stat": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.read": ({ path }) => Effect.fail(fileError(path, "files")),
    "files.searchPaths": ({ root }) => Effect.fail(fileError(root, "file search")),
    "files.grep": ({ root }) => Effect.fail(fileError(root, "file search")),
    "files.watch": ({ root }) => Stream.fail(fileError(root, "file watching")),

    "git.status": ({ cwd }) => Effect.fail(new GitError({ cwd, message: notYet("git") })),
    "git.diff": ({ cwd }) => Effect.fail(new GitError({ cwd, message: notYet("git") })),
    "git.show": ({ cwd }) => Effect.fail(new GitError({ cwd, message: notYet("git") })),

    // TODO(M2-C checkout): the live status of a Review Checkout.
    "review.checkoutStatus": () => Effect.fail(new Unsupported({ capability: "review.checkouts" })),
    // TODO(M2-R rules, M2-V reviewer): run the Rules and the Reviewer.
    "review.runWalkthrough": () =>
      Effect.fail(new Unsupported({ capability: "review.walkthrough" })),
    "review.stopWalkthrough": () =>
      Effect.fail(new Unsupported({ capability: "review.walkthrough" })),
    "review.runRiskSummary": () =>
      Effect.fail(new Unsupported({ capability: "review.risk-summary" })),
    "review.riskSummary": () => Effect.fail(new Unsupported({ capability: "review.risk-summary" })),
    "review.watchRiskSummary": () =>
      Stream.fail(new Unsupported({ capability: "review.risk-summary" })),
    // TODO(M2-V reviewer): continue the Reviewer's own Agent Session.
    "review.askFinding": () => Effect.fail(new Unsupported({ capability: "review.ask" })),
    "review.verdicts": () => Effect.fail(new Unsupported({ capability: "review.verdicts" })),
    "review.reviewerSettings": () =>
      Effect.fail(new Unsupported({ capability: "review.reviewer-settings" })),
    "review.setReviewerSettings": () =>
      Effect.fail(new Unsupported({ capability: "review.reviewer-settings" })),

    "session.acceptPlan": () => Effect.fail(new Unsupported({ capability: "session.accept" })),
    "session.draftAccept": () => Effect.fail(new Unsupported({ capability: "session.accept" })),
    "session.commitAccepted": () => Effect.fail(new Unsupported({ capability: "session.accept" })),
    "session.pushAccepted": () => Effect.fail(new Unsupported({ capability: "session.accept" })),

    // Drain the bytes the Client already sent so they don't sit in the connection buffer.
    "attachments.stage": ({ name, blobId }) =>
      Effect.gen(function* () {
        const blobs = yield* BlobChannel;
        yield* Effect.ignore(blobs.take(blobId));

        return yield* fileError(name, "attachments");
      }),

    "attachments.settings": () =>
      Effect.fail(new Unsupported({ capability: "attachments.settings" })),
    "attachments.setSettings": () =>
      Effect.fail(new Unsupported({ capability: "attachments.settings" })),
    "attachments.clear": () => Effect.fail(new Unsupported({ capability: "attachments.settings" })),

    "terminal.open": ({ cwd }) => Effect.fail(fileError(cwd, "terminals")),
    "terminal.attach": ({ terminalId }) =>
      Stream.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.attachBinary": ({ terminalId }) =>
      Stream.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.input": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.resize": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
    "terminal.close": ({ terminalId }) =>
      Effect.fail(new NotFound({ what: "terminal", id: terminalId })),
  });
