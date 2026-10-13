/**
 * Raw `textDocument/hover` payloads captured from the pinned servers (basedpyright 1.40.2,
 * typescript-language-server via the Daemon) on 2026-10-11. Ruff answers no hovers (Polaris turns them off).
 */
import type { Hover } from "./payloads.ts";

type Contents = NonNullable<typeof Hover.Type>["contents"];

/** As basedpyright answers a client that advertises Markdown hovers. */
export const MARKDOWN = {
  PYRIGHT_STR: {
    kind: "markdown",
    value:
      "```python\nclass str(object: object = \"\")\n```\n---\nstr(object='') -&gt; str  \nstr(bytes\\_or\\_buffer\\[, encoding\\[, errors\\]\\]) -&gt; str\n\nCreate a new string object from the given object. If encoding or  \nerrors is specified, then the object must expose a data buffer  \nthat will be decoded using the given encoding and error handler.  \nOtherwise, returns the result of object.\\_\\_str\\_\\_() (if defined)  \nor repr(object).  \nencoding defaults to 'utf-8'.  \nerrors defaults to 'strict'.",
  } satisfies Contents,
  PYRIGHT_FUNCTION: {
    kind: "markdown",
    value:
      "```python\n(function) def greet(\n    name: str,\n    *,\n    loud: bool = False\n) -> str\n```\n---\nReturn a greeting for `name`.\n\nThe greeting is built from a template and, when `loud` is set,\nupper-cased. This docstring is deliberately long so the hover has to\nwrap and scroll.\n\nArgs:  \n&nbsp;&nbsp;&nbsp;&nbsp;name: Who to greet.  \n&nbsp;&nbsp;&nbsp;&nbsp;loud: Shout it.\n\nReturns:  \n&nbsp;&nbsp;&nbsp;&nbsp;The greeting.\n\nExample:\n```\n>>> greet('Ada')\n'Hello, Ada'\n```",
  } satisfies Contents,
  PYRIGHT_MODULE: { kind: "markdown", value: "```python\n(module) os\n```" } satisfies Contents,
  TS_FUNCTION: {
    kind: "markdown",
    value:
      "\n```typescript\nfunction closest(hosts: readonly Host[], fallback?: Host): Host | undefined\n```\nPicks the closest Host.\n\n*@param* `hosts` \u2014 Every connected Host.  \n\n*@returns* \u2014 The one with the lowest latency, or `undefined`.",
  } satisfies Contents,
  TS_INTERFACE: {
    kind: "markdown",
    value: "\n```typescript\ninterface Host\n```\nA Host the Desktop App can reach.",
  } satisfies Contents,
  TS_PROPERTY: {
    kind: "markdown",
    value: "\n```typescript\n(property) Host.label: string\n```\nIts name, as the user wrote it.",
  } satisfies Contents,
  /** rust-analyzer 2026-09-28, before Trust (a rust-project.json from Cargo.toml), on 2026-10-12. */
  RUST_FUNCTION: {
    kind: "markdown",
    value:
      "\n```rust\nutil\n```\n\n```rust\npub fn add(a: i32, b: i32) -> i32\n```\n\n---\n\nAdds two numbers.",
  } satisfies Contents,
  /** lua-language-server 3.19.1 on a `---@param` annotated local function, on 2026-10-12. */
  LUA_FUNCTION: {
    kind: "markdown",
    value: "```lua\nfunction greet(name: string)\n  -> string\n```\n\n---\n\nGreets someone.",
  } satisfies Contents,
};

/** As basedpyright answered before the Daemon advertised `contentFormat` (older Daemons). */
export const PLAINTEXT = {
  PYRIGHT_STR: {
    kind: "plaintext",
    value:
      "class str(object: object = \"\")\n\nstr(object='') -> str\nstr(bytes_or_buffer[, encoding[, errors]]) -> str\n\nCreate a new string object from the given object. If encoding or\nerrors is specified, then the object must expose a data buffer\nthat will be decoded using the given encoding and error handler.\nOtherwise, returns the result of object.__str__() (if defined)\nor repr(object).\nencoding defaults to 'utf-8'.\nerrors defaults to 'strict'.",
  } satisfies Contents,
  PYRIGHT_FUNCTION: {
    kind: "plaintext",
    value:
      "(function) def greet(\n    name: str,\n    *,\n    loud: bool = False\n) -> str\n\nReturn a greeting for ``name``.\n\nThe greeting is built from a template and, when ``loud`` is set,\nupper-cased. This docstring is deliberately long so the hover has to\nwrap and scroll.\n\nArgs:\n    name: Who to greet.\n    loud: Shout it.\n\nReturns:\n    The greeting.\n\nExample:\n    >>> greet('Ada')\n    'Hello, Ada'",
  } satisfies Contents,
};
