import { expect, test } from "bun:test";
import { shellRuns } from "./shellSyntax.ts";

const coloured = (command: string) =>
  shellRuns(command)
    .filter((run) => run.group !== null)
    .map((run) => [run.group, run.text]);

const SAMPLES = [
  `cd ~/code/x && grep -n "a\\|b" src/x.ts && git commit -q --no-edit 2>&1 | tail -3`,
  `python3 - <<'EOF'\nprint("hi")\nEOF\nls -la`,
  `git log \\\n  --oneline`,
  `FOO=bar ./bin/run $HOME # note`,
  `echo "unterminated`,
];

test.each(SAMPLES)("the runs spell the command exactly: %p", (command) => {
  expect(
    shellRuns(command)
      .map((run) => run.text)
      .join("")
  ).toBe(command);
});

test("each command in a pipeline or chain is named, its arguments stay plain", () => {
  expect(coloured(`cd ~/code/x && grep -n "a|b" src/x.ts | tail -3; echo done`)).toEqual([
    ["function", "cd"],
    ["punctuation", "&&"],
    ["function", "grep"],
    ["keyword", "-n"],
    ["string", '"a|b"'],
    ["punctuation", "|"],
    ["function", "tail"],
    ["keyword", "-3"],
    ["punctuation", ";"],
    ["function", "echo"],
  ]);
});

test("a redirect isn't a new command, an assignment's value isn't one", () => {
  expect(coloured(`FOO=bar ./bin/run >/dev/null 2>&1`)).toEqual([
    ["type", "FOO"],
    ["punctuation", "="],
    ["function", "./bin/run"],
    ["punctuation", ">"],
    ["punctuation", ">"],
  ]);
});

test("a new line starts a command unless the last ended in a continuation", () => {
  expect(coloured(`git log \\\n  main\nbun test`)).toEqual([
    ["function", "git"],
    ["function", "bun"],
  ]);
});

test("a heredoc's body is a string and a comment runs to the line's end", () => {
  expect(coloured(`cat <<EOF\nrm -rf /\nEOF\nls # all of it`)).toEqual([
    ["function", "cat"],
    ["string", "<<EOF"],
    ["string", "rm -rf /"],
    ["string", "EOF"],
    ["function", "ls"],
    ["comment", "# all of it"],
  ]);
});
