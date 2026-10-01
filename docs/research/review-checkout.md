# Research: Review Checkout git mechanics on the Host

Linear: ENG-221 (map ENG-217). Researched 2026-10-01 against git 2.54.0 (Apple Git-157) on macOS 27, the git manual pages and release notes, forge docs, and the Daemon's existing git code (`apps/daemon/src/git/`, `apps/daemon/src/engine/worktrees.ts`). Every git behaviour below was run for real in scratch clones under a temp directory: a local "forge" bare repo with hand-made `refs/pull/N/head` refs, `octocat/Hello-World`, `cli/cli`, and a full clone of `microsoft/vscode` (1.51 GiB pack, 19,681 tracked files, 68,491 `refs/pull/*/head` refs). No user repository was touched.

Already decided in ENG-185: the Review Checkout runs on the Host that holds the Workspace. It is a Worktree next to the Workspace. It is kept until the PR merges or closes, then removed automatically. On new commits Polaris offers to update it and to rerun the Risk Summary on the new changes only. Fetches use the Host's own git credentials.

## TL;DR

- **Fetch exactly one PR ref into a Polaris namespace, by refspec, with four flags.** Use `git fetch --no-write-fetch-head --no-auto-maintenance --no-tags --refmap= <remote-or-url> +refs/pull/N/head:refs/polaris/review/N/head +refs/heads/<base>:refs/polaris/review/N/base`. Without `--refmap=`, git *opportunistically moves the user's `refs/remotes/origin/<base>`*, which changes their `git status` ahead/behind. This was verified, and it is the one user-visible side effect that is easy to miss. `--no-write-fetch-head` keeps the user's `FETCH_HEAD`. `--no-auto-maintenance` keeps Polaris from starting a gc in the user's repo.
- **`refs/pull/N/head` lives in the base repository**, so PRs from forks, deleted forks and private forks need only read access to the base repo. GitHub and GitHub Enterprise expose it read-only to anyone who can read the repo. It works the same over ssh and https. On GitHub it is never cleaned up: the head ref of Hello-World PR #4, whose fork is deleted, is still there. GitLab uses `refs/merge-requests/N/head` and deletes it 14 days after close or merge. Bitbucket Cloud has no PR refs.
- **No prompting is a matter of environment and config.** The Daemon already sets `GIT_TERMINAL_PROMPT=0` (https fails in about 0.1 s with "terminal prompts disabled"). For fetches it should add `-c credential.interactive=false` (git ≥ 2.47; older gits ignore it) and an ssh `-o BatchMode=yes` appended to the user's `core.sshCommand` / `ssh`. A bad host key then fails in under 0.1 s instead of hanging on a passphrase or host-key prompt. Use the remote whose URL matches the PR's base repo, so the user's own transport (ssh vs https), host alias and credential helper apply. If no remote matches, fetch by URL; that works without adding a remote.
- **Create the checkout as a detached worktree, never a branch:** `git -c core.hooksPath=/dev/null worktree add --detach <path> refs/polaris/review/N/head`. The user's branches, HEAD, index and working tree are untouched (verified). **Hooks must be off for every Polaris git call in a Review Checkout.** With a relative `core.hooksPath` (husky's `.husky/_`), a `git checkout` run inside the Review Checkout *executes the PR's own hook script*. This was verified with a PR that adds `.husky/post-checkout`. Running PR code must happen only when the user presses Run.
- **"Only the new changes" = a tree-level interdiff, not `old..new`.** Store `reviewed` (the head SHA last summarised) and `reviewed-base` (its merge base). On update:
  - When the old head is an ancestor of the new head and the merge base hasn't moved, the new changes are `diff old new`.
  - Otherwise (force-push, rebase, or merging the base in), replay the old PR onto the new base, `T = git merge-tree --write-tree --merge-base=<reviewed-base> <new merge base> <reviewed>`, and summarise `diff T <new head>`.
  - In the experiments this gave exactly the author's edits. A merge-from-main gave an empty interdiff where the naive `old..new` showed upstream files. A rebase+squash+tweak gave the one changed line. `range-diff` was noisy after the squash: it is good for showing commit-level history, not as the Risk Summary input.
  - `merge-tree --merge-base` needs git ≥ 2.40. Debian 12 / Raspberry Pi OS bookworm ship 2.39, so a fallback is needed there.
