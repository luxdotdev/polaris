/**
 * Constellation commands from the renderer: `constellationRequest` sends one to the Lead's Host
 * (U1's tab imports it as its default client), and the shell's own actions toast a refusal.
 */
import { CommandId } from "@polaris/protocol";
import type { Result } from "../../../shared/api.ts";
import type { RequestInput } from "../../../shared/contract.ts";
import type { ConstellationMethod } from "../../../shared/constellationContract.ts";
import type { RequestOutput } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";
import { showRefusal } from "../session/dispatch.ts";

/** A mutation's payload without the Host and command id, which this module fills in. */
export type ConstellationPayload<M extends ConstellationMethod> = Omit<
  RequestInput<M>,
  "hostKey" | "commandId"
>;

const withId = <M extends ConstellationMethod>(method: M, payload: ConstellationPayload<M>) =>
  method === "constellation.status" ? payload : { ...payload, commandId: newCommandId() };

export const newCommandId = () => CommandId.make(crypto.randomUUID());

export const constellationRequest = <M extends ConstellationMethod>(
  hostKey: string,
  method: M,
  payload: ConstellationPayload<M>
): Promise<Result<RequestOutput<M>>> =>
  polaris().request(method, { hostKey, ...withId(method, payload) });

/** Sends, and toasts the refusal under `title` ("Couldn't send it back"); true when it landed. */
export const sendConstellation = async <M extends ConstellationMethod>(
  hostKey: string,
  method: M,
  payload: ConstellationPayload<M>,
  title: string
) => {
  const result = await constellationRequest(hostKey, method, payload);

  if (!result.ok) showRefusal(title, result.error);

  return result.ok;
};
