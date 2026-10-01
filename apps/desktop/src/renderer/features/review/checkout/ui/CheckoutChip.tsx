/**
 * The Review Checkout chip beside the primary action (Paper R5 8B5-0) and its menu (R4 804-0),
 * on one pull request's checkouts.
 */
import { Popover } from "@polaris/ui";
import { useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { useShellActions } from "../../../../shell/hooks.ts";
import type { ReviewSlotProps } from "../../surface.ts";
import { checkOutOn, runFix, startRunIn, stopRunIn, updateCheckout } from "../actions.ts";
import { chipAction } from "../model/chip.ts";
import { type CheckoutModel, useCheckout } from "../useCheckout.ts";
import { CheckoutMenu } from "./CheckoutMenu.tsx";
import { ChipFace } from "./ChipFace.tsx";

const runAction = (
  model: CheckoutModel,
  pull: OpenPull,
  nav: ReturnType<typeof useShellActions>
) => {
  const { view, held, nextPlace, detail, command } = model;

  if (held !== null && view.kind === "new-commits") void updateCheckout(held);
  else if (held !== null && view.kind === "blocked") runFix(view.block.fix, held, pull, nav);
  else if (held !== null && view.kind === "ready" && command.kind === "found") {
    void startRunIn(held, command.command);
  } else if (held !== null && view.kind === "running") void stopRunIn(held);
  else if (view.kind === "offline" && nextPlace !== null && detail !== null) {
    void checkOutOn(nextPlace, pull, detail);
  }
};

/** Actions that open the menu: a discard asks first, and a clone picks its Host there. */
const opensMenu = (model: CheckoutModel) =>
  (model.view.kind === "blocked" && model.view.block.confirm !== null) ||
  model.view.kind === "none" ||
  model.view.kind === "clone-failed";

export const CheckoutChip = ({ subject }: ReviewSlotProps) =>
  subject.kind === "pull" ? <PullCheckoutChip pull={subject.pull} /> : null;

const PullCheckoutChip = ({ pull }: { readonly pull: OpenPull }) => {
  const model = useCheckout(pull);
  const nav = useShellActions();
  const [open, setOpen] = useState(false);
  // Opened by a fix that asks first: the menu opens at its confirmation.
  const [asking, setAsking] = useState(false);
  const menuFirst = opensMenu(model);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) setAsking(false);
      }}
    >
      <ChipFace
        view={model.view}
        action={chipAction(model.view)}
        actionOpensMenu={menuFirst}
        onAction={() => (menuFirst ? setAsking(true) : runAction(model, pull, nav))}
      />
      <CheckoutMenu model={model} pull={pull} asking={asking} onDone={() => setOpen(false)} />
    </Popover>
  );
};
