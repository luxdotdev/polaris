/** Durations and paths as the session view prints them (tabular, short). */

/** "12s", "1m 12s", "2h 5m". */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));

  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** A path under the Host's home directory as `~/…`. */
export const tildePath = (path: string, home: string | null): string => {
  if (home === null || home === "" || !path.startsWith(home)) return path;
  const rest = path.slice(home.length);

  return rest === "" ? "~" : rest.startsWith("/") ? `~${rest}` : path;
};

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
