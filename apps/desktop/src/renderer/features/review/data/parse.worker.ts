/** Parses a large patch off the main thread (ENG-218: about 770 ms for 50 MB in Electron). */
import { type ParseRequest, parseFiles } from "./parseFiles.ts";

self.addEventListener("message", (event: MessageEvent<ParseRequest & { readonly id: number }>) => {
  const { id, ...request } = event.data;

  self.postMessage({ id, files: parseFiles(request) });
});
