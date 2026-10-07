import { Schema } from "effect";
import { HostStateTrace, replayHostState } from "./host-state/index.ts";

const path = process.argv[2];

if (path === undefined) throw new Error("Pass the recorded Host state trace path");

const trace = Schema.decodeUnknownSync(HostStateTrace)(await Bun.file(path).json());

console.log(await replayHostState(trace));
