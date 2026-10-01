/**
 * Whether Output is open, per Agent Session, kept across restarts. `toggled`
 * marks a session whose user opened or closed it themselves: from then on
 * their choice holds and a Turn's first edit no longer opens it.
 */

export interface OutputMemory {
  readonly open: boolean;
  readonly toggled: boolean;
}

export type Memories = Readonly<Record<string, OutputMemory>>;

/** Sessions remembered; the least recently changed go first. */
export const REMEMBERED = 500;

export const CLOSED: OutputMemory = { open: false, toggled: false };

/** `key` set to `entry`, moved to the newest end, the oldest dropped past `limit`. */
export const remember = (
  memories: Memories,
  key: string,
  entry: OutputMemory,
  limit = REMEMBERED
): Memories => {
  const rest = Object.entries(memories).filter(([k]) => k !== key);

  return Object.fromEntries([...rest.slice(Math.max(0, rest.length - limit + 1)), [key, entry]]);
};

/** The user's own toggle. */
export const toggled = (memories: Memories, key: string, open: boolean): Memories =>
  remember(memories, key, { open, toggled: true });

/** A Turn's first edit: opens Output unless the user has chosen for this session. */
export const editOpens = (memories: Memories, key: string): Memories => {
  const entry = memories[key] ?? CLOSED;

  return entry.toggled || entry.open
    ? memories
    : remember(memories, key, { open: true, toggled: false });
};
