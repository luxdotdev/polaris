import { CapabilityProbe, modelServerPids } from "@polaris/client/prediction/probe";
import { Effect } from "effect";
import { loadavg } from "node:os";
import {
  awaitReady,
  cleanup,
  connect,
  launchDaemon,
} from "../../../../packages/bench/src/daemon.ts";
import { modelServerMemory } from "../lib/modelServerMemory.ts";

const percentile = (samples: ReadonlyArray<number>, q: number) =>
  samples.toSorted((a, b) => a - b)[Math.floor((samples.length - 1) * q)] ?? null;

/** Real RPC round trips after hello; no inference or model-server changes. */
const localDaemon = async () => {
  const daemon = await launchDaemon({ binary: null });

  try {
    return await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* awaitReady(daemon);
          const { connection } = yield* connect(daemon, "socket", "tplace-measure");
          const capability = yield* connection.client["prediction.capability"](undefined);
          const samples: number[] = [];

          for (let i = 0; i < 30; i++) {
            const start = performance.now();
            yield* connection.client["prediction.capability"](undefined);
            samples.push(performance.now() - start);
          }

          return {
            capability,
            p50Ms: percentile(samples, 0.5),
            p90Ms: percentile(samples, 0.9),
            samples,
          };
        })
      )
    );
  } finally {
    await daemon.stop();
    cleanup(daemon.home);
  }
};

/** An established SSH byte channel isolates the overhead for prompt-sized payloads. */
const sshOverhead = async () => {
  const child = Bun.spawn(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UpdateHostKeys=no",
      "-o",
      "ControlMaster=no",
      "-o",
      "ControlPath=none",
      "-o",
      "ConnectTimeout=10",
      "lucas-rpi",
      "cat",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" }
  );

  const reader = child.stdout.getReader();
  let buffered = "";

  const roundTrip = async (size: number) => {
    const payload = `${"p".repeat(size)}\n`;
    const start = performance.now();
    await child.stdin.write(payload);
    await child.stdin.flush();

    while (buffered.length < payload.length) {
      const next = await reader.read();

      if (next.done) throw new Error(`SSH ended: ${await new Response(child.stderr).text()}`);
      buffered += new TextDecoder().decode(next.value);
    }

    buffered = buffered.slice(payload.length);

    return performance.now() - start;
  };

  try {
    await roundTrip(16);
    const measurements = [];

    for (const bytes of [200, 8000, 32000]) {
      const samples = [];

      for (let i = 0; i < 30; i++) samples.push(await roundTrip(bytes));
      measurements.push({
        bytes,
        p50Ms: percentile(samples, 0.5),
        p90Ms: percentile(samples, 0.9),
        samples,
      });
    }

    return measurements;
  } finally {
    await child.stdin.end();
    child.kill();
    await child.exited;
  }
};

const report = {
  measuredAt: new Date().toISOString(),
  loadAverage: loadavg(),
  client: await new CapabilityProbe().get(),
  modelServerPids: await modelServerPids(),
  modelServers: await modelServerMemory(new URL("../..", import.meta.url).pathname),
  macDaemon: await localDaemon(),
  sshByteChannel: await sshOverhead(),
  inference:
    "Not measured; shared server left unchanged. SSH byte echo is transport overhead only.",
};

console.log(JSON.stringify(report, null, 2));
