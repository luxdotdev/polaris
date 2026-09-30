import { describe, expect, test } from "bun:test";
import { parseSshHosts, readSshHosts } from "./sshHosts.ts";

describe("parseSshHosts", () => {
  test("literal aliases in file order, each once", () => {
    const config = [
      "# machines",
      "Host studio pi",
      "  HostName 10.0.0.2",
      "host=devbox",
      'HOST "quoted"',
      "Host studio",
      "Match host other",
    ].join("\n");

    expect(parseSshHosts(config)).toEqual(["studio", "pi", "devbox", "quoted"]);
  });

  test("patterns, negations and comments are skipped", () => {
    expect(parseSshHosts("Host * !bastion web-? # trailing\nHost real # note")).toEqual(["real"]);
  });

  test("a missing file finds nothing", () => {
    expect(readSshHosts("/nonexistent/polaris/ssh-config")).toEqual([]);
  });
});
