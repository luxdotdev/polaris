/**
 * Hands each open request (`routes/editor.ts`) to the editor: a file opens in its tab at the
 * line, a folder shows in the explorer. Also gives vim's `:e` the ⌘P finder. Mounted once.
 */
import { useEffect } from "react";
import { type EditorOpenRequest, editorRoute } from "../../routes/editor.ts";
import { openFileFinder } from "../editor-finder/index.ts";
import { type OpenFileRequest, openFile, setFileFinder } from "../editor/index.ts";
import { revealInExplorer } from "../editor/explorer/index.ts";

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

    return editorRoute.subscribe(({ request }, previous) => {
      if (request !== null && request.seq !== previous.request?.seq) deliver(request);
    });
  }, []);

  return null;
};
