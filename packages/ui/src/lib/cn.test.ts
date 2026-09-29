import { describe, expect, test } from "bun:test";

import { cn } from "./cn";

describe("cn", () => {
  test("keeps a Polaris type size beside a Polaris text colour", () => {
    expect(cn("text-caption text-text-subtle")).toBe("text-caption text-text-subtle");
    expect(cn("text-code-inline", "text-text-default")).toBe("text-code-inline text-text-default");
  });

  test("still resolves real conflicts", () => {
    expect(cn("text-caption", "text-label")).toBe("text-label");
    expect(cn("text-text-faint", "text-text-strong")).toBe("text-text-strong");
    expect(cn("rounded-row", "rounded-control")).toBe("rounded-control");
    expect(cn("h-row", "h-7")).toBe("h-7");
  });
});
