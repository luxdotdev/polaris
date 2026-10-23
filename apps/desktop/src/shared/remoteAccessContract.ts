/**
 * Remote Access over IPC (Settings → Hosts, ENG-400): each forwards the Daemon RPC of the same
 * name on that Host, so a remote Host's switch works over its existing link.
 */
import { Schema } from "effect";

const OnHost = Schema.Struct({ hostKey: Schema.String.check(Schema.isMinLength(1)) });

export const RemoteAccessRequestInputs = {
  "remoteAccess.status": OnHost,
  "remoteAccess.enable": OnHost,
  "remoteAccess.disable": OnHost,
} as const;

export type RemoteAccessMethod = keyof typeof RemoteAccessRequestInputs;
