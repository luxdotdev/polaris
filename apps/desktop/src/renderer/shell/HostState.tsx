/**
 * A Host's Connection State, inline and never modal (V0 review, S8): the host
 * row alone dims while reconnecting, with how long it has been; the reason
 * sits in a sunken code well under the sidebar header.
 */
import { CodeWell, cn } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { HostView } from "../../shared/api.ts";
import { connectionLabel } from "./copy.ts";

const SECOND = 1000;

/** Seconds since `since`, ticking once a second only while `active`. */
const useElapsed = (since: number, active: boolean) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), SECOND);

    return () => clearInterval(timer);
  }, [active]);

  return Math.max(0, Math.round((now - since) / SECOND));
};

const elapsedLabel = (seconds: number) =>
  seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m`
      : `${Math.floor(seconds / 3600)}h`;

/** "reconnecting 12s", "needs attention", "offline"; nothing while connected. */
export const HostStateLabel = ({ host }: { readonly host: HostView }) => {
  const { state, since } = host.status;
  const reconnecting = state === "reconnecting";
  const seconds = useElapsed(since, reconnecting);

  if (state === "connected") return null;

  return (
    <span
      data-testid={`connection-${host.key}`}
      data-state={state}
      className={cn(
        "text-caption",
        state === "needs-attention" ? "text-text-default" : "text-text-faint"
      )}
    >
      {connectionLabel[state]}
      {reconnecting ? ` ${elapsedLabel(seconds)}` : ""}
    </span>
  );
};

/** Under the sidebar header while the Host isn't connected: the state as a kicker, the reason in a well. */
export const HostStateNote = ({ host }: { readonly host: HostView }) => {
  const { state, failure } = host.status;

  if (state === "connected") return null;

  return (
    <div className="flex flex-col gap-1.5">
      <HostStateLabel host={host} />
      {failure === null ? null : (
        <CodeWell className="text-code-inline text-text-default whitespace-pre-wrap">
          {failure.detail}
        </CodeWell>
      )}
    </div>
  );
};
