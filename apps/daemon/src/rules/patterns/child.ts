/**
 * `polaris rules-scan`: the pattern scan in its own process, so ast-grep's
 * synchronous parsing never blocks the Daemon's event loop, a cancelled
 * Review can kill it, and its memory goes back when it exits. Reads one
 * request as JSON on stdin and writes one reply as JSON on stdout.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { loadAstGrep } from "./native.ts";
import { builtinPack, PACK_LANGUAGES } from "./pack.ts";
import { type PatternMatch, scanSource } from "./scan.ts";

/** Files bigger than this are generated or minified, not reviewed: skipped. */
export const MAX_FILE_BYTES = 1024 * 1024;

export const ScanRequest = Schema.Struct({
  /** Where the files are; paths below are relative to it. */
  root: Schema.String,
  files: Schema.Array(
    Schema.Struct({ path: Schema.String, language: Schema.Literals(PACK_LANGUAGES) })
  ),
});

export type ScanRequest = typeof ScanRequest.Type;

export const ScanReply = Schema.Struct({
  matches: Schema.Array(
    Schema.Struct({
      ruleId: Schema.String,
      path: Schema.String,
      start: Schema.Int,
      end: Schema.Int,
      text: Schema.String,
    })
  ),
  /** Files that could not be read or parsed, with why; the scan goes on without them. */
  skipped: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
});

export type ScanReply = typeof ScanReply.Type;

export const scanRequest = async (request: ScanRequest): Promise<ScanReply> => {
  const napi = await loadAstGrep();
  const rules = builtinPack();
  const matches: Array<PatternMatch> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  for (const file of request.files) {
    try {
      const bytes = readFileSync(join(request.root, file.path));

      if (bytes.byteLength > MAX_FILE_BYTES) {
        skipped.push({ path: file.path, reason: "larger than 1 MB" });
        continue;
      }

      matches.push(...scanSource(napi, rules, file.path, file.language, bytes.toString("utf8")));
    } catch (error) {
      skipped.push({
        path: file.path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { matches, skipped };
};

const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(ScanRequest));

/** The `rules-scan` command: exit 0 with a reply, 1 with the error on stderr. */
export const runRulesScan = async (): Promise<number> => {
  try {
    const request = decodeRequest(await Bun.stdin.text());
    await Bun.write(Bun.stdout, JSON.stringify(await scanRequest(request)));

    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return 1;
  }
};
