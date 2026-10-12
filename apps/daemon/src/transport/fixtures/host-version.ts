import { Effect } from "effect";
import { paths } from "../../paths.ts";
import { versionLine } from "../../service/platform.ts";
import { loadHostInfo } from "../hostInfo.ts";

const host = await Effect.runPromise(loadHostInfo(paths().root));

console.log(JSON.stringify({ daemonVersion: host.daemonVersion, cli: versionLine() }));