- **Update only a clean checkout.** `git checkout --detach <new>` *silently carries* uncommitted edits across when they don't conflict (verified), so check `status --porcelain` first and offer the update rather than doing it.
- **Remove with the existing `removeWorktree` semantics** (`worktree remove` without `--force`). Modified or untracked files block it (verified). Ignored files such as `node_modules` don't block it and are deleted. Block removal while an Agent Session's cwd is inside the checkout. Lock the worktree (`git worktree lock --reason "polaris review checkout …"`) so `git worktree prune` and the user's own `worktree remove` leave it alone. Merge/close detection needs the forge API, because refs alone can't tell: GitHub keeps `refs/pull/N/head` forever and keeps `refs/pull/N/merge` on many closed PRs.
- **Cost on vscode (Apple Silicon, APFS):**

  | Step | Cost |
  |---|---|
  | `ls-remote` of one PR ref | 0.6 s |
  | First fetch of PR head + base | 1.4 s |
  | No-op fetch | 0.19 s |
  | `worktree add` | 4.3 s, 574 MB (a second copy of the working tree; objects are shared) plus a 2.7 MB admin dir |
  | `status` | 0.45 s |
  | Checkout to an adjacent commit | 0.2–0.35 s |
  | Checkout 20,000 commits away | 3.0 s |
  | merge-tree interdiff | 0.06 s |
  | `worktree remove` | 2.25 s |

  Disk is the real cost, and installed dependencies (not git) will dominate it.
- **Several Hosts never conflict in git**, because nothing is pushed and every Host has its own refs and worktrees. They duplicate work, though: each Host fetches, checks out and summarises independently. Key Risk Summaries by `(repo identity, merge-base SHA, head SHA)` so a Client can reuse one Host's result for another.

---

## 1. What the Daemon already does (and what it implies)

From `apps/daemon/src/git/README.md`, `git.ts`, `WorktreeTracker.ts`, `engine/worktrees.ts`, `engine/decider.ts`:

- Every git call goes through the Host's own `git` CLI with `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`, `LC_ALL=C` (`git.ts` `baseEnv`). The user's config, credential helpers and hooks apply. That is right for credentials, and wrong for hooks inside a Review Checkout (§3).
- Worktrees go under `workspace.worktreeRoot = <workspace path>.worktrees` (`decider.ts:153`), at `<worktreeRoot>/<branch>` for `NewWorktree` and `<worktreeRoot>/polaris/fork-<hash>` for Forks.
- `createWorktree` always creates or checks out a **branch** (`worktree add -b`). A Review Checkout needs a third mode, `--detach <commit>`, which it doesn't have yet.
- `removeWorktree` runs `worktree remove` without `--force`, and deletes a branch only if it is merged and only with `-d`. Exactly those semantics are wanted for Review Checkouts (§5).
- `WorktreeTracker` treats git's registry as the source of truth, and `detectExisting` records every listed worktree as a `Worktree` with `createdBySessionId: null`. A detached Review Checkout will be listed with `branch: null`. Unless the engine recognises it (by its path or its lock reason; `parseWorktreeList` ignores `locked` today), it will show up as an anonymous Worktree. The tracker should parse `locked <reason>` and the engine should map Polaris-locked review paths to the Review Checkout, not to a plain Worktree.
- Checkpoint refs live in `refs/polaris/checkpoints/…`, and `prune.ts` only parses that prefix (`CHECKPOINT_REF_PREFIX`). A sibling `refs/polaris/review/…` namespace does not collide with checkpoint pruning.

## 2. Fetching the PR's head

### Which refs exist

