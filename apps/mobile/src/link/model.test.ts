import { describe, expect, test } from "bun:test";
import {
  advance,
  type LinkEvent,
  type LinkStep,
  NOT_A_LINK,
  starLight,
  startsLink,
} from "./model.ts";

const FOUND = { hostName: "mac-studio", hosts: ["mac-studio", "lucas-rpi"] };

const scan: LinkStep = { kind: "scan" };

const paste: LinkStep = { kind: "paste" };

const linking: LinkStep = { kind: "linking", ...FOUND };

const linked: LinkStep = { kind: "linked", ...FOUND };

const failed: LinkStep = { kind: "failed", message: "This link has expired." };

const showScan: LinkEvent = { kind: "show", view: "scan" };

const showPaste: LinkEvent = { kind: "show", view: "paste" };

const readLink: LinkEvent = { kind: "read", found: FOUND };

const readStray: LinkEvent = { kind: "read", found: null };

const relayLinked: LinkEvent = { kind: "linked", hosts: ["mac-studio", "lucas-rpi"] };

const refused: LinkEvent = { kind: "refused", message: "the link expired (link-expired)" };

describe("advance", () => {
  test.each<[string, LinkStep, LinkEvent, LinkStep]>([
    ["paste a link instead", scan, showPaste, paste],
    ["the Scan segment", paste, showScan, scan],
    ["a scanned link starts linking", scan, readLink, linking],
    ["a pasted link starts linking", paste, readLink, linking],
    ["a stray QR code is ignored while scanning", scan, readStray, scan],
    [
      "pasted text that isn't a link is refused",
      paste,
      readStray,
      { kind: "failed", message: NOT_A_LINK },
    ],
    ["the relay links", linking, relayLinked, linked],
    [
      "the relay refuses with its message",
      linking,
      refused,
      { kind: "failed", message: refused.message },
    ],
    ["scan again", failed, showScan, scan],
    ["paste a link instead after a failure", failed, showPaste, paste],
    ["a new link after a failure", failed, readLink, linking],
    ["the scanner firing again mid-link is ignored", linking, readLink, linking],
    ["switching views mid-link is ignored", linking, showPaste, linking],
    ["nothing moves a linked sheet back", linked, showScan, linked],
    ["a linked sheet reads nothing more", linked, readLink, linked],
    ["a late refusal can't undo a link", linked, refused, linked],
    ["an outcome with no link under way is dropped", scan, relayLinked, scan],
    ["a refusal with no link under way is dropped", paste, refused, paste],
  ])("%s", (_name, step, event, next) => {
    expect(advance(step, event)).toEqual(next);
  });

  test("the linked step names the hosts the relay linked, not only those the link named", () => {
    expect(advance(linking, { kind: "linked", hosts: ["mac-studio"] })).toEqual({
      kind: "linked",
      hostName: "mac-studio",
      hosts: ["mac-studio"],
    });
  });
});

describe("startsLink", () => {
  test("only entering linking uses the link", () => {
    expect(startsLink(scan, advance(scan, readLink))).toBe(true);
    expect(startsLink(failed, advance(failed, readLink))).toBe(true);
    expect(startsLink(linking, advance(linking, readLink))).toBe(false);
    expect(startsLink(paste, advance(paste, readStray))).toBe(false);
  });
});

describe("starLight", () => {
  test.each<[LinkStep, ReturnType<typeof starLight>]>([
    [scan, "rest"],
    [paste, "rest"],
    [linking, "twinkle"],
    [linked, "bright"],
    [failed, "dim"],
  ])("%o lights the star %s", (step, light) => {
    expect(starLight(step)).toBe(light);
  });
});
