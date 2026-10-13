/**
 * Raw completion and signature payloads, captured 2026-10-12 over stdio with the Daemon's
 * client capabilities: vscode-langservers-extracted 4.10.0 (CSS), typescript-language-server
 * 6.0.1 with TypeScript 6.0.3, basedpyright 1.40.2; gopls v0.23.0 and Phpactor 2026.10.07.0 via the
 * Daemon. `*_RESOLVED` is the `completionItem/resolve` answer; CSS_PLAINTEXT_ITEMS is what CSS sent
 * before the Daemon asked for Markdown.
 */

export const CSS_ITEMS = [
  {
    label: "additive-symbols",
    documentation: {
      kind: "markdown",
      value:
        "@counter\\-style descriptor\\. Specifies the symbols used by the marker\\-construction algorithm specified by the system descriptor\\. Needs to be specified if the counter system is 'additive'\\.\n\nSyntax: \\[ &lt;integer \\[0,∞\\]&gt; && &lt;symbol&gt; \\]\\#",
    },
    tags: [],
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 2,
        },
        end: {
          line: 1,
          character: 6,
        },
      },
      newText: "additive-symbols: $0;",
    },
    insertTextFormat: 2,
    kind: 10,
    command: {
      title: "Suggest",
      command: "editor.action.triggerSuggest",
    },
    sortText: "d_cd",
  },
  {
    label: "align-content",
    documentation: {
      kind: "markdown",
      value:
        "Aligns a flex container's lines within the flex container when there is extra space in the cross\\-axis, similar to how 'justify\\-content' aligns individual items within the main\\-axis\\.\n\n![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgIGZpbGw6ICNDNEVFRDA7IC8qIExpZ2h0IG1vZGUgKi8KICAgIH0KCiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgICAgZmlsbDogIzEyNTIyNTsgLyogRGFyayBtb2RlICovCiAgICAgIH0KICAgIH0KICA8L3N0eWxlPgogIDxwYXRoIGQ9Ik00MjAgMzBMMzkwIDYwTDQ4MCAxNTBMMzkwIDI0MEwzMzAgMTgwTDMwMCAyMTBMMzkwIDMwMEw1NDAgMTUwTDQyMCAzMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0xNTAgMEwzMCAxMjBMNjAgMTUwTDE1MCA2MEwyMTAgMTIwTDI0MCA5MEwxNTAgMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0zOTAgMEw0MjAgMzBMMTUwIDMwMEwwIDE1MEwzMCAxMjBMMTUwIDI0MEwzOTAgMFoiIGZpbGw9IiMxRUE0NDYiLz4KPC9zdmc+) _Widely available across major browsers (Baseline since 2015)_\n\nSyntax: normal | &lt;baseline\\-position&gt; | &lt;content\\-distribution&gt; | &lt;overflow\\-position&gt;? &lt;content\\-position&gt;\n\n[MDN Reference](https://developer.mozilla.org/docs/Web/CSS/Reference/Properties/align-content)",
    },
    tags: [],
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 2,
        },
        end: {
          line: 1,
          character: 6,
        },
      },
      newText: "align-content: $0;",
    },
    insertTextFormat: 2,
    kind: 10,
    command: {
      title: "Suggest",
      command: "editor.action.triggerSuggest",
    },
    sortText: "d_bb",
  },
];

export const CSS_DISPLAY = {
  label: "display",
  documentation: {
    kind: "markdown",
    value:
      "In combination with 'float' and 'position', determines the type of box or boxes that are generated for an element\\.\n\n![Baseline icon](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgiIGhlaWdodD0iMTAiIHZpZXdCb3g9IjAgMCA1NDAgMzAwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxzdHlsZT4KICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgIGZpbGw6ICNDNEVFRDA7IC8qIExpZ2h0IG1vZGUgKi8KICAgIH0KCiAgICBAbWVkaWEgKHByZWZlcnMtY29sb3Itc2NoZW1lOiBkYXJrKSB7CiAgICAgIC5ncmVlbi1zaGFwZSB7CiAgICAgICAgZmlsbDogIzEyNTIyNTsgLyogRGFyayBtb2RlICovCiAgICAgIH0KICAgIH0KICA8L3N0eWxlPgogIDxwYXRoIGQ9Ik00MjAgMzBMMzkwIDYwTDQ4MCAxNTBMMzkwIDI0MEwzMzAgMTgwTDMwMCAyMTBMMzkwIDMwMEw1NDAgMTUwTDQyMCAzMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0xNTAgMEwzMCAxMjBMNjAgMTUwTDE1MCA2MEwyMTAgMTIwTDI0MCA5MEwxNTAgMFoiIGNsYXNzPSJncmVlbi1zaGFwZSIvPgogIDxwYXRoIGQ9Ik0zOTAgMEw0MjAgMzBMMTUwIDMwMEwwIDE1MEwzMCAxMjBMMTUwIDI0MEwzOTAgMFoiIGZpbGw9IiMxRUE0NDYiLz4KPC9zdmc+) _Widely available across major browsers (Baseline since 2015)_\n\nSyntax: \\[ &lt;display\\-outside&gt; || &lt;display\\-inside&gt; \\] | &lt;display\\-listitem&gt; | &lt;display\\-internal&gt; | &lt;display\\-box&gt; | &lt;display\\-legacy&gt;\n\n[MDN Reference](https://developer.mozilla.org/docs/Web/CSS/Reference/Properties/display)",
  },
  tags: [],
  textEdit: {
    range: {
      start: {
        line: 1,
        character: 2,
      },
      end: {
        line: 1,
        character: 6,
      },
    },
    newText: "display: $0;",
  },
  insertTextFormat: 2,
  kind: 10,
  command: {
    title: "Suggest",
    command: "editor.action.triggerSuggest",
  },
  sortText: "d_9f",
};

