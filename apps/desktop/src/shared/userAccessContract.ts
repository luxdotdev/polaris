/**
 * A Host's user access over IPC (ENG-927, ADR 0114): the Desktop Apps it enrolled and the
 * requests from ones it hasn't. Each method forwards the Daemon RPC of the same name.
 */
import { UserAccessId, type UserAccessState } from "@polaris/protocol";
import { Schema } from "effect";
import type { Plain } from "./api.ts";

const OnRequest = Schema.Struct({
  hostKey: Schema.String.check(Schema.isMinLength(1)),
  id: UserAccessId,
});

export const UserAccessRequestInputs = {
  "userAccess.allow": OnRequest,
  "userAccess.deny": OnRequest,
  "userAccess.revoke": OnRequest,
} as const;

export type UserAccessMethod = keyof typeof UserAccessRequestInputs;

export type UserAccessView = Plain<UserAccessState>;

export type EnrolledAppView = UserAccessView["enrolled"][number];

export type UserAccessRequestView = UserAccessView["requests"][number];

export type UserAccessRequestOutputs = {
  readonly "userAccess.allow": EnrolledAppView;
  readonly "userAccess.deny": void;
  readonly "userAccess.revoke": EnrolledAppView;
};
