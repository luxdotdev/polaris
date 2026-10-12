/** The Desktop App's clipboard writer: through main, since the renderer has no clipboard permission. */
import type { CopyWrite } from "@polaris/ui";
import { polaris } from "./bridge.ts";

export const writeClipboard: CopyWrite = (text) =>
  polaris()
    .request("clipboard.write", { text })
    .then((result) => result.ok);
