/**
 * The Constellation commands the tab sends (`ConstellationRpcs`). The Desktop App's IPC has no
 * `constellation.*` requests yet, so the client is installable: previews put in a fake.
 */
import {
  type ConstellationAnswer,
  type ConstellationMessage,
  type ConstellationReview,
  type ConstellationSetState,
  CommandId,
} from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import type { Rpc } from "effect/rpc";
import { createElement } from "react";
import { newCommandId } from "../../commands.ts";

type Without<P> = Omit<P, "commandId">;

export type ReviewInput = Without<Rpc.Payload<typeof ConstellationReview>>;

export type AnswerInput = Without<Rpc.Payload<typeof ConstellationAnswer>>;

export type MessageInput = Without<Rpc.Payload<typeof ConstellationMessage>>;

export type SetStateInput = Without<Rpc.Payload<typeof ConstellationSetState>>;

export type Outcome =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly message: string; readonly fix: string | null };

/** Each mutation carries a fresh command id; the Host is the Lead's (the stream's owner). */
export interface ConstellationClient {
  readonly review: (hostKey: string, input: ReviewInput & WithId) => Promise<Outcome>;
  readonly answer: (hostKey: string, input: AnswerInput & WithId) => Promise<Outcome>;
  readonly message: (hostKey: string, input: MessageInput & WithId) => Promise<Outcome>;
  readonly setState: (hostKey: string, input: SetStateInput & WithId) => Promise<Outcome>;
}

interface WithId {
  readonly commandId: CommandId;
}

const unavailable = async (): Promise<Outcome> => ({
  ok: false,
  message: "This version of Polaris can't send Constellation commands yet",
  fix: null,
});

const UNWIRED: ConstellationClient = {
  review: unavailable,
  answer: unavailable,
  message: unavailable,
  setState: unavailable,
};

let installed: ConstellationClient = UNWIRED;

export const installConstellationClient = (client: ConstellationClient) => {
  installed = client;
};

const toast = (title: string, outcome: Extract<Outcome, { ok: false }>) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message: outcome.fix === null ? outcome.message : `${outcome.message}. ${outcome.fix}`,
  });

const run = async (title: string, send: (id: CommandId) => Promise<Outcome>) => {
  const outcome = await send(newCommandId());

  if (!outcome.ok) toast(title, outcome);

  return outcome.ok;
};

/** Sends and toasts a refusal under `title`; resolves true when the Daemon took it. */
export const constellationCommands = {
  review: (hostKey: string, input: ReviewInput, title: string) =>
    run(title, (commandId) => installed.review(hostKey, { ...input, commandId })),
  answer: (hostKey: string, input: AnswerInput, title: string) =>
    run(title, (commandId) => installed.answer(hostKey, { ...input, commandId })),
  message: (hostKey: string, input: MessageInput, title: string) =>
    run(title, (commandId) => installed.message(hostKey, { ...input, commandId })),
  setState: (hostKey: string, input: SetStateInput, title: string) =>
    run(title, (commandId) => installed.setState(hostKey, { ...input, commandId })),
};
