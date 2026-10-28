/** The bundle entry for the shim test: the relay checks, then how often the native side ran. */
import { nativeCalls } from "./nativeOnBun.testing.ts";
import { runNoiseChecks } from "./noiseCheck.ts";

const results = await runNoiseChecks();

console.log(JSON.stringify({ results, nativeCalls: nativeCalls() }));
