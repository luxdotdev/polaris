/**
 * A Codex session against a fake app-server, for driver tests: open it, script
 * the server, wait for events. Test files run `cleanup` after each test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type PermissionMode, SessionId } from "@polaris/protocol";
import { Effect, Schema, type Scope, Stream } from "effect";
import {
  type OpenOptions,
  type HarnessDriver,
  HarnessEvent,
  type HarnessSession,
} from "../../HarnessDriver.ts";
import type { CodexDriverOptions } from "../CodexDriver.ts";
import type { Json } from "../protocol.ts";
import {
  type ClientRequest,
  type FakeAppServer,
  type FakeConnection,
  type Handler,
  startFakeAppServer,
} from "./FakeAppServer.ts";

export const THREAD = "thr_1";

export type EventOf<T extends HarnessEvent["_tag"]> = Extract<HarnessEvent, { readonly _tag: T }>;

export const ofTag = <T extends HarnessEvent["_tag"]>(
  events: ReadonlyArray<HarnessEvent>,
  tag: T
): Array<EventOf<T>> => events.filter(HarnessEvent.$is(tag));

const decodeThreadId = Schema.decodeUnknownSync(Schema.Struct({ threadId: Schema.String }));

export const cleanup: Array<() => void> = [];

/** Socket paths must stay under ~104 bytes, so tests use /tmp directly. */
const socketPath = () => {
  const dir = mkdtempSync("/tmp/pcx-");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

  return join(dir, "s.sock");
};

export interface Harness {
  readonly session: HarnessSession;
  readonly server: FakeAppServer;
  readonly events: Array<HarnessEvent>;
  /** The first event with `tag` (and matching `where`), waiting up to two seconds. */
  readonly waitFor: <T extends HarnessEvent["_tag"]>(
    tag: T,
    where?: (e: EventOf<T>) => boolean
  ) => Effect.Effect<EventOf<T>>;
}

/**
 * Opens a session of `makeDriver`'s driver against a fake app-server and runs
 * `body`; the scope closes afterwards.
 */
export const sessionWith =
  (makeDriver: (options: CodexDriverOptions) => Effect.Effect<HarnessDriver, never, Scope.Scope>) =>
  <A>(
    handler: Handler,
    body: (h: Harness) => Effect.Effect<A, unknown>,
    options: {
      readonly resumeCursor?: string;
      readonly serviceTier?: "default" | "priority";
      readonly permissionMode?: PermissionMode;
      readonly readOnly?: boolean;
      readonly constellation?: NonNullable<OpenOptions["constellation"]>;
      readonly constellations?: NonNullable<OpenOptions["constellations"]>;
      readonly environment?: NonNullable<OpenOptions["environment"]>;
    } = {}
  ): Promise<{ result: A; events: Array<HarnessEvent>; server: FakeAppServer }> => {
    const path = socketPath();
    const server = startFakeAppServer(path, handler);
    cleanup.push(server.stop);
    const events: Array<HarnessEvent> = [];

    const program = Effect.gen(function* () {
      const driver = yield* makeDriver({
        socketPath: path,
        spawnAppServer: false,
        codexPath: "/opt/codex/bin/codex",
      });

      const session = yield* driver.open({
        sessionId: SessionId.make("s1"),
        cwd: "/repo",
        permissionMode: options.permissionMode ?? "supervised",
        model: null,
        effort: null,
        resumeCursor: options.resumeCursor ?? null,
        readOnly: options.readOnly ?? false,
        ...options,
      });

      yield* session.events.pipe(
        Stream.runForEach((e) => Effect.sync(() => events.push(e))),
        // Detached, so it keeps reading through scope close and sees the final `Exited`.
        Effect.forkDetach
      );

      const waitFor = <T extends HarnessEvent["_tag"]>(
        tag: T,
        where: (e: EventOf<T>) => boolean = () => true
      ) =>
        Effect.promise(async () => {
          for (let i = 0; i < 200; i++) {
            const found = ofTag(events, tag).find(where);

            if (found) return found;
            await Bun.sleep(10);
          }

          throw new Error(
            `timed out waiting for ${tag}; saw ${events.map((e) => e._tag).join(",")}`
          );
        });

      return yield* body({ session, server, events, waitFor });
    });

    return Effect.runPromise(Effect.scoped(program)).then(async (result) => {
      await Bun.sleep(20);

      return { result, events, server };
    });
  };

/** A handler for the handshake and thread lifecycle, delegating the rest. */
export const scripted =
  (rest: (request: ClientRequest, conn: FakeConnection) => void | Promise<void>): Handler =>
  (request, conn) => {
    switch (request.method) {
      case "initialize":
        return conn.reply({ userAgent: "fake", codexHome: "/home/user/.codex" });
      case "thread/start":
        return conn.reply({ thread: { id: THREAD } });
      case "thread/resume":
        return conn.reply({ thread: { id: decodeThreadId(request.params).threadId } });
      case "thread/unsubscribe":
        return conn.reply({ status: "unsubscribed" });
      default:
        return rest(request, conn);
    }
  };

export const turn = (id: string, status = "inProgress", error: Json = null) => ({
  id,
  items: [],
  itemsView: "notLoaded",
  status,
  error,
  startedAt: null,
  completedAt: null,
  durationMs: null,
});
