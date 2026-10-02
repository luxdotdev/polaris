import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startServer, groupExists, withDeadline } from "./process.mjs";

const root = process.argv[2];

const workload = fileURLToPath(new URL("./stubborn-server.mjs", import.meta.url));

for (const scenario of ["success", "failure", "timeout"]) {
  const server = startServer(root, [workload]);

  server.child.stderr.on("data", (data) => process.stderr.write(data));

  try {
    await withDeadline(new Promise((resolve) => server.child.stdout.once("data", resolve)), 10000);

    if (scenario === "failure") throw new Error("Injected fixture failure");

    if (scenario === "timeout") await withDeadline(new Promise(() => {}), 50);
  } catch (error) {
    if (scenario === "success") throw error;
    assert.equal(
      error.message,
      scenario === "failure" ? "Injected fixture failure" : "Fixture deadline exceeded"
    );
  } finally {
    await server.stop(scenario);
  }

  assert.equal(groupExists(server.child.pid), false);
  assert.equal(server.child.signalCode, "SIGKILL");
}

console.log(
  "Bounded process-tree cleanup: success, injected failure and timeout; SIGTERM-resistant parent/descendant groups killed and reaped PASS"
);