export const CSS_PLAINTEXT_ITEMS = [
  {
    label: "align-content",
    documentation: {
      kind: "plaintext",
      value:
        "Aligns a flex container's lines within the flex container when there is extra space in the cross-axis, similar to how 'justify-content' aligns individual items within the main-axis.\n\nWidely available across major browsers (Baseline since 2015)\n\nSyntax: normal | <baseline-position> | <content-distribution> | <overflow-position>? <content-position>\n\nMDN Reference: https://developer.mozilla.org/docs/Web/CSS/Reference/Properties/align-content",
    },
    tags: [],
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 2,
        },
        end: {
          line: 1,
          character: 6,
        },
      },
      newText: "align-content: $0;",
    },
    insertTextFormat: 2,
    kind: 10,
    command: {
      title: "Suggest",
      command: "editor.action.triggerSuggest",
    },
    sortText: "d_bb",
  },
];

export const TS_ITEMS = [
  {
    label: "append",
    kind: 2,
    sortText: "11",
    data: {
      cacheId: 1,
    },
    filterText: ".append",
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 17,
        },
        end: {
          line: 1,
          character: 18,
        },
      },
      newText: ".append",
    },
  },
  {
    label: "delete",
    kind: 2,
    sortText: "11",
    data: {
      cacheId: 2,
    },
    filterText: ".delete",
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 17,
        },
        end: {
          line: 1,
          character: 18,
        },
      },
      newText: ".delete",
    },
  },
  {
    label: "size",
    kind: 5,
    sortText: "11",
    data: {
      cacheId: 10,
    },
    filterText: ".size",
    textEdit: {
      range: {
        start: {
          line: 1,
          character: 17,
        },
        end: {
          line: 1,
          character: 18,
        },
      },
      newText: ".size",
    },
  },
];

export const TS_APPEND_RESOLVED = {
  label: "append",
  kind: 2,
  sortText: "11",
  data: {
    file: "/project/main.ts",
    line: 2,
    offset: 19,
    entryNames: ["append"],
  },
  filterText: ".append",
  textEdit: {
    range: {
      start: {
        line: 1,
        character: 17,
      },
      end: {
        line: 1,
        character: 18,
      },
    },
    newText: ".append",
  },
  detail: "(method) URLSearchParams.append(name: string, value: string): void",
  documentation: {
    kind: "markdown",
    value:
      "The **`append()`** method of the URLSearchParams interface appends a specified key/value pair as a new search parameter.\n\n[MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/append)",
  },
};

export const TS_SIGNATURE = {
  activeSignature: 0,
  activeParameter: 1,
  signatures: [
    {
      label: "append(name: string, value: string): void",
      documentation: {
        kind: "markdown",
        value:
          "The **`append()`** method of the URLSearchParams interface appends a specified key/value pair as a new search parameter.\n\n[MDN Reference](https://developer.mozilla.org/docs/Web/API/URLSearchParams/append)",
      },
      parameters: [
        {
          label: "name: string",
        },
        {
          label: "value: string",
        },
      ],
    },
  ],
};

export const PYRIGHT_ITEMS = [
  {
    label: "dumps",
    kind: 3,
    sortText: "12.9999.dumps",
    data: {
      uri: "file:///project/m2.py",
      position: {
        line: 2,
        character: 7,
      },
      symbolLabel: "dumps",
    },
  },
  {
    label: "dump",
    kind: 3,
    sortText: "12.9999.dump",
    data: {
      uri: "file:///project/m2.py",
      position: {
        line: 2,
        character: 7,
      },
      symbolLabel: "dump",
    },
  },
];

