import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/http-api";

/** A base64url X25519 static public key (32 bytes, unpadded). */
export const NoiseKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));

const NonEmpty = Schema.String.check(Schema.isPattern(/\S/));

export const Person = Schema.Struct({
  personId: Schema.String,
  login: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});

export type Person = typeof Person.Type;

export const Me = Schema.Struct({
  ...Person.fields,
  commitEmail: Schema.String,
  /** The addresses `commitEmail` may be set to: verified GitHub addresses, then noreply. */
  commitEmails: Schema.Array(Schema.String),
});

export const ShareRef = Schema.Struct({
  id: NonEmpty,
  title: Schema.String,
  kind: Schema.Literals(["session", "constellation"]),
});

export const Role = Schema.Literals(["contributor", "commenter"]);

export const HostRef = Schema.Struct({
  name: NonEmpty,
  relayAddress: NonEmpty,
  noiseKey: NoiseKey,
});

export const PendingInvite = Schema.Struct({
  inviteId: Schema.String,
  owner: Person,
  share: ShareRef,
  host: Schema.Struct({ name: Schema.String }),
  role: Role,
  expiresAt: Schema.String,
});

export const ShareDevice = Schema.Struct({
  personId: Schema.String,
  relayAddress: Schema.String,
  noiseKey: Schema.String,
  /** A statement binding `noiseKey` to `personId`, valid for 15 minutes. */
  statement: Schema.String,
});

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()(
  "PersonNotFound",
  { login: Schema.String },
  { httpApiStatus: 404 }
) {}

export class InviteNotFound extends Schema.TaggedError<InviteNotFound>()(
  "InviteNotFound",
  { inviteId: Schema.String },
  { httpApiStatus: 404 }
) {}

/** The Invite was declined, revoked or has lapsed. */
export class InviteClosed extends Schema.TaggedError<InviteClosed>()(
  "InviteClosed",
  { inviteId: Schema.String, status: Schema.String },
  { httpApiStatus: 409 }
) {}

export class InvalidInvite extends Schema.TaggedError<InvalidInvite>()(
  "InvalidInvite",
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

export class CommitEmailNotAllowed extends Schema.TaggedError<CommitEmailNotAllowed>()(
  "CommitEmailNotAllowed",
  { commitEmail: Schema.String, allowed: Schema.Array(Schema.String) },
  { httpApiStatus: 400 }
) {}

/** The signed-in person, set by {@link SessionAuth}. */
export class CurrentPerson extends Context.Service<
  CurrentPerson,
  { readonly personId: string; readonly login: string }
>()("@polaris/accounts/CurrentPerson") {}

/** The Share a `Capability` credential names, set by {@link CapabilityAuth}. */
export class CurrentShare extends Context.Service<CurrentShare, { readonly inviteId: string }>()(
  "@polaris/accounts/CurrentShare"
) {}

/** `Authorization: Bearer <session token>`, from a GitHub sign-in or the device flow. */
export class SessionAuth extends HttpApiMiddleware.Service<
  SessionAuth,
  { provides: CurrentPerson }
>()("@polaris/accounts/SessionAuth", {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

/** `Authorization: Capability <hostCapability>`, the owner's Host's credential for one Share. */
export class CapabilityAuth extends HttpApiMiddleware.Service<
  CapabilityAuth,
  { provides: CurrentShare }
>()("@polaris/accounts/CapabilityAuth", {
  requiredForClient: true,
  security: { capability: HttpApiSecurity.http({ scheme: "Capability" }) },
  error: Unauthorized,
}) {}

export class AccountGroup extends HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("me", "/me", { success: Me }),
    HttpApiEndpoint.put("setMe", "/me", {
      payload: Schema.Struct({ commitEmail: Schema.String }),
      success: Me,
      error: CommitEmailNotAllowed,
    }),
    HttpApiEndpoint.post("statement", "/statements", {
      payload: Schema.Struct({ noiseKey: NoiseKey }),
      success: Schema.Struct({ jwt: Schema.String }),
    }),
    HttpApiEndpoint.get("person", "/people", {
      query: { login: Schema.String },
      success: Person,
      error: PersonNotFound,
    })
  )
  .middleware(SessionAuth)
  .prefix("/v1") {}

export class InvitesGroup extends HttpApiGroup.make("invites")
  .add(
    HttpApiEndpoint.post("create", "/invites", {
      payload: Schema.Struct({
        inviteeLogin: Schema.String,
        share: ShareRef,
        host: HostRef,
        role: Role,
        expiresAt: Schema.String,
      }),
      success: Schema.Struct({ inviteId: Schema.String, hostCapability: Schema.String }),
      error: [PersonNotFound, InvalidInvite],
    }),
    HttpApiEndpoint.get("pending", "/invites", { success: Schema.Array(PendingInvite) }),
    HttpApiEndpoint.post("accept", "/invites/:inviteId/accept", {
      params: { inviteId: Schema.String },
      payload: Schema.Struct({ relayAddress: NonEmpty, noiseKey: NoiseKey }),
      success: Schema.Struct({ host: HostRef, share: ShareRef, role: Role, owner: Person }),
      error: [InviteNotFound, InviteClosed],
    }),
    HttpApiEndpoint.post("decline", "/invites/:inviteId/decline", {
      params: { inviteId: Schema.String },
      success: HttpApiSchema.NoContent,
      error: [InviteNotFound, InviteClosed],
    })
  )
  .middleware(SessionAuth)
  .prefix("/v1") {}

export class SharesGroup extends HttpApiGroup.make("shares")
  .add(
    HttpApiEndpoint.get("devices", "/shares/:inviteId/devices", {
      params: { inviteId: Schema.String },
      success: Schema.Array(ShareDevice),
    }),
    HttpApiEndpoint.delete("revoke", "/shares/:inviteId/devices", {
      params: { inviteId: Schema.String },
      success: HttpApiSchema.NoContent,
    })
  )
  .middleware(CapabilityAuth)
  .prefix("/v1") {}

/** The Polaris endpoints of an Account Server; Better Auth's are under `/api/auth`. */
export class AccountsApi extends HttpApi.make("accounts")
  .add(AccountGroup)
  .add(InvitesGroup)
  .add(SharesGroup) {}
