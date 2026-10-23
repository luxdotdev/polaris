// Portions adapted from raycast/extensions@3048c09 zed-recent-projects/src/hooks/use-pinned-entries.ts (MIT)
/** Pinned Agent Sessions, by `sessionKey`, kept by Raycast for this extension only. */
import { useCachedState } from "@raycast/utils";

export const usePins = () => {
  const [keys, setKeys] = useCachedState<ReadonlyArray<string>>("pinned-sessions", []);

  return {
    pinned: new Set(keys),
    pin: (key: string) => setKeys((current) => [key, ...current.filter((k) => k !== key)]),
    unpin: (key: string) => setKeys((current) => current.filter((k) => k !== key)),
  };
};
