/**
 * Codex's collaboration mode: `plan` for Polaris's plan PermissionMode, `default` otherwise.
 * Setting it is experimental in app-server, so it goes over its own short connection (as
 * `processes.ts` does) and persists on the thread for the Turns after it.
 */
import type { PermissionMode } from "@polaris/protocol";
import { Effect } from "effect";
import type { AppServer } from "./AppServer.ts";
import type { CollaborationMode } from "./generated/CollaborationMode.ts";
import type { ModeKind } from "./generated/ModeKind.ts";

/** The collaboration mode a permission mode asks for; the Reviewer never plans. */
export const collaborationFor = (mode: PermissionMode, readOnly = false): ModeKind =>
  mode === "plan" && readOnly !== true ? "plan" : "default";

/** `thread/settings/update`'s collaboration mode (experimental; not in the stable bindings). */
export interface CollaborationUpdate {
  readonly threadId: string;
  readonly collaborationMode: CollaborationMode;
}

/**
 * Sets the thread's collaboration mode. The mode takes precedence over a Turn's `model` and
 * `effort`, so `settings` carries the ones the next Turn runs with.
 */
export const setCollaboration = (
  appServer: AppServer,
  clientVersion: string,
  update: CollaborationUpdate
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* appServer.connect;
      yield* conn.request("initialize", {
        clientInfo: { name: "polaris", title: "Polaris", version: clientVersion },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      yield* conn.notify("initialized");
      yield* conn.request("thread/settings/update", update);
    })
  );
