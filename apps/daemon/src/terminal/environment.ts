import { realpathSync } from "node:fs";
import { isWithin, resolveHostPath } from "../files/fs.ts";
import type { ReadModel } from "../store/model.ts";
import type { TerminalEnvironment } from "./Terminals.ts";

const canonical = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * A Review Checkout holds a pull request's code, so a terminal anywhere inside one (Review
 * Run, or a shell opened there) starts with the allowlisted repository environment.
 */
export const terminalEnvironment = (model: ReadModel, cwd: string): TerminalEnvironment => {
  const target = canonical(resolveHostPath(cwd));

  for (const checkout of model.reviewCheckouts.values())
    if (isWithin(canonical(resolveHostPath(checkout.path)), target)) return "repository";

  return "user";
};
