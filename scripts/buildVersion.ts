/**
 * The version a Daemon build carries. A release build (`--release`) is the
 * package version as it is. Every other build is a dev build:
 * `<package version>-dev.<commit count>.<short sha>`, with `.dirty<seconds>`
 * when the working tree has uncommitted changes, so two dev builds of
 * different code never share a version. Clients install a dev build over any
 * other version (`@polaris/client/install`, `upgradeDue`).
 */
export interface Commit {
  /** `git rev-list --count HEAD`. */
  readonly count: number;
  /** `git rev-parse --short=7 HEAD`. */
  readonly sha: string;
  /** Uncommitted changes in the working tree. */
  readonly dirty: boolean;
}

export const buildVersion = (
  base: string,
  options: { readonly release: boolean; readonly commit: Commit; readonly now: Date }
): string => {
  if (options.release) return base;
  const { count, sha, dirty } = options.commit;
  const stamp = dirty ? `.dirty${Math.floor(options.now.getTime() / 1000)}` : "";

  return `${base}-dev.${count}.${sha}${stamp}`;
};
