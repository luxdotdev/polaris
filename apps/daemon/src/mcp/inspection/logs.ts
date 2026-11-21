import { open } from "node:fs/promises";
import { join } from "node:path";
import { scrubCredentials } from "@polaris/protocol";
import { Effect } from "effect";
import { InspectionError } from "./relay.ts";

/** Seek to a bounded suffix, never load a service log in full. */
const tail = async (path: string, count: number) => {
  const file = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

  if (file === null) return "No log file yet.";

  try {
    const size = (await file.stat()).size;
    const start = Math.max(0, size - 65536);
    const buffer = Buffer.alloc(Math.min(size, 65536));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);

    if (lines.at(-1) === "") lines.pop();

    if (start > 0 && lines.length > 1) lines.shift();

    return scrubCredentials(lines.slice(-count).join("\n")).slice(-12000) || "No recent lines.";
  } finally {
    await file.close();
  }
};

export const recentDaemonLogs = (directory: string, lines: number, stream: "stdout" | "stderr") =>
  Effect.tryPromise({
    try: () =>
      tail(join(directory, stream === "stdout" ? "daemon.out.log" : "daemon.err.log"), lines),
    catch: () => new InspectionError({ message: "The Daemon log couldn't be read" }),
  });
