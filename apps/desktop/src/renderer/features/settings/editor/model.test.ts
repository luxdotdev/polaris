import { describe, expect, test } from "bun:test";
import { catalog, facts } from "./fixture.testing.ts";
import { languageRows, rowEnabled, syntaxOnly, syntaxOnlyLine } from "./model.ts";
import { rowCount } from "./rowKey.ts";

const rows = (download = true) =>
  languageRows(catalog, facts(), { host: "this Mac", downloadAutomatically: download });

const row = (id: string, download = true) => {
  const found = rows(download).find((r) => r.id === id);

  if (found === undefined) throw new Error(`no row ${id}`);

  return found;
};

describe("languageRows", () => {
  test("each offered language has a row even with a shared server", () => {
    expect(rows().map((r) => r.name)).toEqual([
      "TypeScript and JavaScript",
      "HTML",
      "CSS",
      "Python",
      "Rust",
      "Go",
    ]);
  });

  test("the smoke's row count from the catalog matches the rows", () => {
    expect(rowCount(catalog.integrations)).toBe(rows().length);
  });

  test("states read as the mockup's caption lines", () => {
    expect(row("typescript-language-server").state).toBe(
      "Ready · uses each project's TypeScript once you trust it"
    );
    expect(row("html").state).toBe(
      "Not downloaded yet · vscode-langservers-extracted arrives with your first .html file"
    );
    expect(row("html", false).state).toBe("Not downloaded yet · downloading is off");
    expect(row("pyright").state).toBe("Setting up · downloading pyright");
    expect(row("rust-analyzer").state).toBe("Needs cargo on this Mac");
    expect(row("gopls").state).toBe("Couldn't download gopls");
  });

  test("an open row's parts come only from the host's facts", () => {
    expect(row("typescript-language-server").facts).toEqual([
      { label: "Language server", value: "typescript-language-server 6.0.1", mono: true },
      {
        label: "Bundled TypeScript",
        value: "6.0.3",
        mono: true,
        note: "for workspaces you haven't trusted",
      },
      { label: "Runs on", value: "node 24.18.0", mono: true, note: "Polaris's own" },
      {
        label: "Formatter",
        value: "prettier",
        mono: true,
        note: "pinned by Polaris, using the project's config",
      },
    ]);
    expect(row("pyright").facts.map((f) => f.label)).toEqual([
      "Language server",
      "Linter",
      "Runs on",
      "Formatter",
    ]);
  });

  test("rows map document languages to the editor's syntax ids", () => {
    expect(row("typescript-language-server").syntaxIds).toEqual([
      "typescript",
      "tsx",
      "javascript",
      "jsx",
    ]);
  });
});

describe("the release gate", () => {
  test("only offered integrations get rows; the rest join the foot line", () => {
    expect(rows().some((r) => r.name === "Lua")).toBe(false);
    expect(syntaxOnly(catalog)).toContain("Lua");
  });
});

describe("switches", () => {
  test("off only when every language of the row has an explicit empty provider list", () => {
    const ts = row("typescript-language-server");

    expect(rowEnabled(ts, {})).toBe(true);
    expect(rowEnabled(ts, { typescript: { providers: [] } })).toBe(true);
    expect(
      rowEnabled(ts, {
        typescript: { providers: [] },
        tsx: { providers: [] },
        javascript: { providers: [] },
        jsx: { providers: [] },
      })
    ).toBe(false);
  });
});

describe("the syntax-only foot line", () => {
  test("names the most-used languages without a server first", () => {
    const names = syntaxOnly(catalog);

    expect(names.slice(0, 3)).toEqual(["Java", "C#", "C"]);
    expect(names).not.toContain("Markdown");
    expect(names).not.toContain("TypeScript");
    expect(syntaxOnlyLine(names)).toBe(
      "Java, C#, C, C++ and others highlight their syntax, with no language server yet."
    );
    expect(syntaxOnlyLine(["Go", "SQL"])).toBe(
      "Go and SQL highlight their syntax, with no language server yet."
    );
  });
});
