# @polaris/syntax-diff

The syntax-aware diff behind the Editor's diff tabs (DESIGN.md, Editor: diff tabs). It matches two versions of a file by token, not by character, so an added argument marks only the argument and a rename marks only the name.

## Pipeline

1. **Tokenize** (`tokens.ts`): a `Tokenizer` turns file text into `SyntaxToken`s, each an offset range with a coarse kind (identifier, keyword, string, number, comment, punctuation, text, other). Nothing past this point knows the language.
2. **Lines** (`lines.ts`): tokens are grouped by line. Strings, comments and text are split into words, so a changed word in a comment is one change rather than the whole comment.
3. **Align** (`align.ts`, `myers.ts`): Myers over line fingerprints pairs changed lines, then Myers over each pair's tokens finds what was removed and added. A line that only gained tokens is `inserted`.
4. **Patch** (`patch.ts`): a unified patch that Pierre Diffs reads against both full files. Inserted lines are context rows, plus `emphasis` (the changed token ranges per side) and `inserted` (the new-side lines to mark). A change that is only spacing gives an empty patch.

`syntaxDiff(before, after, path, tokenizer)` runs all four. It throws `TooComplex` past `MAX_SYNTAX_EDITS` changed lines, and the caller shows the line diff.

## Tokenizers

- **TypeScript parser** (`./typescript`, `typescript-js`, TS 6 because TS 7 has no JS API): TS, TSX, JS, JSX, `.mts`/`.cts`/`.mjs`/`.cjs`, JSON and JSONC. It loads lazily through `TOKENIZERS` / `tokenizerFor(path)`, so a bundle only pays for it in the worker that imports it.
- **Highlighter runs** (`runs.ts`): `tokensFromRuns(source, lines)` turns a highlighter's coloured spans into tokens; `fixedTokenizer` serves them to `syntaxDiff`. The Desktop App gets the runs from the Shiki highlight Pierre already runs in its worker pool (`apps/desktop/.../editor/diff/data/highlightTokens.ts`), so no second grammar set is loaded.

To add a language-specific tokenizer, implement `Tokenizer` and add a `TokenizerSpec` to `TOKENIZERS`.