- GitHub documents `git fetch origin pull/ID/head:BRANCH_NAME` and says "the remote `refs/pull/` namespace is *read-only*" ([GitHub Docs: checking out PRs locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally)). GitHub Enterprise Server uses the same namespace (same doc set).
- `refs/pull/N/head` is in the **base** repository whatever the PR's source is. Verified on `octocat/Hello-World`: PR #1 is from the fork `unoju/Hello-World` and PR #4's fork is deleted (the API returns `head.repo: null`). Both have fetchable `refs/pull/N/head`. So:
  - **Forks and deleted forks:** fetch from the base repo. No access to the fork is needed.
  - **Private forks of a private repo:** the same. Read access to the base repo is enough, because the ref lives there.
  - **Nothing is ever cleaned up on GitHub:** all 2,048 Hello-World PRs still have `refs/pull/N/head`. `refs/pull/N/merge` (GitHub's test merge) exists for only 1,660, including closed PR #1, so its presence says nothing about the PR's state. Don't check out `merge` either: it is GitHub's own merge commit, absent on conflicts and recomputed asynchronously.
- **GitLab:** `refs/merge-requests/N/head`, "deleted 14 days after a merge request is closed or merged" ([GitLab: MR troubleshooting](https://docs.gitlab.com/user/project/merge_requests/merge_request_troubleshooting/)). That is fine for Polaris, which removes the checkout on close, but fetch before then.
- **Bitbucket Cloud:** no PR refs. Fetching needs read access to the source repo/branch. Bitbucket Server/Data Center has `refs/pull-requests/N/from` ([Atlassian community answer](https://community.atlassian.com/forums/Bitbucket-questions/Bitbucket-Cloud-Checking-out-pull-requests-locally/qaq-p/738207); secondary source, not verified first-hand). Gitea/Forgejo were not verified here.
- Never fetch `refs/pull/*`: vscode has 68,491 of them.

### The fetch command

Verified in the scratch "user" clone:

```sh
git -c credential.interactive=false \
  fetch --no-write-fetch-head --no-auto-maintenance --no-tags --refmap= \
  <remote> +refs/pull/N/head:refs/polaris/review/N/head \
           +refs/heads/<base>:refs/polaris/review/N/base
```

- **`--refmap=` is required.** Fetching `+refs/heads/main:refs/polaris/review/7/base` with the default refmap *also moved `refs/remotes/origin/main`* (83e5312 → f3456a5) through git's opportunistic remote-tracking update. With `--refmap=` it stayed put. Without it, a background Review fetch would change the user's "behind origin/main by N" in their prompt and editor.
- `--no-write-fetch-head` ([git-fetch(1)](https://git-scm.com/docs/git-fetch#Documentation/git-fetch.txt---no-write-fetch-head), git ≥ 2.29 per RelNotes 2.29.0): the user's `FETCH_HEAD` was not created or overwritten.
- `--no-auto-maintenance` ([git-fetch(1)](https://git-scm.com/docs/git-fetch#Documentation/git-fetch.txt---no-auto-maintenance)): otherwise every fetch may run `git maintenance run --auto` in the user's repo. The user's own fetches still run it, so packs don't pile up forever. This matches the Checkpoints rule that Polaris never runs `gc` in a user's repository.
- `--no-tags`: don't pull tags into the user's namespace as a side effect.
- The `+` forces the update, which a force-pushed PR needs. Before overwriting, Polaris moves the old head to `…/reviewed` (§4), so the reviewed version stays reachable and survives `gc --prune=now` (verified).
- Refs under `refs/polaris/` survive `git gc --prune=now` and `git fetch --prune origin` (verified: the default refspec only prunes `refs/remotes/origin/*`).
- **Which remote:** the Workspace may have `origin` = the user's fork and `upstream` = the base repo. Match the PR's base repo (`owner/name` on host H) against each remote's URL, normalising `git@H:o/n.git`, `ssh://git@H/o/n`, `https://H/o/n(.git)`, and `insteadOf`/ssh host aliases (`git remote get-url` already applies `insteadOf`; ssh aliases need `ssh -G <alias>` to resolve the real hostname). Use the matching remote's *name*, so its URL, transport and credentials apply unchanged. If nothing matches, fetch by URL (`git fetch https://H/o/n …` worked without adding a remote; `git config --get-regexp ^remote.` was unchanged), choosing ssh vs https by whichever the user's other remotes on H use.
- **Shallow Workspaces:** in a `--depth 1` clone of `cli/cli`, fetching one PR head pulled 12,181 commits, and `merge-base HEAD <pr>` then failed (exit 1) at the shallow boundary. For shallow repos, take the merge base from the forge API (`base.sha`/compare endpoint) and fetch it explicitly. Otherwise refuse with a clear message.

### Not prompting, with the Host's own credentials

| Situation | Behaviour observed | What to set |
|---|---|---|
| https, no stored credentials | `fatal: could not read Username … terminal prompts disabled`, 0.1 s | `GIT_TERMINAL_PROMPT=0` (already set) |
| https, credential helper that may show UI (Git Credential Manager, a browser OAuth flow) | — | `-c credential.interactive=false`: "To avoid the possibility of user interactivity from Git, set credential.interactive=false. Some credential helpers respect this option as well" ([git-config(1)](https://git-scm.com/docs/git-config#Documentation/git-config.txt-credentialinteractive)); added for background maintenance in git 2.47 (RelNotes 2.47.0, `ds/background-maintenance-with-credential`). Older git ignores the unknown key harmlessly. |
| ssh, unknown host key | with `BatchMode=yes`: "Host key verification failed", 0.09 s | `-o BatchMode=yes` |
| ssh, agent key | `ls-remote git@github.com:octocat/Hello-World.git refs/pull/1/head` worked, 0.44 s | — |
| ssh, passphrase key and no agent | `BatchMode` makes ssh fail instead of asking for the passphrase (per ssh_config(5)) | `-o BatchMode=yes` |

- `GIT_SSH_COMMAND` *overrides* `core.sshCommand` ([git-config(1) core.sshCommand](https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresshCommand)). So the Daemon should read the user's effective `core.sshCommand` (default `ssh`) and append ` -o BatchMode=yes -o ConnectTimeout=15` to it, not replace it. Fetches also need an overall timeout from the Daemon (Effect `timeout`), because a stalled https transfer can sit idle; `http.lowSpeedLimit`/`http.lowSpeedTime` is the git-side knob.
- The Daemon runs under launchd or systemd `--user` (`service/README.md`), so it has no TTY and its environment is the unit's environment. **`SSH_AUTH_SOCK` is not guaranteed there**, especially under systemd: an ssh-remote user whose key is only in a forwarded agent will see fetches fail. This needs a clear "fetch failed: ssh could not authenticate on this Host" error with the stderr. Don't try to borrow the Client's SSH agent.
- **The forge API needs a token too** (PR metadata, base repo, merged/closed state). With the Host's own credentials, the Daemon can ask git for it: `printf 'protocol=https\nhost=github.com\n\n' | git -c credential.interactive=false credential fill` returned the user's username and token non-interactively here (through `gh auth git-credential` from the user's global config). That covers https users. ssh-only users may have no https credential, so fall back in this order: `gh` if installed and logged in, then unauthenticated for public repos, then "connect a token". Use conditional requests: a `304` "does not count against your primary rate limit" ([GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).

## 3. Creating the checkout without touching the user's tree

```sh
git -c core.hooksPath=/dev/null worktree add --detach <worktreeRoot>/.review/pr-N refs/polaris/review/N/head
git worktree lock --reason "polaris review checkout <workspace> #N" <worktreeRoot>/.review/pr-N
```

- **Detached HEAD, not a branch.** A branch would clutter `git branch` and could collide with one of the user's own branches. git also refuses to check out a branch that is checked out elsewhere, so the user couldn't `git switch` to it. In the experiment the user's `mywork` branch, its uncommitted change, the main worktree's HEAD and the branch list were all unchanged. The checkout itself is pinned by its detached `HEAD`: a commit held only by a worktree HEAD survived `gc --prune=now` with its ref deleted. The `refs/polaris/review/N/*` refs still matter for the diff and interdiff after an update.
- **Path:** `<worktreeRoot>/.review/pr-N`. `NewWorktree` places worktrees at `<worktreeRoot>/<branch>`, so `review-N` or `review/pr-N` could collide with a user branch of that name. A path component starting with `.` cannot be a branch name (`git check-ref-format refs/heads/.review/pr-1` → exit 1), so `.review/` is collision-proof.
- **Hooks: off for every Polaris git call in the checkout.** git resolves a relative `core.hooksPath` "relative to the directory where the hooks are run" ([git-config(1)](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corehooksPath)), and husky sets exactly such a path. Verified:
  - `worktree add` run from the main worktree ran the **user's** `.husky/post-checkout`, from the main checkout.
  - A later `git checkout` run **inside the Review Checkout** ran the **PR's** `.husky/post-checkout`, which wrote a marker file. So a PR can get code executed on the Host by the Daemon merely updating the checkout.
  - With `-c core.hooksPath=/dev/null`, no hook ran.

  The same applies to `post-merge`, `post-rewrite` and the rest, so pass it on create, update and status. Agent Sessions and the user's own terminal in the checkout run hooks as normal; that is the user choosing to run the PR.
- Filters still run. LFS smudge, for example, comes from the user's config, and a PR's `.gitattributes` can only select filters the user already configured, not define new commands. Consider `GIT_LFS_SKIP_SMUDGE=1` for the first checkout on a big LFS repo, with an explicit "fetch LFS files" action.
- **Lock it.** A locked worktree survives `git worktree prune` and refuses `git worktree remove` ("cannot remove a locked working tree, lock reason: …") until it is unlocked (verified). The reason string is also how `WorktreeTracker` can recognise the checkout as a Review Checkout. Polaris unlocks it immediately before its own removal.

## 4. Updating on new commits, and "only the new changes"

### Detecting new commits

Poll the forge API for `head.sha` (with ETag; a `304` is free), or `git ls-remote <remote> refs/pull/N/head` (0.2–0.6 s, no token needed for public repos). Poll only while a Review for that PR is open in some Client, or on a slow schedule otherwise: an idle Daemon must justify every timer in the `idle` bench scenario (AGENTS.md, Performance).

### The refs Polaris keeps per PR

| Ref | Meaning |
|---|---|
| `refs/polaris/review/N/head` | latest fetched head |
| `refs/polaris/review/N/base` | latest fetched base branch tip |
| `refs/polaris/review/N/reviewed` | the head the last Risk Summary covered |
| `refs/polaris/review/N/reviewed-base` | `merge-base(base, reviewed)` at that time |

### The interdiff

Verified in `sim/` with three updates to one PR:

| Update | `diff reviewed head` (naive) | Interdiff |
|---|---|---|
| A. one more commit (fast-forward) | f1.txt (correct) | same: `reviewed` is an ancestor of `head` and the merge base is unchanged, so `diff reviewed head` |
| B. author merges `main` into the PR | **f3.txt, upstream's change** (wrong) | **empty**: the author changed nothing |
| C. main moves, author rebases, squashes, tweaks one line, force-pushes | f2.txt **and** f3.txt (upstream noise) | exactly `-LINE7-pr / +LINE7-pr-v2` |

The rule:

```sh
old=reviewed; new=head
omb=reviewed-base; nmb=$(git merge-base base new)
if git merge-base --is-ancestor $old $new && [ $omb = $nmb ]; then
  diff $old $new                                                   # fast-forward
else
  T=$(git merge-tree --write-tree --merge-base=$omb $nmb $old)     # the old PR replayed on the new base
  diff $T $new                                                     # what the author changed since
fi
```

- `merge-tree --write-tree` (git ≥ 2.38, RelNotes 2.38.0) writes only objects, never touches any index or worktree, and exits non-zero on conflicts. `--merge-base` is git ≥ 2.40 (RelNotes 2.40.0). On a conflict, or on git < 2.40, fall back. The Daemon already maintains a private index for checkpoints (`GIT_INDEX_FILE`), and the same trick works here: `read-tree $nmb`, then `diff $omb $old | apply --cached --3way`, then `write-tree`. Failing that, run a full Risk Summary and say why ("the PR was rebased over conflicting changes").
- On vscode, replaying a 33-file PR onto `main` with merge-tree took 0.06 s.
- **range-diff** ([git-range-diff(1)](https://git-scm.com/docs/git-range-diff), git ≥ 2.19) pairs commits across versions. After C's squash it matched the new squashed commit to old commit 1 and listed commits 2 and 3 as dropped: accurate, but it is the wrong shape for a Risk Summary input. It is useful as a secondary "how the commits changed" view in the Review UI.
- Minimum git on likely Hosts: Debian 12 and Raspberry Pi OS bookworm ship git 2.39 (no `--merge-base`); Ubuntu 22.04 ships 2.34 (no `--write-tree`); Ubuntu 24.04 ships 2.43. These are distro facts from memory, not verified in this pass, and should be checked by the decision ticket. The fallback above is therefore not optional.

### Moving the checkout

- First `git -C <checkout> status --porcelain`. When it is clean: `git -c core.hooksPath=/dev/null -C <checkout> checkout -q --detach refs/polaris/review/N/head`. On vscode this took 0.18–0.35 s for nearby commits and 3.0 s for a jump of 20,000 commits.
- **Never update a dirty checkout implicitly.** A detached checkout of another commit *succeeded silently and carried an uncommitted edit along*, because it didn't conflict (verified, case D). The user would then be running "the new version" plus their stale local edit. When the checkout is dirty, show the files and offer the user (a) keep reviewing the old version, (b) discard the edits and update, or (c) leave it and open a new checkout. Untracked build output in ignored paths doesn't count as dirty (`status --porcelain` without `--ignored`).
- A running Agent Session or terminal in the checkout should also defer the update, as for removal (§5).
- After a successful summary: `update-ref refs/polaris/review/N/reviewed <new>` and `reviewed-base <nmb>`, in one `update-ref --stdin` transaction, as `prune.ts` already does for deletions.

## 5. Safe removal on merge or close

- **Knowing it merged or closed needs the forge.** The refs don't change on close (§2). Ancestry (`merge-base --is-ancestor head base`) catches only true merges, not squash or rebase merges, which GitHub defaults to in many repos. Use the PR API's `state`/`merged_at`. If no token is available, fall back to "the head SHA is reachable from the base branch" plus a manual "Remove" action.
- **Order of checks before removing** (each one blocks auto-removal and turns it into a prompt):
  1. An Agent Session (not Archived) whose `cwd` is inside the checkout, or a Polaris terminal whose cwd is inside it. The engine model has both.
  2. Modified or untracked files: `worktree remove` without `--force` refuses with "contains modified or untracked files, use --force to delete it" (verified). The existing `removeWorktree` already behaves this way.
  3. Commits made on the detached HEAD that are not on the PR head (`rev-list refs/polaris/review/N/head..HEAD` is non-empty). A detached HEAD's commits become unreachable on removal, so they are the one thing `worktree remove` silently loses. Offer "keep as branch `review/pr-N-local`" first.
- Then `worktree unlock`, `worktree remove` (no `--force`; ignored files such as `node_modules` are deleted with it, which is wanted), and `update-ref -d` of the four `refs/polaris/review/N/*` refs in one transaction. Leave object cleanup to git's own gc, as `prune.ts` does.
- If the directory was deleted by hand, `git worktree prune` cleans the registry ("gitdir file points to non-existent location"), but only for an unlocked worktree. The sweep should notice the locked-but-missing case and unlock and prune it.
- vscode: `worktree remove` took 2.25 s (deleting 574 MB).

## 6. Disk and time on a big repo

`microsoft/vscode`, full clone (183 s over the network), 1.51 GiB pack, 19,681 files, 575 MB working tree; Apple Silicon, APFS:

| Step | Time | Disk |
|---|---|---|
| `ls-remote origin refs/pull/N/head` | 0.57 s | — |
| fetch PR head + `main` (2 commits, 33 files, base 17 commits behind) | 1.36 s | a few KB |
| same fetch again, nothing new | 0.19 s | — |
| `worktree add --detach` | 4.30 s | **574 MB** working files + 2.7 MB `.git/worktrees/<name>` (index); objects shared |
| `status --porcelain` (cold / warm) | 0.45 / 0.43 s | — |
| checkout to `main` tip and back | 0.34 / 0.18 s | — |
| checkout 20,000 commits back | 2.98 s | — |
| merge-tree interdiff | 0.06 s | objects only |
| `worktree remove` | 2.25 s | frees 574 MB |

- A worktree shares the object store, so the cost is one full copy of the working tree per PR checked out. That is the dominant cost and it scales with the number of open Review Checkouts. Running the PR will also need its dependencies installed (vscode's `node_modules` is well over 1 GB), which git can't share. Keep one Review Checkout per PR, cap the count per Workspace, and show the disk use in the UI.
- A Pi 4 on an SD card will be several times slower on `worktree add` and remove; this was not measured here. Run them as background jobs with progress, never on a request path.
- Not pursued: sparse or partial checkouts (the point is to run the PR, so a full tree is needed), and APFS/reflink clones of the main worktree (the content differs, and it is not portable to ext4).

## 7. Several Hosts holding the same repo

- **Git-level: no conflict.** Every artefact (`refs/polaris/review/*`, `.review/` worktrees) is local to one clone and nothing is pushed. Two Hosts, or two clones on one Host, can each hold a Review Checkout of the same PR. The forge's `refs/pull/` is read-only to everyone.
- **Product-level: duplication and ambiguity.** ENG-185 says the checkout lives "on the Host holding the Workspace". With two such Hosts, something has to pick one. Recognise "the same repo" by the normalised remote URL of the base repo (from §2's remote matching). The root commit is a weaker signal because forks share it.
- Make Risk Summaries content-addressed: `(base repo, merge-base SHA, head SHA, summariser version)`, plus `(reviewed, head)` for an incremental one. A Client connected to several Hosts can then show a summary computed on Host A for a checkout on Host B. A Daemon could even skip recomputing, if summaries are ever synced; today they are per Daemon.
- Merge/close detection runs per Host with that Host's credentials. If only one Host has a forge token, the Client, which sees all Hosts, is the natural place to relay "PR closed".

## 8. Recommended shape (input for the decision tickets)

1. **`ReviewCheckouts` service** in `apps/daemon/src/git/`, beside `WorktreeTracker`:
   - `fetch(workspace, pr)`: remote match, then the §2 fetch with `--refmap=`, `credential.interactive=false` and BatchMode ssh.
   - `create`: `worktree add --detach` with hooks off, then lock.
   - `status`: dirty, extra commits, sessions inside.
   - `update`: clean-only checkout with hooks off.
   - `interdiff(reviewed, head)`: merge-tree, with the private-index fallback.
   - `remove`: the §5 checks, then unlock, remove and delete the refs.

   It reuses `runGit` and `removeWorktree`'s non-force semantics.
2. **`WorktreeTracker.parseWorktreeList` parses `locked`.** The engine maps `<worktreeRoot>/.review/*` paths, or the lock reason, to Review Checkouts instead of recording them as anonymous Worktrees.
3. **Lifecycle.** A Review Checkout has states (absent → fetching → ready → stale (new head) → updating → blocked (dirty / session inside) → removing) driven by forge events and user choices. Per AGENTS.md that belongs in an XState machine derived from folded events, not ad-hoc flags. It also crosses the event store, so check whether the Quint spec needs a model of it.
4. **Hooks off is a security invariant.** Test it with a PR that adds a husky `post-checkout`.

## Open questions for the decision tickets

- **Minimum git version on Hosts.** 2.38/2.40 for merge-tree vs the bookworm/22.04 reality. Either require ≥ 2.40, or ship the private-index fallback. (`credential.interactive` needs 2.47 but degrades harmlessly.)
- **Where the forge token comes from** for PR state and metadata: `git credential fill` (works for https users), `gh`, or a token the user gives Polaris. ENG-185's "Host's own git credentials" covers fetches but not the API calls that auto-removal and "new commits" detection need.
- **Polling policy** for new commits and close while idle (ETag polling cost vs the `idle` bench), versus only while a Client has the Review open.
- **Cap and disk budget** for Review Checkouts per Workspace, and whether dependency installs belong to the checkout's "Run" action.
- **Non-GitHub forges.** GitLab works with a different ref name and a 14-day expiry. Bitbucket Cloud needs source-repo access. Decide whether v1 is GitHub/GHE only.
- **Agent Session Turns under Review:** the same detached-worktree mechanics apply to `refs/polaris/checkpoints/<session>/<turn>/after`, but checkpoint pruning must then treat a ref with a Review Checkout on it as pinned.

## Sources

- git manual pages (git 2.54.0): [git-fetch](https://git-scm.com/docs/git-fetch), [git-worktree](https://git-scm.com/docs/git-worktree), [git-merge-tree](https://git-scm.com/docs/git-merge-tree), [git-range-diff](https://git-scm.com/docs/git-range-diff), [git-config](https://git-scm.com/docs/git-config) (`core.hooksPath`, `core.sshCommand`, `credential.interactive`), [git(1)](https://git-scm.com/docs/git) (`GIT_TERMINAL_PROMPT`).
- git release notes (`Documentation/RelNotes/` in [git/git](https://github.com/git/git/tree/master/Documentation/RelNotes)): 2.19.0 (range-diff), 2.29.0 (`--no-write-fetch-head`), 2.38.0 (merge-tree write-tree mode), 2.40.0 (`--merge-base`), 2.47.0 (credential helpers and non-interactive use).
- [GitHub Docs: checking out pull requests locally](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-locally); [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) (conditional requests).
- [GitLab: merge request troubleshooting](https://docs.gitlab.com/user/project/merge_requests/merge_request_troubleshooting/) (MR head ref retention).
- Bitbucket Cloud PR refs: [Atlassian community](https://community.atlassian.com/forums/Bitbucket-questions/Bitbucket-Cloud-Checking-out-pull-requests-locally/qaq-p/738207) (secondary).
- Polaris: `apps/daemon/src/git/README.md`, `git.ts`, `WorktreeTracker.ts`, `prune.ts`, `apps/daemon/src/engine/worktrees.ts`, `decider.ts`, `apps/daemon/src/service/README.md`.
- Experiments: scratch scripts run 2026-10-01 against a local forge simulation, `octocat/Hello-World`, `cli/cli` and `microsoft/vscode`; all numbers above are from those runs.