export const PYRIGHT_DUMPS_RESOLVED = {
  label: "dumps",
  kind: 3,
  sortText: "12.9999.dumps",
  data: {
    uri: "file:///project/m2.py",
    position: {
      line: 2,
      character: 7,
    },
    symbolLabel: "dumps",
  },
  documentation: {
    kind: "markdown",
    value:
      "```python\ndef dumps(\n    obj: Any,\n    *,\n    skipkeys: bool = False,\n    ensure_ascii: bool = True,\n    check_circular: bool = True,\n    allow_nan: bool = True,\n    cls: type[JSONEncoder] | None = None,\n    indent: int | str | None = None,\n    separators: tuple[str, str] | None = None,\n    default: ((Any) -> Any) | None = None,\n    sort_keys: bool = False,\n    **kwds: Any\n) -> str\n```\n---\nSerialize `obj` to a JSON formatted `str`.\n\nIf `skipkeys` is true then `dict` keys that are not basic types  \n(`str`, `int`, `float`, `bool`, `None`) will be skipped  \ninstead of raising a `TypeError`.\n\nIf `ensure_ascii` is false, then the return value can contain  \nnon-ASCII and non-printable characters if they appear in strings  \ncontained in `obj`.  Otherwise, all such characters are escaped in  \nJSON strings.\n\nIf `check_circular` is false, then the circular reference check  \nfor container types will be skipped and a circular reference will  \nresult in an `RecursionError` (or worse).\n\nIf `allow_nan` is false, then it will be a `ValueError` to  \nserialize out of range `float` values (`nan`, `inf`, `-inf`) in  \nstrict compliance of the JSON specification, instead of using the  \nJavaScript equivalents (`NaN`, `Infinity`, `-Infinity`).\n\nIf `indent` is a non-negative integer, then JSON array elements and  \nobject members will be pretty-printed with that indent level. An indent  \nlevel of 0 will only insert newlines. `None` is the default and gives  \na representation with no newlines inserted.\n\nIf specified, `separators` should be an `(item_separator,  \nkey_separator)` tuple.  The default is `(', ', ': ')` if \\*indent\\* is  \n`None` and `(',', ': ')` otherwise.  To get the most compact JSON  \nrepresentation, you should specify `(',', ':')` to eliminate\nwhitespace.\n\n`default(obj)` is a function that should return a serializable version  \nof obj or raise TypeError. The default simply raises TypeError.\n\nIf \\*sort\\_keys\\* is true (default: `False`), then the output of\ndictionaries will be sorted by key.\n\nTo use a custom `JSONEncoder` subclass (e.g. one that overrides the  \n`.default()` method to serialize additional types), specify it with  \nthe `cls` kwarg; otherwise `JSONEncoder` is used.",
  },
};

/** An auto-import from `./hosts` (typed `hostLa` in a file without the import): the edit arrives on resolve. */
export const TS_IMPORT_ITEM = {
  label: "hostLabel",
  kind: 6,
  sortText: "￿16",
  data: {
    cacheId: 1022,
  },
  detail: "./hosts",
};

export const TS_IMPORT_RESOLVED = {
  label: "hostLabel",
  kind: 6,
  sortText: "￿16",
  data: {
    file: "/project/imp.ts",
    line: 1,
    offset: 21,
    entryNames: [
      {
        name: "hostLabel",
        source: "./hosts",
        data: {
          exportName: "hostLabel",
          exportMapKey: "9 2222 hostLabel ",
          moduleSpecifier: "./hosts",
          fileName: "/project/hosts.ts",
        },
      },
    ],
  },
  detail: "Auto import from './hosts'\nconst hostLabel: (name: string) => string",
  additionalTextEdits: [
    {
      range: {
        start: {
          line: 0,
          character: 0,
        },
        end: {
          line: 0,
          character: 0,
        },
      },
      newText: 'import { hostLabel } from "./hosts";\n\n',
    },
  ],
};

/** gopls v0.23.0 after `fmt.Pr`: docs arrive inline (gopls offers no resolve). */
export const GOPLS_ITEMS = [
  {
    label: "Print",
    kind: 3,
    detail: "func(a ...any) (n int, err error)",
    documentation: {
      kind: "markdown",
      value:
        "Print formats using the default formats for its operands and writes to standard output. Spaces are added between operands when neither is a string. It returns the number of bytes written and any write error encountered.\n",
    },
    preselect: true,
    sortText: "00000",
    filterText: "Print",
    insertTextFormat: 2,
    textEdit: {
      range: { start: { line: 5, character: 5 }, end: { line: 5, character: 12 } },
      newText: "Print(${1:})",
    },
  },
  {
    label: "Printf",
    kind: 3,
    detail: "func(format string, a ...any) (n int, err error)",
    documentation: {
      kind: "markdown",
      value:
        "Printf formats according to a format specifier and writes to standard output. It returns the number of bytes written and any write error encountered.\n",
    },
    sortText: "00001",
    filterText: "Printf",
    insertTextFormat: 2,
    textEdit: {
      range: { start: { line: 5, character: 5 }, end: { line: 5, character: 12 } },
      newText: "Printf(${1:})",
    },
  },
  {
    label: "Println",
    kind: 3,
    detail: "func(a ...any) (n int, err error)",
    documentation: {
      kind: "markdown",
      value:
        "Println formats using the default formats for its operands and writes to standard output. Spaces are always added between operands and a newline is appended. It returns the number of bytes written and any write error encountered.\n",
    },
    sortText: "00002",
    filterText: "Println",
    insertTextFormat: 2,
    textEdit: {
      range: { start: { line: 5, character: 5 }, end: { line: 5, character: 12 } },
      newText: "Println(${1:})",
    },
  },
];

