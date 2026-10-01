/** Where "Clone on…" puts a repository and how it fetches it. Pure. */

/** `~/code/<name>`, then `~/code/<name>-2`… */
export const clonePath = (homeDir: string, name: string, attempt: number) =>
  `${homeDir.replace(/\/+$/, "")}/code/${name}${attempt <= 1 ? "" : `-${attempt}`}`;

/** Over ssh, as the Host's own git credentials expect for a Review Checkout's fetches too. */
export const cloneUrl = (codeHost: string, owner: string, name: string) =>
  `git@${codeHost}:${owner}/${name}.git`;

/** Single-quoted for `sh`. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const cloneCommand = (url: string, path: string) => {
  const parent = path.slice(0, path.lastIndexOf("/"));

  return `mkdir -p ${shellQuote(parent)} && git clone ${shellQuote(url)} ${shellQuote(path)}`;
};
