/**
 * Mounted once in the app: watches every Review Checkout's pull request on GitHub, relays new
 * heads to its Host, removes the checkouts of merged or closed pull requests (ENG-228), and
 * finishes "Discard edits and remove" once the discard has settled.
 */
import { useEffect, useMemo } from "react";
import { Commands } from "../../../commands.ts";
import { useApp, useConnection } from "../../../shell/hooks.ts";
import type { AppState } from "../../../store/store.ts";
import { polaris } from "../../bridge.ts";
import { usePulls } from "../../pulls/store.ts";
import { send } from "../../session/dispatch.ts";
import { removeCheckout } from "./actions.ts";
import {
  actionKey,
  decide,
  type HeldCheckout,
  pullOf,
  watchKey,
  watchList,
  type WatchAction,
} from "./model/watch.ts";
import {
  checkoutMemory,
  rememberPullIds,
  setRemoveAfterDiscard,
  useCheckoutMemory,
} from "./store.ts";

const heldOf = (state: AppState): ReadonlyArray<HeldCheckout> =>
  Object.entries(state.hostModels).flatMap(([hostKey, model]) =>
    [...model.reviewCheckouts.values()].flatMap((checkout) =>
      pullOf(checkout) === null ? [] : [{ hostKey, checkout }]
    )
  );

/** What was sent per watch key in this window. */
const sent = new Map<string, string>();

let held: ReadonlyArray<HeldCheckout> = [];

const labelOf = (hostKey: string, state: AppState) =>
  state.hosts.find((h) => h.key === hostKey)?.label ?? hostKey;

const run = (action: WatchAction, state: AppState) => {
  const key = watchKey(action.hostKey, action.checkout);
  sent.set(key, actionKey(action));

  const pull = pullOf(action.checkout);

  if (action.kind === "remove") {
    if (pull === null) return;
    void removeCheckout(
      {
        hostKey: action.hostKey,
        hostLabel: labelOf(action.hostKey, state),
        checkout: action.checkout,
      },
      { ...pull, pullId: null },
      action.reason
    );

    return;
  }

  void send(
    action.hostKey,
    Commands.ReportReviewHead({
      checkoutId: action.checkout.id,
      head: action.head,
      base: action.base,
    }),
    "Couldn’t tell the host about new commits"
  );
};

/** Removes checkouts whose discard has settled them; a blocked one keeps its blocker on screen. */
const finishDiscards = (state: AppState) => {
  const waiting = checkoutMemory.getState().removeAfterDiscard;

  for (const { hostKey, checkout } of held) {
    const key = watchKey(hostKey, checkout);
    const pull = pullOf(checkout);

    if (!waiting.has(key) || pull === null) continue;

    if (checkout.state === "ready" || checkout.state === "stale") {
      setRemoveAfterDiscard(key, false);
      void removeCheckout(
        { hostKey, hostLabel: labelOf(hostKey, state), checkout },
        { ...pull, pullId: null },
        "user"
      );
    } else if (checkout.state === "blocked") {
      setRemoveAfterDiscard(key, false);
    }
  }
};

export const CheckoutPublisher = () => {
  const { store } = useConnection();
  const signature = useApp((s) => JSON.stringify(heldOf(s)));
  const rows = usePulls((s) => s.list);
  const pullIds = useCheckoutMemory((s) => s.pullIds);

  // SAFETY: `signature` is `heldOf`'s output, serialized above.
  const current = useMemo(() => JSON.parse(signature) as ReadonlyArray<HeldCheckout>, [signature]);
  const watches = useMemo(() => watchList(current, pullIds), [current, pullIds]);
  const watchSignature = JSON.stringify(watches);

  useEffect(() => {
    if (rows === null) return;
    const all = [...rows.requested, ...rows.mine, ...rows.other];

    rememberPullIds(all.map((r) => [`${r.repo}#${r.number}`.toLowerCase(), r.id] as const));
  }, [rows]);

  useEffect(() => {
    held = current;
    finishDiscards(store.getState());
  }, [current, store]);

  useEffect(() => {
    // SAFETY: the signature is `watches`, serialized.
    const checkouts = JSON.parse(watchSignature) as typeof watches;

    void polaris().request("github.checkouts.watch", { checkouts: [...checkouts] });
  }, [watchSignature]);

  useEffect(
    () =>
      polaris().subscribe(
        "github.checkouts",
        {},
        {
          items: (items) => {
            const views = items.at(-1);

            if (views === undefined) return;
            const state = store.getState();

            for (const action of decide(views, held, sent, Date.now())) run(action, state);
          },
        }
      ),
    [store]
  );

  return null;
};
