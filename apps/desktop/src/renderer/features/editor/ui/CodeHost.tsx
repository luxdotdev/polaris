/**
 * Where the active file's CodeMirror view lives. Views outlive their tab
 * being hidden (vim marks, scroll, plugins), so switching tabs moves views
 * in and out of this one element rather than rebuilding them.
 */
import { useEffect, useRef } from "react";
import { forwardShellChords } from "../cm/keys.ts";
import { attachView, detachView } from "../runtime/buffers.ts";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

export interface CodeHostProps {
  /** The active file's key; null for none. */
  readonly bufferKey: string | null;
  /** Re-runs the attach once the file has loaded. */
  readonly ready: boolean;
  /** Take focus when the file shows (a tab click, an open from elsewhere). */
  readonly focus: boolean;
}

export const CodeHost = ({ bufferKey, ready, focus }: CodeHostProps) => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = host.current;

    return parent === null ? undefined : forwardShellChords(parent, mac);
  }, []);

  useEffect(() => {
    const parent = host.current;

    if (parent === null || bufferKey === null || !ready) return undefined;

    if (attachView(bufferKey, parent) && focus) {
      parent.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true });
    }

    return () => detachView(bufferKey);
  }, [bufferKey, ready, focus]);

  return (
    <div
      ref={host}
      data-testid="editor-code"
      className="min-h-0 flex-1 overflow-hidden [&>.cm-editor]:h-full"
    />
  );
};
