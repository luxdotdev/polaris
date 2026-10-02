/**
 * Hands each open request (`routes/editor.ts`) to the editor: a file opens in its tab at the
 * line (the editor queues it until it starts), a folder shows in the explorer. Mounted once.
 */
import { useEffect } from "react";
import { type EditorOpenRequest, editorRoute } from "../../routes/editor.ts";
import { type OpenFileRequest, openFile } from "../editor/api.ts";

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
const deliver = async (request: EditorOpenRequest) => {
  const { hostKey, workspaceId, path } = request;

  if (request.folder) {
    const { revealInExplorer } = await import("../editor/explorer/index.ts");

    revealInExplorer({ hostKey, workspaceId, path });

    return;
  }

  openFile({ hostKey, workspaceId, path, ...positionOf(request) });
};

export const EditorRequests = () => {
  useEffect(() => {
    window.__polarisOpenRequests = { last: () => last };

    return editorRoute.subscribe(({ request }, previous) => {
      if (request === null || request.seq === previous.request?.seq) return;
      last = { request, error: null };
      deliver(request).catch((cause: unknown) => {
        last = { request, error: String(cause) };
        console.error("polaris: open in editor failed", cause);
      });
    });
  }, []);

  return null;
};
