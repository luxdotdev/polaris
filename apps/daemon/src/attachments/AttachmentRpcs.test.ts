/**
 * The cleanup RPCs Settings uses, through an in-memory RPC client over the
 * real store: read settings and usage, change the policy, clear a Workspace.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AttachmentSettings, SessionId, WorkspaceId } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { RpcTest } from "effect/rpc";
import { makeFakeBlobChannel } from "../files/testing.ts";
import { removeDir, tempDir } from "../git/testing.ts";
import { AttachmentStore } from "../services.ts";
import { AttachmentRpcs, AttachmentRpcsLive } from "./AttachmentRpcs.ts";
import { AttachmentStoreLive } from "./AttachmentStore.ts";

const cleanup: Array<string> = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) removeDir(dir);
});

const ws1 = WorkspaceId.make("ws1");

const ws2 = WorkspaceId.make("ws2");

const stage = (workspaceId: WorkspaceId, text: string) =>
  Effect.gen(function* () {
    const store = yield* AttachmentStore;

    return yield* store.stage({
      sessionId: SessionId.make(`s-${workspaceId}`),
      workspaceId,
      name: "a.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode(text),
    });
  });

describe("attachment cleanup RPCs", () => {
  test("read settings and usage, change the policy, clear one Workspace", async () => {
    const home = tempDir("polaris-home-");

    cleanup.push(home);

    const store = AttachmentStoreLive({
      root: join(home, "staging"),
      settingsPath: join(home, "attachment-settings.json"),
    });

    const layer = AttachmentRpcsLive.pipe(
      Layer.provideMerge(Layer.merge(store, makeFakeBlobChannel().layer))
    );

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* stage(ws1, "12345");
          yield* stage(ws2, "123");
          const client = yield* RpcTest.makeClient(AttachmentRpcs);
          const before = yield* client["attachments.settings"]({});

          const settings = AttachmentSettings.make({
            default: { kind: "after-days", days: 30 },
            workspaces: { [ws2]: { kind: "never" } },
          });

          yield* client["attachments.setSettings"]({ settings });
          const cleared = yield* client["attachments.clear"]({ workspaceId: ws1 });
          const after = yield* client["attachments.settings"]({});

          return { before, cleared, after };
        }).pipe(Effect.provide(layer))
      )
    );

    expect(result.before.settings.default).toEqual({ kind: "on-archive" });
    expect(result.before.usage.total).toMatchObject({ bytes: 8, files: 2 });
    expect(result.before.usage.workspaces[ws1]).toMatchObject({ bytes: 5, files: 1 });
    expect(result.cleared).toMatchObject({ bytes: 5, files: 1 });
    expect(result.after.settings.default).toEqual({ kind: "after-days", days: 30 });
    expect(result.after.settings.workspaces[ws2]).toEqual({ kind: "never" });
    expect(result.after.usage.total).toMatchObject({ bytes: 3, files: 1 });
    expect(Object.keys(result.after.usage.workspaces)).toEqual([ws2]);
  });
});
