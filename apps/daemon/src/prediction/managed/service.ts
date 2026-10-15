/**
 * The managed model server as a Daemon service (ADR 0048): one `ManagedServer` per Daemon,
 * built on first use, with the default folder `~/.polaris/models`.
 */
import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { hostCanServe } from "@polaris/client/prediction/score";
import { paths } from "../../paths.ts";
import { ManagedServer } from "./server.ts";

/** The chip name `hostCanServe` checks, read synchronously so the layer builds without a probe. */
const chip = () => {
  const fallback = cpus()[0]?.model ?? process.arch;

  if (process.platform !== "linux") return fallback;

  try {
    return readFileSync("/proc/device-tree/model", "utf8").replaceAll("\0", "").trim() || fallback;
  } catch {
    return fallback;
  }
};

export class ManagedModelServer extends Context.Service<ManagedModelServer, ManagedServer>()(
  "polaris/daemon/ManagedModelServer"
) {
  /** Nothing is spawned, downloaded or timed at construction; the first RPC does the work. */
  static readonly layer = Layer.effect(
    ManagedModelServer,
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new ManagedServer({
            defaultDir: join(paths().root, "models"),
            tooSmall: !hostCanServe({
              chip: chip(),
              ramBytes: totalmem(),
              cpuCores: 1,
              gpu: null,
              gpuMemoryBytes: null,
              unifiedMemory: false,
              load: null,
            }),
          })
      ),
      (server) => Effect.sync(() => server.dispose())
    )
  );
}
