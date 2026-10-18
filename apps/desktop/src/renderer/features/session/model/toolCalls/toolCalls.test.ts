import { describe, expect, test } from "bun:test";
import { mcpSubject, serverName, toolResult, toolSearchSubject, toolWords } from "./index.ts";

describe("MCP names in words", () => {
  test.each([
    ["paper", "Paper"],
    ["claude_ai_Linear", "Linear"],
    ["claude_ai_Google_Calendar", "Google Calendar"],
    ["plugin_planetscale_planetscale", "Planetscale"],
    ["nucleo-icons", "Nucleo icons"],
    ["GitHub", "GitHub"],
  ])("server %s reads %s", (server, name) => {
    expect(serverName(server)).toBe(name);
  });

  test("tool names read as words", () => {
    expect([toolWords("write_html"), toolWords("getIssue"), toolWords("list-releases")]).toEqual([
      "write html",
      "get issue",
      "list releases",
    ]);
  });
});

describe("an MCP call's subject", () => {
  test("ids, markup and bodies of text never lead it", () => {
    const input = {
      fileId: "01M3JV1J857QNW61TGHZYR6GMZ",
      targetNodeId: "1TD3-0",
      mode: "replace",
      html: "<div layer-name='x'>",
    };

    expect(mcpSubject(input)).toBe("replace");
  });

  test("the first two readable arguments, in order", () => {
    expect(mcpSubject({ pipeline: "Polaris", stageType: "planned", limit: 10, q: "x" })).toBe(
      "Polaris · planned"
    );
    expect(mcpSubject({ description: "line one\nline two", id: "ENG-1" })).toBe("");
  });

  test("ToolSearch says how many tools it loaded", () => {
    expect(toolSearchSubject({ query: "select:a,b,c" })).toBe("3 tools");
    expect(toolSearchSubject({ query: "linear issue" })).toBe("linear issue");
  });
});

describe("a call's result", () => {
  test("MCP text content reads as its first line, with a link it carries", () => {
    const output = [
      { type: "text", text: "Created ENG-361\nhttps://linear.app/luxdev/issue/ENG-361" },
    ];

    expect(toolResult(output)).toEqual({
      text: "Created ENG-361",
      link: "https://linear.app/luxdev/issue/ENG-361",
      images: [],
    });
  });

  test("a JSON list reads as its count", () => {
    expect(toolResult('[{"a":1},{"a":2}]')?.text).toBe("2 items");
  });

  test("images come back as data URLs, from MCP's and Claude's shapes alike", () => {
    const mcp = { content: [{ type: "image", data: "AAA", mimeType: "image/png" }] };

    const claude = [
      { type: "image", source: { type: "base64", data: "BBB", media_type: "image/jpeg" } },
    ];

    expect(toolResult(mcp)?.images).toEqual(["data:image/png;base64,AAA"]);
    expect(toolResult(claude)?.images).toEqual(["data:image/jpeg;base64,BBB"]);
  });

  test("nothing returned is no result", () => {
    expect([toolResult(null), toolResult(""), toolResult([])]).toEqual([null, null, null]);
  });
});
