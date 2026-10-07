import type { LanguageIdentityLookup } from "./lifecycle.ts";
import type { EditorLanguageSession } from "./sessions.ts";

type Groups = Map<string, EditorLanguageSession>;

/** Retained contexts belong to one independently authenticated connection lifetime. */
export const pruneLanguageGroups = (groups: Groups, lookup?: LanguageIdentityLookup) => {
  for (const [key, group] of groups) {
    const identity = lookup?.(group.hostKey);

    const changed =
      lookup !== undefined &&
      (identity == null ||
        identity.hostId !== group.hostId ||
        identity.clientId !== group.acquisition.clientId ||
        identity.connectionEpoch !== group.connectionEpoch);

    if (!group.isDisposed() && !changed) continue;
    group.dispose();
    groups.delete(key);
  }
};

/** Reclaim unused interests on demand; the Daemon remains responsible for process idle grace. */
export const admitLanguageGroup = (groups: Groups) => {
  pruneLanguageGroups(groups);

  if (groups.size < 128) return;
  const idle = [...groups].find(([, value]) => !value.hasBuffers());

  if (idle !== undefined) {
    idle[1].dispose();
    groups.delete(idle[0]);
  }

  if (groups.size >= 128) throw new Error("Too many language contexts.");
};
