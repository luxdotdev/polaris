/** The rail's git facts for a session's cwd: `git.status`, again on each burst of file changes. */
import { useEffect, useState } from "react";
import { polaris } from "../../bridge.ts";

export type GitFacts =
  | { readonly kind: "loading" }
  | { readonly kind: "none"; readonly message: string }
  | { readonly kind: "ready"; readonly branch: string | null; readonly changed: number };

export const useGitFacts = (hostKey: string, cwd: string | null, tick: number): GitFacts => {
  const [facts, setFacts] = useState<{ key: string; value: GitFacts } | null>(null);
  const key = `${hostKey}\u0000${cwd ?? ""}`;

  useEffect(() => {
    if (cwd === null) return undefined;
    let live = true;

    void polaris()
      .request("git.status", { hostKey, cwd })
      .then((result) => {
        if (!live) return;

        const value: GitFacts = result.ok
          ? { kind: "ready", branch: result.value.branch, changed: result.value.entries.length }
          : { kind: "none", message: result.error.message };

        setFacts({ key, value });
      });

    return () => {
      live = false;
    };
  }, [hostKey, cwd, key, tick]);

  return facts?.key === key ? facts.value : { kind: "loading" };
};
