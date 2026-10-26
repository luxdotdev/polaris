import { expect, test } from "bun:test";
import { evenHubEventFromJson } from "@evenrealities/even_hub_sdk";
import { readEvent } from "./input.ts";

// Events as the Even app sends them: protobuf leaves out zero values.
const read = (type: string, data: Record<string, number | ReadonlyArray<number> | string>) =>
  readEvent(evenHubEventFromJson({ type, jsonData: data }));

test("a tap on the first list row arrives with neither an event type nor an index", () => {
  expect(read("listEvent", { containerID: 2, containerName: "list" })).toEqual({
    kind: "click",
    index: 0,
  });
  expect(read("listEvent", { containerID: 2, currentSelectItemIndex: 3 })).toEqual({
    kind: "click",
    index: 3,
  });
});

test("taps, double-taps and long presses on a text container or the system", () => {
  expect(read("textEvent", { containerID: 1 })).toEqual({ kind: "click", index: 0 });
  expect(read("sysEvent", { eventType: 3 })).toEqual({ kind: "double-click" });
  expect(read("sysEvent", { eventType: 9 })).toEqual({ kind: "long-press" });
  expect(read("sysEvent", { eventType: 10 })).toEqual({ kind: "long-press-release" });
  expect(read("sysEvent", { eventType: 7 })).toEqual({ kind: "exited" });
});

test("an audio frame is audio, never a tap", () => {
  const event = read("audioEvent", { audioPcm: [1, 0, 2, 0] });

  expect(event?.kind).toBe("audio");
});

test("scrolling and the menu opening are not inputs", () => {
  expect(read("listEvent", { eventType: 1 })).toBeNull();
  expect(read("sysEvent", { eventType: 4 })).toBeNull();
});
