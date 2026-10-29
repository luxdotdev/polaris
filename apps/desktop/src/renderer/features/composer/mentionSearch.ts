/**
 * The `@` picker's search: the Host's file index under the session's directory
 * (`files.searchPaths`, as ⌘P uses), so a remote Host's files come through its
 * Daemon and `.gitignore` holds as it does there.
 */
import { useMemo } from "react";
import { spelledAs } from "../../routes/editor.ts";
import { relativeTo } from "../editor-finder/model.ts";
import { polaris } from "../bridge.ts";
import { MENTION_LIMIT, type MentionSearch } from "./model/mentions.ts";

/** Searches `root` on the Host; null where it has no file search or no directory yet. */
export const useMentionSearch = (
  hostKey: string,
  root: string | null,
  enabled: boolean
): MentionSearch | null =>
  useMemo(() => {
    if (!enabled || root === null) return null;

    return async (query: string) => {
      const result = await polaris().request("files.searchPaths", {
        hostKey,
        root,
        query,
        limit: MENTION_LIMIT,
      });

      return result.ok
        ? {
            paths: result.value.map((hit) => relativeTo(root, spelledAs(root, hit.path))),
            failed: null,
          }
        : { paths: [], failed: result.error.message };
    };
  }, [hostKey, root, enabled]);
