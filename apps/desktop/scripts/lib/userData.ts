/** A fresh user-data directory whose settings start past the welcome (onboarding O1). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const seenUserData = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ welcomeSeen: true }));

  return dir;
};
