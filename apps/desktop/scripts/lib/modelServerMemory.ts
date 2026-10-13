import { execFileSync } from "node:child_process";
import { modelServerPids } from "@polaris/client/prediction/probe";
import { Schema } from "effect";

const TreeMemory = Schema.Struct({
  label: Schema.String,
  rssMiB: Schema.Number,
  footprintMiB: Schema.NullOr(Schema.Number),
  processes: Schema.Number,
});

/** User-run model servers are measured separately from Electron and Daemon trees. */
export const modelServerMemory = async (
  appDir: string
): Promise<ReadonlyArray<typeof TreeMemory.Type>> => {
  const pids = await modelServerPids();

  if (pids.length === 0) return [];

  const output = execFileSync(
    "bun",
    [`${appDir}/scripts/lib/sampleTree.ts`, "3000", `model servers=${pids.join(",")}`],
    { encoding: "utf8" }
  );

  return output
    .trim()
    .split("\n")
    .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(TreeMemory))(line));
};
