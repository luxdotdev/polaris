/**
 * Start, once (screens review 8): a tap while a Start is in flight is dropped synchronously, a
 * started session can't start again, and a retry of the same choices keeps its command id, so
 * the Daemon applies it once however often it arrives.
 */
import { CommandId } from "@polaris/protocol";
import { newSessionId } from "./model.ts";

export const newCommandId = (): CommandId => CommandId.make(newSessionId());

/**
 * Runs `send` with a command id unless a Start is in flight or done; resolves whether it ran.
 * `key` names the choices: the same key after a failure reuses the id, a changed one gets a new id.
 */
export type StartLatch = (
  key: string,
  send: (commandId: CommandId) => Promise<void>
) => Promise<boolean>;

export const startLatch = (newId: () => CommandId = newCommandId): StartLatch => {
  let phase: "ready" | "sending" | "started" = "ready";
  let last: { readonly key: string; readonly id: CommandId } | null = null;

  return async (key, send) => {
    if (phase !== "ready") return false;
    phase = "sending";
    const id = last !== null && last.key === key ? last.id : newId();

    last = { key, id };

    try {
      await send(id);
      phase = "started";

      return true;
    } catch (failure) {
      phase = "ready";
      throw failure;
    }
  };
};

/** Start takes the prompt: dictation ends first, so it writes nothing more into the field. */
export const takePrompt = (voice: { readonly release: () => void } | null, field: () => string) => {
  voice?.release();

  return field();
};
