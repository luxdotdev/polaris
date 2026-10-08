/**
 * The dialect each open SQL file runs under, as the Host last said. Read by the
 * palette's follow-up and the status popover; a selection replaces the entry
 * with the Host's answer.
 */
import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { languageIpcError } from "../../../../shared/languageError.ts";
import { polaris } from "../../bridge.ts";
import type { Dialect, DialectState } from "./model.ts";

interface SqlState {
  /** By file key (`fileKey(hostKey, path)`). */
  readonly files: Readonly<Record<string, DialectState>>;
}

export const sqlStore = createStore<SqlState>(() => ({ files: {} }));

export interface SqlTarget {
  readonly key: string;
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly path: string;
}

const keep = (key: string, state: DialectState) =>
  sqlStore.setState((current) => ({ files: { ...current.files, [key]: state } }));

const languages = () => {
  const api = polaris().languages;

  if (api === undefined) throw new Error("Language tooling isn't available on this Host");

  return api;
};

/** Asks the Host again; rejects with its `LanguageError`. */
export const refreshDialect = async (target: SqlTarget) => {
  const result = await languages().request("languages.sql.dialect.get", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
  });

  if (!result.ok) throw languageIpcError(result.error);
  keep(target.key, result.value);

  return result.value;
};

/** Sets (or, with null, clears) this file's dialect at the revision it was read at. */
export const selectDialect = async (
  target: SqlTarget,
  dialect: Dialect | null,
  expectedRevision: number
) => {
  const result = await languages().request("languages.sql.dialect.select", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
    scope: "file",
    dialect,
    expectedRevision,
  });

  if (!result.ok) throw languageIpcError(result.error);
  keep(target.key, result.value);

  return result.value;
};

export const dialectOf = (key: string): DialectState | null =>
  sqlStore.getState().files[key] ?? null;

export const useDialect = (key: string) => useStore(sqlStore, (state) => state.files[key] ?? null);
