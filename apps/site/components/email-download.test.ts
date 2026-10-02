import { describe, expect, test } from "bun:test";
import { mailtoDownload } from "./email-download";
import { links } from "./links";

describe("mailtoDownload", () => {
  test("drafts the download link to the given address", () => {
    const url = new URL(mailtoDownload("ada@example.com"));

    expect(url.protocol).toBe("mailto:");
    expect(url.pathname).toBe("ada%40example.com");
    expect(url.searchParams.get("subject")).toBe("Polaris for Mac");
    expect(url.searchParams.get("body")).toBe(
      "Download Polaris for macOS: https://polaris.lux.dev/download/mac"
    );
  });

  test("encodes an address that would otherwise break the query", () => {
    const url = mailtoDownload("a+b&subject=x@example.com");

    expect(url.startsWith("mailto:a%2Bb%26subject%3Dx%40example.com?")).toBe(true);
  });

  test("spaces are percent-encoded, not plus signs, for mail clients", () => {
    expect(mailtoDownload("a@example.com")).not.toContain("+");
  });
});

describe("links", () => {
  test("the primary action goes to the download route", () => {
    expect(links.download).toBe("/download/mac");
  });
});
