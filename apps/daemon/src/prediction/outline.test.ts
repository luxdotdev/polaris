import { expect, test } from "bun:test";
import { parseOutline } from "./outline.ts";

test("multiline imports and exported signatures omit implementations and private declarations", async () => {
  const outline = await parseOutline(
    "module.ts",
    `
// import from "./fake"
const hidden = 123;
import {
  example
} from "./real.js";
export function run(input: string): number { return 42; }
export const format = (input: string): string => { return 'secret'; };
export interface Shape { value: string }
export class Example {
  static { throw new Error('secret static implementation'); }
  private hidden(): void { return; }
  #hiddenField = 'secret field';
  protected hiddenProtected = 1;
  method(value: number): string { return 'private'; }
}
export const token: string = 'secret-token';
`
  );

  expect(outline.imports).toEqual(["./real.js"]);
  const text = outline.signatures.join("\n");
  expect(text).toContain("run(input: string): number");
  expect(text).toContain("Shape { value: string }");
  expect(text).toContain("method(value: number): string");
  expect(text).not.toMatch(/hidden|secret|return|42/);
});

test("non-code and oversized files do not initialize a parse", async () => {
  expect(await parseOutline("env", "export SECRET=hi")).toEqual({ imports: [], signatures: [] });
  expect(await parseOutline("huge.ts", "x".repeat(131073))).toEqual({
    imports: [],
    signatures: [],
  });
});
