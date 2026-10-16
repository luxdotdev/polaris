/**
 * Test preload the watchdog adds to isolated and parallel runs, where it runs once per file:
 * marks each file's start and end, which bun's reporter doesn't, so a stall names the files still running.
 */
import { afterAll } from "bun:test";
import { relative } from "node:path";
import { PROGRESS_MARKER } from "./marker.ts";

const file = relative(process.cwd(), Bun.main);

console.error(`${PROGRESS_MARKER}start ${file}`);

afterAll(() => console.error(`${PROGRESS_MARKER}end ${file}`));
