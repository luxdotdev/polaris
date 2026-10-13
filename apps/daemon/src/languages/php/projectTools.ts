import { join } from "node:path";
import { existing } from "../discovery/files.ts";

const phpTools = [
  [[".phpactor.json", ".phpactor.yml"], "a Phpactor config"],
  [["vendor/autoload.php"], "a Composer autoloader"],
  [["vendor/bin/php-cs-fixer"], "php-cs-fixer"],
] as const;

/** What Trust would run, for the Trust ask; reads only, inside the checkout. */
export async function workspaceTools(
  checkout: string,
  projectRoot: string,
  provider: string
): Promise<string[]> {
  if (provider === "go") return ["Go packages that gopls loads with go list"];

  if (provider !== "php") return [];
  const found: string[] = [];

  for (const [paths, label] of phpTools)
    for (const path of paths)
      if ((await existing(checkout, join(projectRoot, path))) !== null) {
        found.push(label);
        break;
      }

  return found;
}
