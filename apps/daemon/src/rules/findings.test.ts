import { describe, expect, test } from "bun:test";
import { contextOf, findingIdentity, humanise, secretFinding, secretSeverity } from "./findings.ts";
import { maskSecret } from "./secrets/mask.ts";

describe("secret Severity (ENG-230)", () => {
  test("high and medium confidence are Critical; low or unclassified are Medium", () => {
    expect(secretSeverity("high")).toBe("critical");
    expect(secretSeverity("medium")).toBe("critical");
    expect(secretSeverity("low")).toBe("medium");
    expect(secretSeverity("")).toBe("medium");
  });
});

describe("maskSecret", () => {
  test("keeps four characters and the length of a long value", () => {
    expect(maskSecret("abcdefghijklmnopqrstuvwxyz")).toBe("abcd•••• (26 characters)");
  });

  test("shows nothing of a short value", () => {
    expect(maskSecret("hunter2")).toBe("•••• (7 characters)");
  });

  test("shows only a PEM block's BEGIN line", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(maskSecret(pem)).toBe(`-----BEGIN RSA PRIVATE KEY-----… (${pem.length} characters)`);
  });
});

describe("secretFinding", () => {
  const hit = {
    ruleId: "aws-access-token",
    ruleHash: "h",
    description: "Identified an AWS access key ID.",
    confidence: "high" as const,
    fingerprint: "f".repeat(64),
    masked: "AKIA•••• (20 characters)",
    path: "deploy/aws.py",
    start: 3,
    end: 3,
  };

  test("is a Critical rule Finding that shows only the masked value", () => {
    const finding = secretFinding(hit, false);

    expect(finding).toMatchObject({
      source: "rule",
      ruleId: "aws-access-token",
      severity: "critical",
      title: "Possible secret: AWS access token",
      status: "open",
    });
    expect(finding.reason).toBe(
      "Identified an AWS access key ID. Matched AKIA•••• (20 characters)."
    );
  });

  test("the same secret in two files is two Findings; on another line it is the same one", () => {
    const here = secretFinding(hit, false);

    expect(secretFinding({ ...hit, path: "other.py" }, false).identity).not.toBe(here.identity);
    expect(secretFinding({ ...hit, start: 40, end: 40 }, false).identity).toBe(here.identity);
  });
});

describe("pattern identity", () => {
  test("ignores whitespace, not the code or its context", () => {
    const a = findingIdentity("js-eval", "a.ts", "eval( x )", "const y = 1;");
    expect(findingIdentity("js-eval", "a.ts", "eval(x)", "const  y = 1;")).not.toBe(a);
    expect(findingIdentity("js-eval", "a.ts", "eval( x )", "const   y =\n1;")).toBe(a);
    expect(findingIdentity("js-eval", "a.ts", "eval( x )", "const z = 1;")).not.toBe(a);
  });

  test("context is two lines either side of the match", () => {
    const lines = ["1", "2", "3", "4", "5", "6", "7"];
    expect(contextOf(lines, 4, 4)).toBe("2\n3\n5\n6");
    expect(contextOf(lines, 1, 2)).toBe("3\n4");
  });

  test("Betterleaks' rule ids read as names", () => {
    expect(humanise("github-pat")).toBe("GitHub PAT");
    expect(humanise("generic-credential-uri")).toBe("Generic credential URI");
  });
});
