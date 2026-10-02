/**
 * Hands each open request (`routes/editor.ts`) to the editor: a file opens in its tab at the
 * line, a folder shows in the explorer. Also gives vim's `:e` the ⌘P finder. Mounted once.
 */
import { useEffect } from "react";
import { type EditorOpenRequest, editorRoute } from "../../routes/editor.ts";
import { openFileFinder } from "../editor-finder/index.ts";
import { type OpenFileRequest, openFile, setFileFinder } from "../editor/index.ts";
import { revealInExplorer } from "../editor/explorer/index.ts";

export interface Delivered {
  readonly request: EditorOpenRequest | null;
  readonly error: string | null;
}

declare global {
  interface Window {
    /** For the smoke test: the last open request and what delivering it threw, if anything. */
    __polarisOpenRequests?: { readonly last: () => Delivered };
  }
}

let last: Delivered = { request: null, error: null };

/** The line and column to reveal; a column only with a line. */
const positionOf = (request: EditorOpenRequest): Pick<OpenFileRequest, "line" | "column"> => {
  if (request.line === null) return {};

  return request.column === null
    ? { line: request.line }
    : { line: request.line, column: request.column };
};

/** A file opens in its tab (queued by the editor until it starts); a folder shows in the explorer. */
const deliver = (request: EditorOpenRequest) => {
  const { hostKey, workspaceId, path } = request;

  if (request.folder) {
    revealInExplorer({ hostKey, workspaceId, path });

    return;
  }

  openFile({ hostKey, workspaceId, path, ...positionOf(request) });
};

export const EditorRequests = () => {
  useEffect(() => {
    setFileFinder(openFileFinder);
    window.__polarisOpenRequests = { last: () => last };

    return editorRoute.subscribe(({ request }, previous) => {
      if (request === null || request.seq === previous.request?.seq) return;
      last = { request, error: null };

      try {
        deliver(request);
      } catch (cause) {
        last = { request, error: String(cause) };
        throw cause;
      }
    });
  }, []);

  return null;
};
