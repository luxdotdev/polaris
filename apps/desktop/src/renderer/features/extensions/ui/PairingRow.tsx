/** A Pairing in a Host's list (Paper X1): its Grant and last use, and a two-step Revoke. */
import type { Pairing } from "@polaris/protocol";
import { Button, cn } from "@polaris/ui";
import { useState } from "react";
import type { Plain } from "../../../../shared/api.ts";
import { grantLine, usedLine } from "../model.ts";

export const PairingRow = ({
  pairing,
  now,
  onRevoke,
}: {
  readonly pairing: Plain<Pairing>;
  readonly now: number;
  readonly onRevoke: () => Promise<void>;
}) => {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className={cn("px-panel flex h-14 items-center gap-3", asking && "bg-surface-sunken")}
      data-testid="pairing-row"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label text-text-strong truncate font-medium">{pairing.name}</span>
        <span className="text-caption text-text-subtle truncate">
          {asking
            ? "Revoking disconnects it now. To use it again, pair it again."
            : grantLine(pairing.grant)}
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
            data-testid="confirm-revoke"
            onClick={() => {
              setBusy(true);
              void onRevoke().finally(() => {
                setBusy(false);
                setAsking(false);
              });
            }}
          >
            Revoke {pairing.name}
          </Button>
        </>
      ) : (
        <>
          <span className="text-caption text-text-faint shrink-0 whitespace-nowrap">
            {usedLine(pairing, now)}
          </span>
          <Button variant="ghost" className="w-[72px]" onClick={() => setAsking(true)}>
            Revoke
          </Button>
        </>
      )}
    </div>
  );
};
