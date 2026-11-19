import { expect, test } from "bun:test";
import { isReadOnlyCommand } from "./readOnlyCommand.ts";

const reads = [
  "ls -la src",
  "cat package.json | head -20",
  "rg -n 'TODO' apps && git status",
  "git log --oneline -5",
  "git diff HEAD~1 -- src/a.ts",
  "grep -rn foo . 2>/dev/null | wc -l",
  "git status 2>&1 | tail -3",
  "cd apps/daemon && git show HEAD --stat",
  "find . -name '*.ts' -newer package.json",
  "sort names.txt | cut -d, -f1",
  // Quotes are removed as the shell removes them.
  "'ls'",
  "grep 'a|b; c && d' notes.txt",
  'rg "sort -o" docs',
];

const writes = [
  // The edits ENG-980 counted in transcripts.
  "python3 - <<'EOF'\nopen('a','w').write('x')\nEOF",
  "sed -i 's/a/b/' file.txt",
  "echo hi > file.txt",
  "echo hi >> file.txt",
  "cat a.txt | tee b.txt",
  // Read-only names with a way to write or to run something else.
  "find . -name '*.tmp' -delete",
  "find . -exec rm {} +",
  "sort -o names.txt names.txt",
  "sort --output=names.txt names.txt",
  "git diff --output=changes.patch",
  "rg --pre ./convert pattern",
  // A quoted flag is the same flag.
  "find . -name '*.tmp' '-delete'",
  "sort '-o' out in",
  'find . "-exec" rm {} +',
  "sort -'o' out in",
  "sort -uo out in",
  "git diff '--output=changes.patch'",
  "'rm' -rf build",
  "ls 'unclosed",
  "git checkout main",
  "git -C other status",
  "git stash",
  // Shell the classifier doesn't follow.
  "ls $(rm -rf build)",
  "ls `touch x`",
  "FOO=1 ls",
  "ls & rm x",
  "cat a\nrm b",
  "bun test",
  "make",
  "ls;",
];

test.each(reads)("%s is read-only: no snapshot", (command) => {
  expect(isReadOnlyCommand(command)).toBe(true);
});

test.each(writes)("%s may write: snapshot", (command) => {
  expect(isReadOnlyCommand(command)).toBe(false);
});
