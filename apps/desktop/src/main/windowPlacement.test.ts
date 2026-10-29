import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, type Settings, writeSettings } from "./settings.ts";
import {
  decodeWindowState,
  type DisplayArea,
  placeWindow,
  type WindowState,
} from "./windowPlacement.ts";

const laptop: DisplayArea = { id: 1, workArea: { x: 0, y: 25, width: 1512, height: 920 } };

const monitor: DisplayArea = { id: 2, workArea: { x: 1512, y: 0, width: 2560, height: 1415 } };

const sizes = { defaults: { width: 1440, height: 900 }, min: { width: 760, height: 480 } };

const centredOnLaptop = { x: 36, y: 35, width: 1440, height: 900 };

/** As start-up does: the settings' `window` value, decoded, then placed on the displays. */
const place = (settings: Settings, displays: readonly DisplayArea[] = [laptop, monitor]) =>
  placeWindow({ saved: decodeWindowState(settings.window), displays, primary: laptop, ...sizes });

const saved = (state: Partial<WindowState> = {}): WindowState => ({
  bounds: { x: 1700, y: 120, width: 1800, height: 1100 },
  displayId: monitor.id,
  maximized: false,
  fullScreen: false,
  ...state,
});

/** Through the settings file, as a restart reads it. */
const roundTrip = (window: WindowState) => {
  const path = join(mkdtempSync(join(tmpdir(), "polaris-window-")), "settings.json");

  writeSettings({ path, settings: { theme: "dark", window } });

  return readSettings(path);
};

describe("the main window's placement across restarts", () => {
  test("saved bounds on a display that's still there come back as they were", () => {
    expect(place(roundTrip(saved()))).toEqual({
      bounds: { x: 1700, y: 120, width: 1800, height: 1100 },
      maximized: false,
      fullScreen: false,
    });
  });

  test("a maximized or full-screen window is restored that way, over its normal bounds", () => {
    expect(place(roundTrip(saved({ maximized: true })))).toMatchObject({
      bounds: { x: 1700, width: 1800 },
      maximized: true,
    });
    expect(place({ window: saved({ fullScreen: true }) }).fullScreen).toBe(true);
  });

  test.each([
    ["the display it was on is gone", saved(), [laptop]],
    [
      "it lies off every display",
      saved({ bounds: { x: 9000, y: 9000, width: 1200, height: 800 } }),
      [laptop, monitor],
    ],
    [
      "less than half of it shows",
      saved({ bounds: { x: 3500, y: 100, width: 1200, height: 800 } }),
      [laptop, monitor],
    ],
  ] as const)(
    "when %s, it opens at the default size centred on the primary",
    (_, state, displays) => {
      expect(place({ window: state }, displays).bounds).toEqual(centredOnLaptop);
    }
  );

  test("a window larger than its display, or hanging off its edge, is pulled inside the work area", () => {
    const big = saved({
      displayId: laptop.id,
      bounds: { x: -200, y: 0, width: 2000, height: 700 },
    });

    const edge = saved({ bounds: { x: 3000, y: 900, width: 1200, height: 800 } });

    expect(place({ window: big }).bounds).toEqual({ x: 0, y: 25, width: 1512, height: 700 });
    expect(place({ window: edge }).bounds).toEqual({ x: 2872, y: 615, width: 1200, height: 800 });
  });

  test.each([
    ["a string", "maximized"],
    ["missing bounds", { displayId: 1, maximized: true, fullScreen: false }],
    ["a zero width", saved({ bounds: { x: 0, y: 0, width: 0, height: 800 } })],
    ["nothing saved yet", undefined],
  ])("corrupt or absent state (%s) falls back to the centred default", (_, window) => {
    expect(place({ window })).toEqual({
      bounds: centredOnLaptop,
      maximized: false,
      fullScreen: false,
    });
  });

  test("a corrupt window value resets only the window, not the other settings", () => {
    const path = join(mkdtempSync(join(tmpdir(), "polaris-window-")), "settings.json");

    writeFileSync(path, JSON.stringify({ theme: "dark", window: { bounds: "wide" } }));

    const settings = readSettings(path);

    expect(settings.theme).toBe("dark");
    expect(place(settings).bounds).toEqual(centredOnLaptop);
  });
});
