import { expect, test } from "bun:test";
import { gatewayLogText } from "./log.ts";

test("gateway failure diagnostics cannot inject log lines or expose pairing credentials", () => {
  const value = gatewayLogText(
    "pol_ext_secret polaris-pair:v1:eyJ0b2tlbiI6InNlY3JldCJ9\r\n\u001b[31m\u202e" + "a".repeat(4000)
  );

  expect(value).toStartWith("[token redacted] [pairing redacted]");
  expect(value).not.toContain("secret");
  expect(value).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  expect(value.length).toBe(2048);
});
