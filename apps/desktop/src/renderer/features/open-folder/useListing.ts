/** The folders in one directory on a Host, over `files.listDir`, kept while the dialog is open. */
import { useEffect, useState } from "react";
import type { FileEntry } from "@polaris/protocol";
import type { Plain } from "../../../shared/api.ts";

export type Listing =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "listed"; readonly entries: ReadonlyArray<Plain<FileEntry>> }
  | { readonly kind: "failed"; readonly message: string };

const IDLE: Listing = { kind: "idle" };

const LOADING: Listing = { kind: "loading" };

export const useListing = (hostKey: string | null, dir: string | null): Listing => {
  const [listed, setListed] = useState<ReadonlyMap<string, Listing>>(new Map());
  const key = hostKey === null || dir === null ? null : `${hostKey}\u0000${dir}`;
  const known = key !== null && listed.has(key);

  useEffect(() => {
    if (key === null || hostKey === null || dir === null || known) return;

    void window.polaris.request("files.listDir", { hostKey, path: dir }).then((result) => {
      const listing: Listing = result.ok
        ? { kind: "listed", entries: result.value }
        : { kind: "failed", message: result.error.message };

      setListed((prev) => new Map([...prev, [key, listing]]));
    });
  }, [key, hostKey, dir, known]);

  return key === null ? IDLE : (listed.get(key) ?? LOADING);
};
