import { describe, expect, test } from "bun:test";
import { buildHome } from "../home/model/home.ts";
import { widgetPublisher } from "./publish.ts";
import { widgetSnapshot } from "./snapshot.ts";

const fakeStore = () => {
  const written: Array<string> = [];
  let reloads = 0;

  return {
    written,
    reloads: () => reloads,
    store: { write: (json: string) => written.push(json), reload: () => (reloads += 1) },
  };
};

describe("the widget publisher", () => {
  const empty = widgetSnapshot(buildHome([], null), 0);

  test("writes the snapshot the extension decodes, then reloads the timelines", () => {
    const fake = fakeStore();

    widgetPublisher(fake.store, () => 1_000).publish(empty);

    expect(fake.written).toEqual([JSON.stringify({ ...empty, writtenAt: 1_000 })]);
    expect(fake.reloads()).toBe(1);
  });

  test("an unchanged snapshot spends no reload", () => {
    const fake = fakeStore();
    let clock = 0;
    const publisher = widgetPublisher(fake.store, () => (clock += 1));

    publisher.publish(empty);
    publisher.publish({ ...empty });
    publisher.publish({ ...empty, needsYou: 1 });

    expect(fake.written).toHaveLength(2);
    expect(fake.reloads()).toBe(2);
  });
});
