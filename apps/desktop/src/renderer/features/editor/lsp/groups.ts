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

const FNV_OFFSET = 0x6c62272e07bb014262b821756295c58dn;

const FNV_PRIME = 0x0000000001000000000000000000013bn;

const MASK = (1n << 128n) - 1n;

/**
 * A group's context id, the same in every page load (FNV-1a, 128 bits): after a reload
 * the Daemon hands back the context it still keeps for this client, under the id asked for.
 */
export const contextIdOf = (groupKey: string) => {
  let hash = FNV_OFFSET;

  for (let i = 0; i < groupKey.length; i++)
    hash = ((hash ^ BigInt(groupKey.charCodeAt(i))) * FNV_PRIME) & MASK;

  return `editor-${hash.toString(16).padStart(32, "0")}`;
};
