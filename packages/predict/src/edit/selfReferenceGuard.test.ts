import { expect, test } from "bun:test";
import { readsOwnDeclaration } from "./selfReferenceGuard.ts";

const before = "const headers = request.headers;";

test.each([
  ["a call", "const rateLimit = rateLimit(headers);"],
  ["a destructured binding", "const { uuid, message } = yield* send(text, uuid);"],
  ["an array binding", "const [first] = first.split(',');"],
])("a new declaration reading itself through %s is caught", (_, line) => {
  expect(readsOwnDeclaration(before, `${before}\n${line}`)).toBe(true);
});

test.each([
  ["a member of the same name", "const status = response.status;"],
  ["an object key", "const limit = { limit: 3 };"],
  ["a string", 'const name = "name";'],
  ["a closure body", "const retry = () => retry();"],
  ["a renamed destructure", "const { value: total } = value;"],
])("%s does not read the binding", (_, line) => {
  expect(readsOwnDeclaration(before, `${before}\n${line}`)).toBe(false);
});

test("a malformed pattern is not mistaken for a binding", () => {
  expect(readsOwnDeclaration(before, `${before}\nconst { a(, [b } = a(b);`)).toBe(false);
});

test("an existing self-reading line is the user's, not the prediction's", () => {
  const buffer = "let count = count + 1;";

  expect(readsOwnDeclaration(buffer, `${buffer}\nconst next = 1;`)).toBe(false);
});
