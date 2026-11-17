import type { Actor } from "@polaris/protocol";
import { Predicate } from "effect";

/** Who acted as the user, for the Lead and status: a Teammate by name, else the user. */
export const userName = (actor: Actor | null | undefined) =>
  actor != null && Predicate.isTagged(actor, "Teammate")
    ? `${actor.name.replace(/\s+/g, " ").trim()} (a Teammate)`
    : "the user";
