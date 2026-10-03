import { describe, expect, test } from "bun:test";
import { requestDownload } from "./email-request";
import { links } from "./links";

describe("email form request", () => {
  test("posts the form once and confirms sending", async () => {
    const calls: RequestInit[] = [];

    const result = await requestDownload("ada@example.com", "", async (url, options) => {
      expect(url).toBe("/api/email");
      calls.push(options ?? {});

      return Response.json({});
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.body).toBe(JSON.stringify({ email: "ada@example.com", website: "" }));
    expect(result).toEqual({
      ok: true,
      preview: false,
      invalid: false,
      message: "Check your inbox for the Mac download.",
    });
  });

  test("development preview never claims delivery", async () => {
    expect(
      await requestDownload(
        "ada@example.com",
        "",
        async () =>
          new Response(null, {
            headers: { "X-Polaris-Email-Preview": "1" },
          })
      )
    ).toEqual({
      ok: true,
      preview: true,
      invalid: false,
      message: "Preview only. No email was sent.",
    });
  });

  test.each([400, 403, 422, 429, 503, 500])(
    "HTTP %s leaves the form retryable and hides provider errors",
    async (status) => {
      const result = await requestDownload(
        "ada@example.com",
        "",
        async () => new Response("private provider error", { status })
      );

      expect(result.ok).toBe(false);
      expect(result.message).not.toContain("private");
    }
  );

  test("connection failure leaves the form retryable", async () => {
    expect(
      (
        await requestDownload("ada@example.com", "", async () => {
          throw new Error("private");
        })
      ).ok
    ).toBe(false);
  });

  test("the primary action goes to the download route", () => {
    expect(links.download).toBe("/download/mac");
  });
});
