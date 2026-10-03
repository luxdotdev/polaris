import { expect, test } from "bun:test";
import { INSTALL_ID_HEADER, MACOS_VERSION_HEADER, requestFields } from "./telemetry.ts";

const installId = "6a00ec60-187a-4a97-818c-0d9d18961f06";

test("allowlists event fields; drops IP, raw UA, headers, query, cookies and invalid version", () => {
  const event = requestFields(
    new Request("https://polaris.lux.dev/download/mac?email=private@example.com", {
      headers: {
        [INSTALL_ID_HEADER]: installId,
        [MACOS_VERSION_HEADER]: "26.0.1",
        "x-vercel-ip-country": "US",
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "203.0.113.10",
        "x-vercel-forwarded-for": "203.0.113.10",
        "user-agent": "Private name 203.0.113.10 (Macintosh; Mac OS X 15_6)",
        Cookie: "private=value",
        Authorization: "Bearer private",
      },
    }),
    "update_check",
    "203.0.113.10"
  );

  expect(event).toEqual({
    event: "update_check",
    version: null,
    arch: "arm64",
    macos_version: "26.0.1",
    install_id: installId,
    country: "US",
  });
  expect(JSON.stringify(event)).not.toContain("203.0.113.10");
  expect(JSON.stringify(event)).not.toContain("private");
});

test("extracts macOS version from UA without keeping UA, ignores arbitrary telemetry headers", () => {
  const event = requestFields(
    new Request("https://polaris.lux.dev/", {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) Name private@example.com",
        [INSTALL_ID_HEADER]: "private@example.com",
        [MACOS_VERSION_HEADER]: "203.0.113.10",
        "x-vercel-ip-country": "203.0.113.10",
      },
    }),
    "download",
    null
  );

  expect(event.macos_version).toBe("15.6.1");
  expect(event.install_id).toBeNull();
  expect(event.country).toBeNull();
  expect(requestFields(new Request("https://polaris.lux.dev/"), "download", null)).toMatchObject({
    macos_version: null,
    install_id: null,
    country: null,
  });
});
