/** Setting authority is checked before asking the user for a Grant. */
import { NotGranted, type SettingDescription } from "@polaris/protocol";
import { Effect } from "effect";
import type { Engine } from "../engine/Engine.ts";
import { type Actor, unattributedReason } from "../transport/actor.ts";

export const authorizeSetting = (
  actor: Actor,
  setting: SettingDescription,
  rpc: string,
  engine?: Engine["Service"]
) => {
  if (actor.kind === "user") return Effect.void;

  if (setting.userOnly === true)
    return Effect.fail(
      new NotGranted({
        what: rpc,
        needed: null,
        reason: `Only the user can change ${setting.key}.`,
      })
    );

  if (actor.kind === "agentUnattributed")
    return Effect.fail(new NotGranted({ what: rpc, needed: null, reason: unattributedReason }));

  if (engine === undefined)
    return Effect.fail(
      new NotGranted({ what: rpc, needed: "settings", reason: "Session Grants are unavailable." })
    );

  return engine
    .authorizeSessionAction(actor.sessionId, { rpc, settingKey: setting.key })
    .pipe(
      Effect.catchTag("NotFound", (error) =>
        Effect.fail(new NotGranted({ what: rpc, needed: null, reason: error.message }))
      )
    );
};
