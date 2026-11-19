/**
 * Whether Output is open, per Agent Session, kept across restarts. `toggled`
 * marks a session whose user opened or closed it themselves; `opened`, one
 * Output has opened in once. Either way an edit no longer opens it.
 */

export interface OutputMemory {
  readonly open: boolean;
  readonly toggled: boolean;
  readonly opened: boolean;
}

export type Memories = Readonly<Record<string, OutputMemory>>;

/** An entry as stored before `opened` (0.10 and older): open then means it opened. */
export interface StoredMemory {
  readonly open: boolean;
  readonly toggled: boolean;
  readonly opened?: boolean | undefined;
}

/** Sessions remembered; the least recently changed go first. */
export const REMEMBERED = 500;

export const CLOSED: OutputMemory = { open: false, toggled: false, opened: false };

/** Stored entries in today's shape, the users' toggles kept. */
export const migrate = (stored: Readonly<Record<string, StoredMemory>>): Memories =>
  Object.fromEntries(
    Object.entries(stored).map(([key, { open, toggled, opened }]) => [
      key,
      { open, toggled, opened: opened ?? (open || toggled) },
    ])
  );

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
  remember(memories, key, {
    open,
    toggled: true,
    opened: open || (memories[key]?.opened ?? false),
  });

/** An edit (or a Lead's Constellation tab): opens Output once per session, unless the user chose. */
export const editOpens = (memories: Memories, key: string): Memories => {
  const entry = memories[key] ?? CLOSED;

  return entry.toggled || entry.opened
    ? memories
    : remember(memories, key, { open: true, toggled: false, opened: true });
};
