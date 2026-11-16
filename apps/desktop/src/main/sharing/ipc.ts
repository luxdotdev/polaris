/** The `sharing.*` requests and feeds behind the typed bridge. Tokens and capabilities stay here. */
import { Effect, Stream, SubscriptionRef } from "effect";
import type {
  SharingRequestInputs,
  SharingSubscriptionInputs,
} from "../../shared/sharingContract.ts";
import { toIpcError } from "../hosts.ts";
import type { Feed } from "../ipc/feeds.ts";
import type { Handler } from "../ipc/requests.ts";
import { DesktopSharing } from "./index.ts";

const use = <A, E extends { readonly _tag: string; readonly message: string }>(
  run: (sharing: DesktopSharing["Service"]) => Effect.Effect<A, E>
) => DesktopSharing.use(run).pipe(Effect.mapError(toIpcError));

type SharingHandlers = { readonly [M in keyof typeof SharingRequestInputs]: Handler<M> };

export const sharingHandlers: SharingHandlers = {
  "sharing.share": (input) => use((s) => s.share(input)),
  "sharing.list": ({ hostKey, sessionId }) => use((s) => s.list(hostKey, sessionId)),
  "sharing.sharedSessions": ({ hostKey }) => use((s) => s.sharedSessions(hostKey)),
  "sharing.renew": ({ hostKey, shareId, expiresAt }) =>
    use((s) => s.renew(hostKey, shareId, expiresAt)),
  "sharing.revoke": ({ hostKey, shareId }) => use((s) => s.revoke(hostKey, shareId)),
  "sharing.invite.accept": ({ accountId, inviteId }) => use((s) => s.accept(accountId, inviteId)),
  "sharing.invite.decline": ({ accountId, inviteId }) =>
    use((s) => Effect.as(s.decline(accountId, inviteId), null)),
  "sharing.invites.refresh": () => use((s) => Effect.as(s.refreshInvites, null)),
};

type SharingOpeners = {
  readonly [K in keyof typeof SharingSubscriptionInputs]: (
    input: (typeof SharingSubscriptionInputs)[K]["Type"]
  ) => Feed<K>;
};

export const sharingOpeners: SharingOpeners = {
  "sharing.withMe": () =>
    Stream.unwrap(DesktopSharing.useSync((s) => SubscriptionRef.changes(s.view))),
  "sharing.presence": ({ hostKey, sessionId }) =>
    Stream.unwrap(DesktopSharing.useSync((s) => s.presence(hostKey, sessionId))).pipe(
      Stream.mapError(toIpcError)
    ),
};
