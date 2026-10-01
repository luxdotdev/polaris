/**
 * What the chip and its menu do: update, remove, check out on another Host, open a terminal
 * in the checkout, and each blocker's fix. Commands go to the Host holding the checkout.
 */
import type { ReviewCheckout } from "@polaris/protocol";
import { Match } from "effect";
import type { OpenPull } from "../../../../shared/api.ts";
import type { PullDetailView } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import type { ShellActions } from "../../../routes/navigation.ts";
import { send } from "../../session/dispatch.ts";
import { isTerminalShown, runInTerminal, toggleTerminal } from "../../terminal/index.ts";
import { openCheckout } from "../data/autoCheckout.ts";
import type { CheckoutFix } from "./model/chip.ts";
import type { Place } from "./model/hosts.ts";
import { pullName, watchKey } from "./model/watch.ts";
import {
  forgetRemoved,
  rememberHost,
  rememberRemoved,
  repoName,
  setRemoveAfterDiscard,
} from "./store.ts";

export interface Held {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly checkout: ReviewCheckout;
}

type Nav = Pick<ShellActions, "selectWorkspace" | "selectSession">;

export const updateCheckout = (held: Held, discardChanges = false) =>
  send(
    held.hostKey,
    Commands.UpdateReviewCheckout({ checkoutId: held.checkout.id, discardChanges }),
    "Couldn’t update the review checkout"
  );

export const removeCheckout = async (
  held: Held,
  pull: OpenPull,
  reason: "merged" | "closed" | "user"
) => {
  const sent = await send(
    held.hostKey,
    Commands.RemoveReviewCheckout({ checkoutId: held.checkout.id, reason }),
    "Couldn’t remove the review checkout"
  );

  if (sent) rememberRemoved(pullName(pull), { host: held.hostLabel, reason });

  return sent;
};

/** Drops the checkout's edits (an update with `discardChanges`), then removes it once it settles. */
export const discardAndRemove = async (held: Held) => {
  const key = watchKey(held.hostKey, held.checkout);
  setRemoveAfterDiscard(key, true);

  const sent = await updateCheckout(held, true);

  if (!sent) setRemoveAfterDiscard(key, false);
};

/** Checks the pull request out on `place`, which becomes the repository's last used Host. */
export const checkOutOn = (place: Place, pull: OpenPull, detail: PullDetailView) => {
  rememberHost(repoName(pull.repo), place.hostKey);
  forgetRemoved(pullName(pull));

  return openCheckout(place, pull, detail);
};

/** Shows the checkout's Host and Workspace in Orchestrate with a shell in the checkout. */
export const openTerminalIn = (nav: Nav, held: Held, pull: OpenPull) => {
  const { hostKey, checkout } = held;
  const workspaceId = checkout.workspaceId;

  nav.selectWorkspace({ hostKey, workspaceId });
  void runInTerminal(
    { hostKey, workspaceId },
    {
      key: `review:${checkout.id}`,
      title: `#${pull.number} checkout`,
      cwd: checkout.path,
      argv: null,
    }
  );
};

const showTerminal = (nav: Nav, held: Held) => {
  const { hostKey, checkout } = held;

  nav.selectWorkspace({ hostKey, workspaceId: checkout.workspaceId });

  if (!isTerminalShown(hostKey, checkout.workspaceId)) {
    toggleTerminal({ hostKey, workspaceId: checkout.workspaceId }, checkout.path, "checkout");
  }
};

/** Runs a blocker's one fix. */
export const runFix = (fix: CheckoutFix, held: Held, pull: OpenPull, nav: Nav) =>
  Match.value(fix).pipe(
    Match.discriminatorsExhaustive("kind")({
      retry: () => void updateCheckout(held),
      "fetch-full": () => void updateCheckout(held),
      "discard-update": () => void updateCheckout(held, true),
      "discard-remove": () => void discardAndRemove(held),
      "open-terminal": () => openTerminalIn(nav, held, pull),
      "show-terminal": () => showTerminal(nav, held),
      "show-session": ({ sessionId }) => nav.selectSession({ hostKey: held.hostKey, sessionId }),
    })
  );
