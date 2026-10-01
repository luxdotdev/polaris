import { describe, expect, test } from "bun:test";
import { auditProblems, classifyLicense } from "./goLicenses.ts";
import { isAllowed } from "./licenses.ts";

describe("classifyLicense", () => {
  test.each([
    [
      "Permission is hereby granted, free of charge, to any person … The above copyright notice",
      "MIT",
    ],
    ["Apache License\n   Version 2.0, January 2004", "Apache-2.0"],
    ["Mozilla Public License, version 2.0", "MPL-2.0"],
    [
      "Redistributions in binary form must reproduce … Neither the name of Google Inc. nor",
      "BSD-3-Clause",
    ],
    ["Redistributions in binary form must reproduce the above copyright notice", "BSD-2-Clause"],
    ["GNU GENERAL PUBLIC LICENSE Version 3", null],
  ])("%#", (text, expected) => {
    expect(classifyLicense(text)).toBe(expected);
  });
});

describe("auditProblems", () => {
  const module = (license: string | null) => ({
    path: "example.com/m",
    version: "v1",
    license,
    text: "",
  });

  test("passes an audit of the pinned version with allowed licences", () => {
    expect(
      auditProblems({ betterleaks: "2.0.0", modules: [module("MIT")] }, "2.0.0", isAllowed)
    ).toEqual([]);
  });

  test("fails a stale audit, an unknown licence and a disallowed one", () => {
    const problems = auditProblems(
      { betterleaks: "1.9.0", modules: [module(null), module("GPL-3.0")] },
      "2.0.0",
      isAllowed
    );

    expect(problems).toHaveLength(3);
  });
});