/** Phpactor 2026.10.07.0 after `$greeter->gr`: a list with no docs until resolve. */
export const PHPACTOR_ITEMS = {
  isIncomplete: true,
  items: [
    {
      label: "greet",
      kind: 2,
      insertText: "greet(${1:\\$name})${0}",
      insertTextFormat: 2,
      data: 0,
    },
  ],
};

export const PHPACTOR_GREET_RESOLVED = {
  label: "greet",
  kind: 2,
  detail: "pub greet(string $name): string",
  documentation: {
    kind: "markdown",
    value:
      "### App\\Greeter::greet\n\nSays hello.\n\n```php\n<?php public function greet(string $name): string\n```",
  },
  insertText: "greet(${1:\\$name})${0}",
  insertTextFormat: 2,
  data: 0,
};

/** rust-analyzer 2026-09-28 after `v.` on a `Vec<i32>`, before Trust; docs arrive on resolve. */
export const RUST_PUSH_ITEM = {
  label: "push",
  kind: 2,
  sortText: "7ffffff6",
  filterText: "push",
  textEdit: {
    range: {
      start: {
        line: 4,
        character: 6,
      },
      end: {
        line: 4,
        character: 6,
      },
    },
    newText: "push",
  },
  data: {
    position: {
      textDocument: {
        uri: "file:///project/src/main.rs",
      },
      position: {
        line: 4,
        character: 6,
      },
    },
    version: 1,
    for_ref: false,
    hash: "IeWbOguyXjyXxQdk64gm5WSSjQ0=",
  },
};

export const RUST_PUSH_RESOLVED = {
  label: "push",
  kind: 2,
  detail: "fn(&mut self, T)",
  documentation: {
    kind: "markdown",
    value:
      "Appends an element to the back of a collection.\n\n# Panics\n\nPanics if the new capacity exceeds `isize::MAX` _bytes_.\n\n# Examples\n\n```rust\nlet mut vec = vec![1, 2];\nvec.push(3);\nassert_eq!(vec, [1, 2, 3]);\n```\n\n# Time complexity\n\nTakes amortized *O*(1) time. If the vector's length would exceed its\ncapacity after the push, *O*(*capacity*) time is taken to copy the\nvector's elements to a larger allocation. This expensive operation is\noffset by the *capacity* *O*(1) insertions it allows.",
  },
  preselect: true,
  sortText: "7ffffff6",
  filterText: "push",
  textEdit: {
    range: {
      start: {
        line: 4,
        character: 6,
      },
      end: {
        line: 4,
        character: 6,
      },
    },
    newText: "push",
  },
};

/** lua-language-server 3.19.1 after `string.`: snippet items, docs on resolve. */
export const LUA_BYTE_ITEM = {
  command: {
    command: "editor.action.triggerParameterHints",
    title: "trigger signature",
  },
  data: {
    id: 2,
    uri: "file:///project/main.lua",
  },
  insertText: "byte(${1:s}, ${2:i?}, ${3:j?})",
  insertTextFormat: 2,
  kind: 3,
  label: "byte(s, i, j)",
  sortText: "0001",
};

export const LUA_BYTE_RESOLVED = {
  command: {
    command: "editor.action.triggerParameterHints",
    title: "trigger signature",
  },
  data: {
    id: 2,
    uri: "file:///project/main.lua",
  },
  detail: "function",
  documentation: {
    kind: "markdown",
    value:
      "```lua\nfunction string.byte(s: string|number, i?: integer, j?: integer)\n  -> ...integer\n```\n\n---\n\n\nReturns the internal numeric codes of the characters `s[i], s[i+1], ..., s[j]`.\n\n[View documents](http://www.lua.org/manual/5.4/manual.html#pdf-string.byte)",
  },
  insertText: "byte(${1:s}, ${2:i?}, ${3:j?})",
  insertTextFormat: 2,
  kind: 3,
  label: "byte(s, i, j)",
  sortText: "0001",
};
