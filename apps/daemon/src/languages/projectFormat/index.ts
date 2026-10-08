import { basename, dirname, join } from "node:path";
import {
  LanguageProjectFormatOutcome,
  type LanguageProjectFormatInput,
  type LanguageProjectFormatter,
} from "@polaris/protocol";
import { checkoutPath, type CanonicalCheckout } from "../trust/index.ts";
import { detectProjectFormatter, formatterBinary } from "./detect.ts";
import { runProjectFormatter } from "./run.ts";

export { detectProjectFormatter, formatterBinary, PROJECT_FORMATTERS } from "./detect.ts";

export { ignoreMatcher } from "./ignore.ts";

export { runProjectFormatter } from "./run.ts";

/** A file being saved may not exist yet; its directory must, inside the checkout. */
export const formatPath = async (checkout: CanonicalCheckout, path: string) => {
  try {
    return await checkoutPath(checkout, path);
  } catch {
    return join(await checkoutPath(checkout, dirname(path)), basename(path));
  }
};

/** Detection for discovery: reads files only, so it needs no Trust. */
export const discoverProjectFormatter = async (
  checkout: CanonicalCheckout,
  path: string
): Promise<LanguageProjectFormatter | null> => {
  try {
    return await detectProjectFormatter(checkout.root, await formatPath(checkout, path));
  } catch {
    return null;
  }
};

/** Runs Workspace code: call only inside the Trust-gated `execute()`. */
export async function formatWithProject(
  checkout: CanonicalCheckout,
  input: LanguageProjectFormatInput,
  signal: AbortSignal
): Promise<LanguageProjectFormatOutcome> {
  const { requestId, version } = input;
  const file = await formatPath(checkout, input.path);
  const found = await detectProjectFormatter(checkout.root, file);
  const Outcome = LanguageProjectFormatOutcome.cases;

  if (found === null) return Outcome.Skipped.make({ requestId, version, reason: "no-formatter" });

  if (found.ignored) return Outcome.Skipped.make({ requestId, version, reason: "ignored" });

  const executable = await formatterBinary(checkout.root, found.root, found.tool);

  if (executable === null)
    return Outcome.Failed.make({
      requestId,
      reason: "not-installed",
      message: `${found.tool} isn't installed in this checkout's node_modules`,
    });

  const result = await runProjectFormatter(
    {
      tool: found.tool,
      executable,
      cwd: found.root,
      file,
      text: input.text,
      timeoutMs: Math.max(0, Math.min(input.deadline - Date.now(), 10_000)),
    },
    signal
  );

  return result.ok
    ? Outcome.Formatted.make({ requestId, version, tool: found.tool, text: result.text })
    : Outcome.Failed.make({ requestId, reason: result.reason, message: result.message });
}
