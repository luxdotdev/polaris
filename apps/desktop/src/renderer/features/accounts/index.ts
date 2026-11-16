/**
 * Polaris accounts in the renderer (ENG-944): the main process's `accounts` feed. Session
 * tokens stay in the main process; sharing asks it for statements and Invites.
 */
import { useEffect, useState } from "react";
import type { PolarisAccountsView } from "../../../shared/accountsContract.ts";
import { polaris } from "../bridge.ts";

/** The Accounts view, or null until the feed's first item. */
export const usePolarisAccounts = (): PolarisAccountsView | null => {
  const [view, setView] = useState<PolarisAccountsView | null>(null);

  useEffect(() => {
    const off = polaris().subscribe(
      "accounts",
      {},
      {
        items: (items) => {
          const latest = items.at(-1);

          if (latest !== undefined) setView(latest);
        },
      }
    );

    return off;
  }, []);

  return view;
};
