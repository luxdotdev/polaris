/** The Desktop App's clipboard writer: through main, since the renderer has no clipboard permission. */
import type { CopyWrite } from "@polaris/ui";
import type { PolarisApi } from "../../shared/api.ts";
import { polaris } from "./bridge.ts";

/** The preload's bridge when there is one, so fixture previews still copy for real. */
const preload = (): PolarisApi | null => ("polaris" in window ? window.polaris : null);

export const writeClipboard: CopyWrite = (text) =>
  (preload() ?? polaris()).request("clipboard.write", { text }).then((result) => result.ok);
