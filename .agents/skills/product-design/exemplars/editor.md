# Exemplar: Editor

Status: accepted (owner, 2026-09-28: "I think this is good, we can commit
this. This will be a strong start."; selection state requested and added)
Surface: Paper, Editor page: E1 "Editor · Dark", E2a "Selection · Dark", E2
"Inline chat · Dark", E3 "Agent editing your file · Light". Commits 400e6af,
117bf9f.
Why exemplary: shows how agents appear inside a code editor without taking
it over, and defines git states and syntax colour.

## Decisions worth repeating

### Agents show up in the chrome, never in the text area
- What: a 12px Harness dither in the file tree and tabs marks files a
  Working agent is changing; the pixel hand marks a folder where an agent
  is blocked; "Agents in {workspace}" lists sessions under the tree.
- Rules exercised: rule/only-working-moves; DESIGN.md, Dither (never in the
  Editor's text area).
- Evidence: E1.
- Repeat when: showing agent presence on any list of files or objects.

### Git states are letters, modified is tan
- What: M, A, U, D, R, C, ! in a fixed slot with the name tinted; folders
  with changes get a dot; gutter bars for changed lines and a red wedge
  where lines were deleted. Modified is tan, not yellow.
- Rules exercised: rule/git-is-a-letter.
- Evidence: owner: "keep in mind Git states for edited files - a modified
  state, an added state, etc. similar to how VS Code and Zed handle these."
- Repeat when: any file list or gutter.

### Moonlit syntax
- What: low-chroma keyword slate, parchment strings, sage types,
  `text-strong` functions, faint comments; ligatures off.
- Rules exercised: rule/syntax-is-moonlit.
- Evidence: E1–E3; tokens in DESIGN.md frontmatter.
- Repeat when: rendering code (Editor, diffs, turn output).

### Selecting code offers inline chat
- What: a floating bar at the end of the selection's first line, clear of
  the text: "Edit or ask ⌘I" (highlighted) and "Add to agent session ⌘L";
  status bar "Ln 10–19 · 10 lines selected".
- Rules exercised: DESIGN.md, Editor (Selection actions).
- Evidence: owner: "if the code is selected by the user, it should show an
  option to start an inline chat with the selected lines" (E2a).
- Repeat when: a selection has actions; never cover selected text.

### Inline chat proposes an inline diff
- What: a raised card above the selection (Harness picker, prompt, range);
  the proposal renders as removed/added lines in place; footer "1 change
  +2 −1 · Thought for 4s", "Open as agent session", Reject (esc), Accept
  (⌘↵, the one primary).
- Rules exercised: rule/code-is-the-content, rule/say-what-happened.
- Evidence: E2.
- Repeat when: an agent proposes a change the user accepts in place.

### An agent editing your file reuses the Working strip
- What: the Working strip runs across the editor ("Claude Code is editing
  this file · Polaris planning · turn 24"), with Follow (on) and Open
  session; agent lines get a 2px Harness bar and ~5% fill; its caret has a
  "Claude Code" name flag.
- Rules exercised: rule/only-working-moves, rule/remote-is-normal (E3 is a
  Linux VM file; status bar shows latency).
- Evidence: E3.
- Repeat when: an agent acts on something the user has open.

## Known flaws

- Concurrent edits to the same lines are undesigned (coverage-gaps.md).
- Inline chat and selection exist only in dark; E3 only in light.
- Whether inline chat is itself an agent session is undecided in CONTEXT.md.
