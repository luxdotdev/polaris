/** A Linked Device (Paper D1): where it's shared, when it was last seen, Retry, and a two-step Unlink. */
import { Button, cn } from "@polaris/ui";
import { useState } from "react";
import { type DeviceSummary, lastSeenLine, sharedLine } from "./model.ts";

export const DeviceRow = ({
  device,
  now,
  onUnlink,
  onRetry,
}: {
  readonly device: DeviceSummary;
  readonly now: number;
  readonly onUnlink: () => Promise<void>;
  readonly onRetry: () => Promise<void>;
}) => {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action().finally(() => {
      setBusy(false);
      setAsking(false);
    });
  };

  return (
    <div
      className={cn("px-panel flex h-14 items-center gap-3", asking && "bg-surface-sunken")}
      data-testid="device-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label text-text-strong truncate font-medium">{device.name}</span>
        <span className="text-caption text-text-subtle truncate">
          {asking
            ? "Unlinking cuts it off from every host now. To use it again, link it again."
            : sharedLine(device)}
          {!asking && device.notShared.length > 0 ? (
            <>
              {" · "}
              <button
                type="button"
                className="text-text-default underline-offset-2 hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={() => run(onRetry)}
              >
                Retry
              </button>
            </>
          ) : null}
        </span>
      </div>
      {asking ? (
        <>
          <Button variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            data-testid="confirm-unlink"
            onClick={() => run(onUnlink)}
          >
            Unlink {device.name}
          </Button>
        </>
      ) : (
        <>
          <span className="text-caption text-text-faint shrink-0 whitespace-nowrap">
            {lastSeenLine(device, now)}
          </span>
          <Button variant="ghost" className="w-[72px]" onClick={() => setAsking(true)}>
            Unlink
          </Button>
        </>
      )}
    </div>
  );
};
