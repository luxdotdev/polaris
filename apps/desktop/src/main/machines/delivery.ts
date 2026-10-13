/**
 * What the install card says while a build reaches a Host, by the plan's
 * delivery: copied from this app, downloaded on the Host, or downloaded here first.
 */
import type { InstallPlan } from "@polaris/client/install";
import { Match, Predicate } from "effect";
import { clientCopy } from "../../shared/clientCopy.ts";

export interface DeliveryCopy {
  /** The Host's name in running text: the alias or distro. */
  readonly host: string;
  /** What copying the bundled build says ("Copying the build over SSH…"). */
  readonly copying: string;
  readonly platform: string;
}

export const deliveryActivity = (plan: InstallPlan, copy: DeliveryCopy): string => {
  if (!Predicate.isTagged(plan, "Install") && !Predicate.isTagged(plan, "Upgrade"))
    return copy.copying;

  return Match.value(plan.delivery).pipe(
    Match.tagsExhaustive({
      Upload: () => copy.copying,
      HostFetch: () => `Downloading the build on ${copy.host} and checking its SHA-256`,
      ClientFetch: () =>
        `Downloading the build to ${clientCopy(copy.platform).machine}, then copying it to ${copy.host}`,
    })
  );
};
