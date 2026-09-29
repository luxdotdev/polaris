/**
 * Sending commands from the session view. A refusal comes back with the
 * Daemon's reason ("interrupt the Turn in flight before archiving"), which is
 * what the user reads; it's shown as a Polaris toast unless the caller shows it.
 */
import type { Command } from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement } from "react";
import type { IpcError } from "../../../shared/api.ts";
import { newCommandId } from "../../commands.ts";
import { polaris } from "./bridge.ts";

export type Sent = { readonly ok: true } | { readonly ok: false; readonly error: IpcError };

export const dispatch = async (hostKey: string, command: Command): Promise<Sent> => {
  const result = await polaris().request("dispatch", {
    hostKey,
    commandId: newCommandId(),
    command,
  });

  return result.ok ? { ok: true } : { ok: false, error: result.error };
};

/** The Daemon's reason, first letter up: "Interrupt the Turn in flight before archiving". */
export const refusalText = (error: IpcError): string => {
  const text = error.message.replace(/^CommandRejected:\s*/, "").trim();

  return text === "" ? error.code : text.charAt(0).toUpperCase() + text.slice(1);
};

export const showRefusal = (title: string, error: IpcError) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message: refusalText(error),
  });

/** Dispatch, and toast the refusal under `title` ("Couldn't archive"). */
export const send = async (hostKey: string, command: Command, title: string) => {
  const sent = await dispatch(hostKey, command);

  if (!sent.ok) showRefusal(title, sent.error);

  return sent.ok;
};
