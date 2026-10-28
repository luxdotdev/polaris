import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { shortTemp } from "../platform/testing.ts";
import { readSetting, writeSetting } from "./settings.ts";

const root = mkdtempSync(shortTemp("pl-rset-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

// RX1-10: a route saved with ws:// to another machine is never dialled again.
test.each([
  ["ws://relay.example/v1", false],
  ["ws://127.0.0.1:7600/v1", true],
  ["wss://relay.example/v1", true],
])("a saved route to %s stays on: %p", (url, on) => {
  writeSetting(root, { enabled: true, url });

  expect(readSetting(root)).toEqual({ enabled: on, url });
});
