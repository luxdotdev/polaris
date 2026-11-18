/** Each connected Host's user access as this desktop app sees it, by Host key (`userAccess.watch`). */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { UserAccessView } from "../../../shared/userAccessContract.ts";

export const userAccess = createStore<Readonly<Record<string, UserAccessView>>>(() => ({}));

export const setUserAccess = (hostKey: string, state: UserAccessView | null) =>
  userAccess.setState((current) => {
    const { [hostKey]: _, ...rest } = current;

    return state === null ? rest : { ...rest, [hostKey]: state };
  }, true);

/** Undefined for a Host that isn't connected or whose Daemon doesn't enrol desktop apps. */
export const useUserAccess = (hostKey: string): UserAccessView | undefined =>
  useStore(userAccess, (s) => s[hostKey]);
