import { describe, expect, test } from "bun:test";
import { windowsDownloadArch } from "../app/api/update/_lib/windows.ts";
import { links } from "./links";
import { defaultPlatform, detectPlatform, downloadOffer, windowsNote } from "./platform";

const ua = {
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  windowsArm: "Mozilla/5.0 (Windows NT 10.0; ARM64; rv:140.0) Gecko/20100101 Firefox/140.0",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

describe("detectPlatform", () => {
  test("Mac, Linux and phones keep the macOS default", () => {
    for (const userAgent of [ua.mac, ua.linux, ua.iphone])
      expect(detectPlatform({ userAgent })).toEqual(defaultPlatform);
    expect(detectPlatform({ userAgent: ua.mac, platform: "macOS" })).toEqual(defaultPlatform);
  });

  test("Windows UA without hints leaves the arch unknown, since x64 UAs are frozen", () => {
    expect(detectPlatform({ userAgent: ua.windows })).toEqual({ os: "windows", arch: null });
  });

  test("an ARM64 UA or Client hints name the arch", () => {
    expect(detectPlatform({ userAgent: ua.windowsArm })).toEqual({ os: "windows", arch: "arm64" });
    expect(
      detectPlatform({
        userAgent: ua.windows,
        platform: "Windows",
        architecture: "arm",
        bitness: "64",
      })
    ).toEqual({ os: "windows", arch: "arm64" });
    expect(
      detectPlatform({
        userAgent: ua.windows,
        platform: "Windows",
        architecture: "x86",
        bitness: "64",
      })
    ).toEqual({ os: "windows", arch: "x64" });
    expect(
      detectPlatform({
        userAgent: ua.windows,
        platform: "Windows",
        architecture: "x86",
        bitness: "32",
      })
    ).toEqual({ os: "windows", arch: null });
  });

  test("the Client hint platform alone is enough", () => {
    expect(detectPlatform({ userAgent: "", platform: "Windows" }).os).toBe("windows");
  });
});

describe("downloadOffer", () => {
  test("macOS stays primary and links both Windows builds as experimental", () => {
    const offer = downloadOffer(defaultPlatform);

    expect(offer).toMatchObject({
      href: "/download/mac",
      label: "Download for macOS",
      experimental: false,
      note: null,
    });
    expect(offer.othersLabel).toContain("experimental");
    expect(offer.others.map((link) => link.href)).toEqual([links.windows.x64, links.windows.arm64]);
  });

  test.each([
    ["x64", "arm64"],
    ["arm64", "x64"],
  ] as const)("Windows %s offers its installer, the other arch and macOS", (arch, other) => {
    const offer = downloadOffer({ os: "windows", arch });

    expect(offer).toMatchObject({
      href: links.windows[arch],
      label: "Download for Windows",
      experimental: true,
      note: windowsNote,
    });
    expect(offer.others).toEqual([
      { label: `Windows ${other}`, href: links.windows[other] },
      { label: "macOS", href: links.download },
    ]);
  });

  test("unknown Windows arch defaults to x64 and keeps arm64 one click away", () => {
    const offer = downloadOffer({ os: "windows", arch: null });

    expect(offer.href).toBe(links.windows.x64);
    expect(offer.others[0]?.href).toBe(links.windows.arm64);
  });

  test("the Windows note names SmartScreen and remote hosts", () => {
    expect(windowsNote).toContain("SmartScreen");
    expect(windowsNote).toContain("hosts over SSH");
  });
});

test("every Windows link resolves to the arch the route serves", () => {
  const route = (href: string, headers: HeadersInit = {}) =>
    windowsDownloadArch(new Request(new URL(href, "https://polaris.lux.dev"), { headers }));

  expect(route(links.windows.x64)).toBe("x64");
  expect(route(links.windows.arm64)).toBe("arm64");
  expect(route(links.windows.detect, { "user-agent": ua.windows })).toBe("x64");
  expect(route(links.windows.detect, { "user-agent": ua.windowsArm })).toBe("arm64");
});
