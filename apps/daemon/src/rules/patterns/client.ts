/**
 * Starts `polaris rules-scan` (`child.ts`) and reads its reply. From source
 * the child is `bun main.ts rules-scan`; in the compiled binary it is the
 * binary itself.
 */
import { childEnv } from "../../service/childEnv.ts";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { ScanReply, type ScanRequest } from "./child.ts";

/** A scan still running after this is killed: something is wrong with the input. */
export const SCAN_TIMEOUT_MS = 120_000;

const childCommand = (): ReadonlyArray<string> =>
  import.meta.path.startsWith("/$bunfs/")
    ? [process.execPath, "rules-scan"]
    : [process.execPath, fileURLToPath(new URL("../../main.ts", import.meta.url)), "rules-scan"];

const decodeReply = Schema.decodeUnknownSync(Schema.fromJsonString(ScanReply));

export const runPatternScan = async (
  request: ScanRequest,
  signal?: AbortSignal
): Promise<ScanReply> => {
  if (request.files.length === 0) return { matches: [], skipped: [] };
  const timeout = AbortSignal.timeout(SCAN_TIMEOUT_MS);

  const proc = Bun.spawn([...childCommand()], {
    env: childEnv(),
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  });

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (timeout.aborted) throw new Error(`the pattern scan took over ${SCAN_TIMEOUT_MS / 1000} s`);

  if (code !== 0) throw new Error(`the pattern scan exited ${code}: ${stderr.trim()}`);

  return decodeReply(stdout);
};
