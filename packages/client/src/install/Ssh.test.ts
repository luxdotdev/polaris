import { describe, expect, test } from "bun:test";
import { type SpawnOptions, spawn } from "node:child_process";
import { Effect } from "effect";
import { nodeChildProcess } from "../process/index.ts";
import { runCommand } from "./Ssh.ts";

describe("runCommand", () => {
  test("hides each install command's console window on Windows", async () => {
    const seen: Array<SpawnOptions> = [];

    // SAFETY: records the options and delegates; the overload set is wider than this call.
    const recording = ((file: string, args: ReadonlyArray<string>, options: SpawnOptions) => {
      seen.push(options);

      return spawn(file, args, options);
    }) as typeof spawn;

    const result = await Effect.runPromise(
      runCommand({
        alias: "studio",
        file: "sh",
        args: ["-c", "echo ok"],
        transportFailure: null,
        processes: nodeChildProcess(recording),
      })
    );

    expect(result.stdout.trim()).toBe("ok");
    expect(seen.map((options) => options.windowsHide)).toEqual([true]);
  });
});
