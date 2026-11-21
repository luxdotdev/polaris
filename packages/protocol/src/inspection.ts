/** Developer Mode's on-demand Desktop App inspection relay (ENG-1025). */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { Unsupported } from "./errors.ts";
import { SessionId } from "./ids.ts";

export const INSPECTION_CAPABILITY = "developer-mode.inspection";

export const DesktopWindowSnapshot = Schema.Struct({
  id: Schema.Int,
  title: Schema.String.check(Schema.isMaxLength(512)),
  focused: Schema.Boolean,
  bounds: Schema.Struct({ x: Schema.Int, y: Schema.Int, width: Schema.Int, height: Schema.Int }),
  /** Renderer-generated visible view and structure; excludes input values. */
  view: Schema.String.check(Schema.isMaxLength(12000)),
});

export const DesktopSnapshot = Schema.Struct({
  capturedAt: Schema.Number,
  windows: Schema.Array(DesktopWindowSnapshot).check(Schema.isMaxLength(16)),
});

export type DesktopSnapshot = typeof DesktopSnapshot.Type;

export const InspectionRequest = Schema.Struct({ requestId: Schema.String, sessionId: SessionId });

export class InspectionRpcs extends RpcGroup.make(
  Rpc.make("inspection.watch", {
    payload: {},
    success: InspectionRequest,
    error: Unsupported,
    stream: true,
  }),
  Rpc.make("inspection.respond", {
    payload: { requestId: Schema.String, snapshot: Schema.NullOr(DesktopSnapshot) },
    success: Schema.Void,
    error: Unsupported,
  })
) {}
