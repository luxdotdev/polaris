/**
 * Mounted once in the app: watches user access on every connected Host that enrols desktop apps,
 * and asks, in a toast that stays, about each new request while this app holds user access.
 */
import { dismissToast, PixelKeyIcon, showToast } from "@polaris/ui";
import { createElement, useEffect } from "react";
import type { UserAccessView } from "../../../shared/userAccessContract.ts";
import { polaris } from "../bridge.ts";
import { useApp } from "../../shell/hooks.ts";
import { allowRequest, denyRequest } from "./actions.ts";
import { CAPABILITY, requestBody, requestTitle } from "./model.ts";
import { setUserAccess } from "./store.ts";

/** The toast of each request asked about, by Host and request: a feed that restarts doesn't ask twice. */
const asked = new Map<string, string | number>();

export const resetUserAccessWatcher = () => asked.clear();

const keyOf = (hostKey: string, id: string) => `${hostKey}\u0000${id}`;

/** A request answered elsewhere, or whose desktop app left, takes its toast down. */
const settle = (hostKey: string, open: ReadonlySet<string>) => {
  for (const [key, toast] of asked) {
    if (!key.startsWith(`${hostKey}\u0000`) || open.has(key)) continue;
    dismissToast(toast);
    asked.delete(key);
  }
};

const ask = (hostKey: string, host: string, state: UserAccessView) => {
  settle(hostKey, new Set(state.requests.map((request) => keyOf(hostKey, request.id))));

  for (const request of state.requests) {
    const key = keyOf(hostKey, request.id);

    if (asked.has(key)) continue;

    const toast = showToast({
      source: "starlight",
      icon: createElement(PixelKeyIcon, { size: 16 }),
      title: requestTitle(request, host),
      message: requestBody(request, host),
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Allow", onAction: () => void allowRequest(hostKey, request) },
      secondaryAction: {
        label: "Deny",
        emphasis: "secondary",
        onAction: () => void denyRequest(hostKey, request),
      },
    });

    asked.set(key, toast);
  }
};

export const UserAccessWatcher = () => {
  const hosts = useApp((s) => s.hosts);

  // A feed per connection: the roster changes when a Host connects, reconnects or is renamed.
  const roster = hosts
    .filter((h) => h.status.state === "connected" && h.status.capabilities.includes(CAPABILITY))
    .map(
      (h) => `${h.key}\u0000${h.status.state === "connected" ? h.status.epoch : ""}\u0000${h.label}`
    )
    .join("\u0001");

  useEffect(() => {
    const stops = roster
      .split("\u0001")
      .filter((entry) => entry !== "")
      .map((entry) => {
        const [hostKey = "", , label = ""] = entry.split("\u0000");

        const stop = polaris().subscribe(
          "userAccess.watch",
          { hostKey },
          {
            items: (items) => {
              const last = items.at(-1);

              if (last === undefined) return;
              setUserAccess(hostKey, last);
              ask(hostKey, label, last);
            },
            end: () => setUserAccess(hostKey, null),
          }
        );

        return () => {
          stop();
          setUserAccess(hostKey, null);
        };
      });

    return () => stops.forEach((stop) => stop());
  }, [roster]);

  return null;
};
