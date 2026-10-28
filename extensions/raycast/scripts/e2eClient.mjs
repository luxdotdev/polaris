/**
 * Drives the SDK as the built extension loads it: from the `node_modules` that
 * `ray build` shared into its output, under Node. scripts/e2e.ts runs it (ENG-477).
 *
 *   PAIRING=… WORKSPACE_ID=… POLARIS_HOME=… node scripts/e2eClient.mjs <out dir>
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(join(resolve(process.argv[2] ?? "dist"), "index.js"));

const { createPolaris } = require("@polaris/sdk");

const { PAIRING, WORKSPACE_ID } = process.env;

/** A bench Harness Turn: one item, behind an approval, no pacing. */
const APPROVAL_PROMPT = 'bench:{"items":1,"approvalEvery":1,"deltaIntervalMs":0}';

const until = async (feed, done, what) => {
  const timer = setTimeout(() => {
    console.error(`timed out waiting for ${what}`);
    process.exit(1);
  }, 30_000);

  for await (const view of feed)
    if (done(view)) {
      clearTimeout(timer);

      return view;
    }

  throw new Error(`the feed ended before ${what}`);
};

const polaris = await createPolaris({ pairings: [PAIRING], clientName: "Raycast E2E" });

const { hostId } = polaris.hosts[0];

await until(
  polaris.subscribeHost(hostId),
  (view) => view.workspaces.some((w) => w.id === WORKSPACE_ID),
  "the workspace"
);

const sessionId = await polaris.startSession(hostId, {
  workspaceId: WORKSPACE_ID,
  harness: "claude",
  prompt: APPROVAL_PROMPT,
});

const asking = await until(
  polaris.subscribeHost(hostId),
  (view) => view.approvals.some((a) => a.sessionId === sessionId),
  "the approval"
);

const approval = asking.approvals.find((a) => a.sessionId === sessionId);

await polaris.respondToApproval(hostId, sessionId, approval.id, { kind: "allow" });

await until(
  polaris.subscribeHost(hostId),
  (view) => !view.approvals.some((a) => a.sessionId === sessionId),
  "the approval to clear"
);

await polaris.close();

console.log("paired, saw the workspace, started a session and allowed its approval");
