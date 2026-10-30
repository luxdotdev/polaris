import { describe, expect, test } from "bun:test";
import { createPlaces, type Place } from "./places.ts";

const at = (path: string, line = 1): Place => ({
  hostKey: "local",
  workspaceId: "w",
  path,
  line,
  column: 1,
});

/** An editor with one active file, switching as the Editor's store would. */
const setup = () => {
  let active: Place | null = null;

  const places = createPlaces({
    here: () => active,
    open: (place) => show(place),
  });

  const show = (place: Place) => {
    const from = active;

    active = place;

    if (from === null || from.path !== place.path) places.switched(from, place);
  };

  return { places, show, here: () => active };
};

describe("Edit's places", () => {
  test("back and forward move through the files switched between, to where the cursor was", () => {
    const { places, show, here } = setup();

    show(at("/a.ts", 12));
    show(at("/b.ts"));
    show(at("/c.ts"));
    places.back();
    places.back();
    expect(here()).toEqual(at("/a.ts", 12));
    expect(places.canGoBack()).toBe(false);
    places.forward();
    places.forward();
    expect(here()?.path).toBe("/c.ts");
    expect(places.canGoForward()).toBe(false);
  });

  test("a jump within a file is a place too, and a jump to another file isn't counted twice", () => {
    const { places, show, here } = setup();

    show(at("/a.ts", 3));
    places.leave(at("/a.ts", 3));
    show(at("/a.ts", 40));
    places.leave(at("/a.ts", 40));
    show(at("/b.ts", 9));
    places.back();
    expect(here()).toEqual(at("/a.ts", 40));
    places.back();
    expect(here()).toEqual(at("/a.ts", 3));
    expect(places.canGoBack()).toBe(false);
  });

  test("a new file after going back drops the places ahead", () => {
    const { places, show } = setup();

    show(at("/a.ts"));
    show(at("/b.ts"));
    places.back();
    show(at("/c.ts"));
    expect(places.canGoForward()).toBe(false);
  });
});
