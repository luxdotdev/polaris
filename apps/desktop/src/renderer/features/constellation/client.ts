/**
 * The Constellation commands the tab sends (`ConstellationRpcs`), over the `constellation.*`
 * IPC requests; installable, so previews put in a fake Daemon.
 */
import {
  type ConstellationAnswer,
  type ConstellationDispatch,
  type ConstellationMessage,
  type ConstellationReview,
  type ConstellationSetState,
  CommandId,
} from "@polaris/protocol";
import { PixelFailedIcon, showToast } from "@polaris/ui";
import type { Rpc } from "effect/rpc";
import { createElement } from "react";
import { newCommandId } from "../../commands.ts";
import type { IpcFinding } from "../../../shared/api.ts";
import type { RequestInput } from "../../../shared/contract.ts";
import { polaris } from "../bridge.ts";

type Without<P> = Omit<P, "commandId">;

export type ReviewInput = Without<Rpc.Payload<typeof ConstellationReview>>;

export type DispatchInput = Without<Rpc.Payload<typeof ConstellationDispatch>>;

export type AnswerInput = Without<Rpc.Payload<typeof ConstellationAnswer>>;

export type MessageInput = Without<Rpc.Payload<typeof ConstellationMessage>>;

export type SetStateInput = Without<Rpc.Payload<typeof ConstellationSetState>>;

export type Outcome =
  | { readonly ok: true; readonly summary: string }
  | {
      readonly ok: false;
      readonly message: string;
      readonly fix: string | null;
      readonly findings?: ReadonlyArray<IpcFinding> | undefined;
    };

/** Each mutation carries a fresh command id; the Host is the Lead's (the stream's owner). */
export interface ConstellationClient {
  readonly review: (hostKey: string, input: ReviewInput & WithId) => Promise<Outcome>;
  readonly dispatch: (hostKey: string, input: DispatchInput & WithId) => Promise<Outcome>;
  readonly answer: (hostKey: string, input: AnswerInput & WithId) => Promise<Outcome>;
  readonly message: (hostKey: string, input: MessageInput & WithId) => Promise<Outcome>;
  readonly setState: (hostKey: string, input: SetStateInput & WithId) => Promise<Outcome>;
}

interface WithId {
  readonly commandId: CommandId;
}

type Method =
  | "constellation.review"
  | "constellation.dispatch"
  | "constellation.answer"
  | "constellation.message"
  | "constellation.set_state";

/** A refusal's message already lists each finding as "<message>. <fix>" (the IPC's contract). */
const viaIpc =
  <M extends Method>(method: M) =>
  async (hostKey: string, input: Omit<RequestInput<M>, "hostKey">): Promise<Outcome> => {
    // SAFETY: `input` is this method's payload; the IPC input adds only the Host.
    const result = await polaris().request(method, { hostKey, ...input } as RequestInput<M>);

    return result.ok
      ? { ok: true, summary: result.value.summary }
      : { ok: false, message: result.error.message, fix: null, findings: result.error.findings };
  };

const IPC: ConstellationClient = {
  review: viaIpc("constellation.review"),
  dispatch: viaIpc("constellation.dispatch"),
  answer: viaIpc("constellation.answer"),
  message: viaIpc("constellation.message"),
  setState: viaIpc("constellation.set_state"),
};

let installed: ConstellationClient = IPC;

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

/** Sends a review and returns its outcome untoasted, for callers that word refusals themselves. */
export const sendReview = (hostKey: string, input: ReviewInput): Promise<Outcome> =>
  installed.review(hostKey, { ...input, commandId: newCommandId() });

/** Sends and toasts a refusal under `title`; resolves true when the Daemon took it. */
export const constellationCommands = {
  review: (hostKey: string, input: ReviewInput, title: string) =>
    run(title, (commandId) => installed.review(hostKey, { ...input, commandId })),
  dispatch: (hostKey: string, input: DispatchInput, title: string) =>
    run(title, (commandId) => installed.dispatch(hostKey, { ...input, commandId })),
  answer: (hostKey: string, input: AnswerInput, title: string) =>
    run(title, (commandId) => installed.answer(hostKey, { ...input, commandId })),
  message: (hostKey: string, input: MessageInput, title: string) =>
    run(title, (commandId) => installed.message(hostKey, { ...input, commandId })),
  setState: (hostKey: string, input: SetStateInput, title: string) =>
    run(title, (commandId) => installed.setState(hostKey, { ...input, commandId })),
};
