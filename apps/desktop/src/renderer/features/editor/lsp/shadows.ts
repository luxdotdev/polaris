/**
 * Verification shadows: an unsaved sibling document that holds a prediction's edited text while
 * the language server checks it (ADR-0050). One per context at a time, and while one is open
 * every Editor request on that context waits, so no result can mention it.
 */
import type { LanguageId } from "../model/language.ts";

const held = new Map<string, Promise<void>>();

/** Resolves when the context's shadow closes; null when none is open. */
export const shadowClosed = (contextId: string): Promise<void> | null =>
  held.get(contextId) ?? null;

/** Takes the context's shadow slot once any earlier holder releases it; null on abort. */
export const holdShadow = async (
  contextId: string,
  signal: AbortSignal
): Promise<(() => void) | null> => {
  for (let busy = held.get(contextId); busy !== undefined; busy = held.get(contextId)) {
    await busy;

    if (signal.aborted) return null;
  }

  if (signal.aborted) return null;
  let release = () => {};

  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });

  held.set(contextId, closed);

  return () => {
    if (held.get(contextId) === closed) held.delete(contextId);
    release();
  };
};

let serial = 0;

/** A fresh sibling URI per check, in the same directory so imports and the project match. */
export const shadowUri = (uri: string): string | null => {
  const slash = uri.lastIndexOf("/");
  const dot = uri.lastIndexOf(".");

  if (dot <= slash + 1) return null;
  serial += 1;

  return `${uri.slice(0, dot)}.polaris-verify-${serial}${uri.slice(dot)}`;
};

const CHECKED = new Set<LanguageId>(["typescript", "tsx", "javascript", "jsx"]);

const MODULE = /^\s*(?:import[\s{*"']|export[\s{*])/m;

const AMBIENT = /^\s*declare\s+(?:global|module)\b/m;

/**
 * Only TypeScript and JavaScript modules: a script's or a declaration file's copy would share
 * its globals and add errors to the user's own file. Other languages are not measured yet.
 */
export const shadowable = (language: LanguageId, uri: string, text: string): boolean =>
  CHECKED.has(language) && !/\.d\.[cm]?ts$/.test(uri) && MODULE.test(text) && !AMBIENT.test(text);
