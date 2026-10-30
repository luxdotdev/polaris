/**
 * What the Mobile App announces in `hello`: every capability this build's protocol knows,
 * `approval.secret` among them. Extensions announce `@polaris/sdk`'s shorter list instead.
 */
import { Capability } from "@polaris/protocol";

export const MOBILE_CAPABILITIES: ReadonlyArray<Capability> = Capability.literals;
