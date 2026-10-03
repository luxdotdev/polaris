import { expect, spyOn, test } from "bun:test";
import { ingestEvent, INSTALL_ID_HEADER, MACOS_VERSION_HEADER, requestEvent } from "./telemetry.ts";

const installId = "6a00ec60-187a-4a97-818c-0d9d18961f06";

test("allowlists event fields; drops IP, raw UA, headers, query, cookies and invalid version", () => {
  const event = requestEvent(
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
    "203.0.113.10",
    400
  );

  expect(event).toEqual({
    _time: event._time,
    event: "update_check",
    route: "/api/update/darwin-arm64/[version]",
    version: null,
    arch: "arm64",
    macos_version: "26.0.1",
    install_id: installId,
    country: "US",
    status: 400,
  });
  expect(JSON.stringify(event)).not.toContain("203.0.113.10");
  expect(JSON.stringify(event)).not.toContain("private");
});

test("extracts macOS version from UA without keeping UA, ignores arbitrary telemetry headers", () => {
  const event = requestEvent(
    new Request("https://polaris.lux.dev/", {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6_1) Name private@example.com",
        [INSTALL_ID_HEADER]: "private@example.com",
        [MACOS_VERSION_HEADER]: "203.0.113.10",
        "x-vercel-ip-country": "203.0.113.10",
      },
    }),
    "download",
    null,
    307
  );

  expect(event.macos_version).toBe("15.6.1");
  expect(event.install_id).toBeNull();
  expect(event.country).toBeNull();
  expect(
    requestEvent(new Request("https://polaris.lux.dev/"), "download", null, 307)
  ).toMatchObject({ macos_version: null, install_id: null, country: null });
});

test("one Axiom ingest sends only the sanitized event to the configured dataset", async () => {
  let calls = 0;
  const event = requestEvent(new Request("https://polaris.lux.dev/"), "update_check", "1.2.3", 204);

  const fetcher = Object.assign(
    async (url: string | URL | Request, options?: RequestInit) => {
      calls++;
      expect(url).toBe("https://api.axiom.co/v1/ingest/releases%20test");
      expect(options?.method).toBe("POST");
      expect(options?.headers).toEqual({
        Authorization: "Bearer fake-token",
        "Content-Type": "application/json",
      });
      expect(options?.body).toBe(JSON.stringify([event]));
      expect(options?.cache).toBe("no-store");

      return Response.json({ ingested: 1, failed: 0 });
    },
    { preconnect() {} }
  );

  await ingestEvent(event, { AXIOM_TOKEN: "fake-token", AXIOM_DATASET: "releases test" }, fetcher);
  expect(calls).toBe(1);
});

test("Axiom failures do not throw, retry or log response/request details", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});

  try {
    const event = requestEvent(new Request("https://polaris.lux.dev/"), "download", null, 307);

    for (const result of [
      new Response("private IP 203.0.113.10", { status: 401 }),
      Response.json({ ingested: 0, failed: 1, failures: ["private"] }),
      Response.json({ unexpected: "private" }),
    ]) {
      let calls = 0;
      await ingestEvent(
        event,
        { AXIOM_TOKEN: "fake", AXIOM_DATASET: "test" },
        Object.assign(
          async () => {
            calls++;

            return result;
          },
          { preconnect() {} }
        )
      );
      expect(calls).toBe(1);
    }

    await ingestEvent(
      event,
      { AXIOM_TOKEN: "fake", AXIOM_DATASET: "test" },
      Object.assign(
        async () => {
          throw new Error("private IP 203.0.113.10");
        },
        { preconnect() {} }
      )
    );
    expect(warning.mock.calls).toEqual(
      Array.from({ length: 4 }, () => ["Release request logging failed"])
    );
  } finally {
    warning.mockRestore();
  }
});

test("missing Axiom configuration is visible without making a network request", async () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});

  try {
    let calls = 0;
    await ingestEvent(
      requestEvent(new Request("https://polaris.lux.dev/"), "download", null, 307),
      {},
      Object.assign(
        async () => {
          calls++;
          throw new Error("must not fetch");
        },
        { preconnect() {} }
      )
    );
    expect(calls).toBe(0);
    expect(warning).toHaveBeenCalledWith("Release request logging is unconfigured");
  } finally {
    warning.mockRestore();
  }
});
