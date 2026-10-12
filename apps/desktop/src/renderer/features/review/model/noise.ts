/**
 * Files Review treats as noise: generated files (the Daemon's verdict, which adds the repo's
 * `.gitattributes` and `.polaris/review.md`; built-in patterns from older Daemons) and tests.
 */
import { isGeneratedPath, isTestPath } from "@polaris/protocol";
import type { PatchFile } from "./patch.ts";

export interface Noise {
  readonly generated: boolean;
  readonly test: boolean;
}

export const noiseOf = (file: PatchFile): Noise => {
  const generated = file.generated ?? isGeneratedPath(file.path);

  return { generated, test: !generated && isTestPath(file.path) };
};
