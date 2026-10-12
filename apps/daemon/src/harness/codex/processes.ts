/**
 * Codex commands still running after the model moved on without them (a later item
 * started, or the Turn ended): the session's background tasks. Codex keeps such a
 * process alive across Turns, and one leaves when Codex reports it complete.
 */
import { BackgroundTask } from "@polaris/protocol";
import { Effect } from "effect";
import type { AppServer } from "./AppServer.ts";

interface Running {
  readonly command: string;
  readonly processId: string | null;
  background: boolean;
}

export class CodexProcesses {
  /** Commands of the main thread in progress, by item id, in the order they started. */
  private readonly running = new Map<string, Running>();

  /** A command started. The model moved on from every earlier one. */
  commandStarted(itemId: string, command: string, processId: string | null): boolean {
    const changed = this.movedOn(itemId);
    this.running.set(itemId, { command, processId, background: false });

    return changed;
  }

  /** Another item started: commands still running are now in the background. */
  itemStarted(itemId: string): boolean {
    return this.movedOn(itemId);
  }

  /** A command completed, perhaps after its Turn ended. */
  completed(itemId: string): boolean {
    const was = this.running.get(itemId);
    this.running.delete(itemId);

    return was?.background === true;
  }

  /** The Turn ended with commands still running: they carry on in the background. */
  turnEnded(): boolean {
    return this.movedOn(null);
  }

  /** The background commands, as the session lists them; ids are their items' ids. */
  tasks(): ReadonlyArray<BackgroundTask> {
    return [...this.running].flatMap(([id, running]) =>
      running.background
        ? [new BackgroundTask({ id, kind: "command", description: running.command })]
        : []
    );
  }

  /** The process behind a background command, for waiting on it. */
  processOf(itemId: string): string | null {
    return this.running.get(itemId)?.processId ?? null;
  }

  private movedOn(except: string | null): boolean {
    let changed = false;

    for (const [id, running] of this.running) {
      if (id === except || running.background) continue;
      running.background = true;
      changed = true;
    }

    return changed;
  }
}

/**
 * Ends a background terminal. The call is experimental in app-server, so it goes
 * over its own short connection rather than opting the session's into that API.
 */
export const terminateProcess = (
  appServer: AppServer,
  clientVersion: string,
  threadId: string,
  processId: string
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const conn = yield* appServer.connect;
      yield* conn.request("initialize", {
        clientInfo: { name: "polaris", title: "Polaris", version: clientVersion },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      yield* conn.notify("initialized");
      yield* conn.request("thread/backgroundTerminals/terminate", { threadId, processId });
    })
  );
