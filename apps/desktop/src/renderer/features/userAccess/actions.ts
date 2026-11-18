/** Allow, deny and revoke on one Host; a refusal toasts with the Daemon's reason. */
import type { EnrolledAppView, UserAccessRequestView } from "../../../shared/userAccessContract.ts";
import { polaris } from "../bridge.ts";
import { showRefusal } from "../session/dispatch.ts";

export const allowRequest = async (hostKey: string, request: UserAccessRequestView) => {
  const result = await polaris().request("userAccess.allow", { hostKey, id: request.id });

  if (!result.ok) showRefusal(`Couldn't allow ${request.label}`, result.error);
};

export const denyRequest = async (hostKey: string, request: UserAccessRequestView) => {
  const result = await polaris().request("userAccess.deny", { hostKey, id: request.id });

  if (!result.ok) showRefusal(`Couldn't deny ${request.label}`, result.error);
};

export const revokeApp = async (hostKey: string, app: EnrolledAppView) => {
  const result = await polaris().request("userAccess.revoke", { hostKey, id: app.id });

  if (!result.ok) showRefusal(`Couldn't revoke ${app.label}`, result.error);
};
