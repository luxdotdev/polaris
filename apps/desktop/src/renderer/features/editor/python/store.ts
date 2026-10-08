/**
 * The interpreters each open Python file's checkout offers, as the Host last
 * listed them. Read by the palette's follow-up and the status popover; a
 * selection replaces the entry with the Host's answer.
 */
import type * as P from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { languageIpcError } from "../../../../shared/languageError.ts";
import { polaris } from "../../bridge.ts";
import type { Interpreters } from "./model.ts";

interface PythonState {
  /** By file key (`fileKey(hostKey, path)`). */
  readonly files: Readonly<Record<string, Interpreters>>;
}

export const pythonStore = createStore<PythonState>(() => ({ files: {} }));

export interface PythonTarget {
  readonly key: string;
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly path: string;
}

const keep = (key: string, interpreters: Interpreters) =>
  pythonStore.setState((state) => ({ files: { ...state.files, [key]: interpreters } }));

const languages = () => {
  const api = polaris().languages;

  if (api === undefined) throw new Error("Language tooling isn't available on this Host");

  return api;
};

/** Asks the Host again; rejects with its `LanguageError`. */
export const refreshInterpreters = async (target: PythonTarget) => {
  const result = await languages().request("languages.python.interpreters", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
  });

  if (!result.ok) throw languageIpcError(result.error);
  keep(target.key, result.value);

  return result.value;
};

/** Sets (or, with null, clears) the Workspace's interpreter at the revision the list was read at. */
export const selectInterpreter = async (
  target: PythonTarget,
  interpreter: string | null,
  expectedRevision: number
) => {
  const result = await languages().request("languages.python.select", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
    interpreter,
    expectedRevision,
  });

  if (!result.ok) throw languageIpcError(result.error);
  keep(target.key, result.value);

  return result.value;
};

export const interpretersOf = (key: string): Interpreters | null =>
  pythonStore.getState().files[key] ?? null;

export const useInterpreters = (key: string) =>
  useStore(pythonStore, (state) => state.files[key] ?? null);
