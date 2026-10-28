/**
 * The Hermes test's entry: the self-check on the bare VM, printed on one line for
 * `scripts/hermes.ts` to read. Bundled into one script; never part of the app.
 */
import "./vmHost.ts";
import { runSelfCheck } from "./selfCheck.ts";

// scripts/hermes.ts reads this marker.
void runSelfCheck().then((results) => console.log(`POLARIS_SELF_CHECK ${JSON.stringify(results)}`));
