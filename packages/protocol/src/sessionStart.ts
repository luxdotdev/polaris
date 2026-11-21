/** CLI starts resolve omitted fields on the Host from the trusted Actor (ADR 0119). */
import { Schema, Struct } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { CommandRejected } from "./errors.ts";
import { Command } from "./commands.ts";
import { CommandAnnotation } from "./commandAnnotations.ts";
import { NotFound, Unsupported } from "./errors.ts";
import { UserAccessRequired } from "./userAccess.ts";
import { NotGranted } from "./extensions.ts";
import { ReasoningEffort } from "./models.ts";
import { SessionId } from "./ids.ts";

const fields = Struct.omit(Command.cases.StartSession.fields, ["_tag", "origin", "reviewSubject"]);

export const SessionStartInput = Schema.Struct({
  ...fields,
  sessionId: Schema.optionalKey(fields.sessionId),
  workspaceId: Schema.optionalKey(fields.workspaceId),
  harness: Schema.optionalKey(fields.harness),
  placement: Schema.optionalKey(fields.placement),
  permissionMode: Schema.optionalKey(fields.permissionMode),
  model: Schema.optionalKey(fields.model),
  effort: Schema.optionalKey(Schema.NullOr(ReasoningEffort)),
  attachments: Schema.optionalKey(fields.attachments),
  cwd: Schema.optionalKey(Schema.String),
});

export class SessionStartUsage extends Schema.TaggedError<SessionStartUsage>()(
  "SessionStartUsage",
  { message: Schema.String }
) {}

export const SessionStartRpcs = RpcGroup.make(
  Rpc.make("session.start", {
    payload: SessionStartInput,
    success: Schema.Struct({ sessionId: SessionId, sequence: Schema.NullOr(Schema.Number) }),
    error: Schema.Union([
      SessionStartUsage,
      CommandRejected,
      NotFound,
      NotGranted,
      Unsupported,
      UserAccessRequired,
    ]),
  }).annotate(CommandAnnotation, [
    {
      name: "session.start",
      description:
        "Start an agent session, using your Workspace and Harness when called by an agent.",
      grant: "start",
      examples: ['polaris session start "Review this change" --harness claude'],
      positional: ["prompt"],
      stdin: "prompt",
    },
  ])
);
