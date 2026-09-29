# Plan Limits

Reports each Harness's Plan Limits (the five-hour and weekly windows: used %, resets at, observed at) using only what the Harness itself exposes. Polaris never reads a credential ([ADR 0001](../../../../../docs/adr/0001-polaris-never-touches-provider-credentials.md)). Linear ENG-206; decisions in ENG-199 (Q19, Q22, Q25); research in `docs/research/usage-sources.md`. Capability `usage`, stream `usage.watch`.

| File | Role |
|---|---|
| `PlanLimits.ts` | The `PlanLimits` service: the last known value per (`harness`, `kind`, `scope`), its changes, and `~/.polaris/plan-limits.json`. `PlanLimitSink` is what drivers get: a synchronous `report(limits)`. |
| `claude.ts` | Schemas for the Agent SDK's `get_usage` reply and `rate_limit_event` message, and their mapping to `PlanLimit`s. |
| `codex.ts` | Schemas for app-server's `account/rateLimits/read` and `account/rateLimits/updated`, their mapping, `CodexLimitTracker` (merges sparse updates), and the rollout-log reader. |
| `rollout.ts` | `latestRolloutLimits`: the last `token_count.rate_limits` in the newest rollout file under `$CODEX_HOME/sessions`. |
| `PlanLimitRpcs.ts` | `usage.watch` (every known Plan Limit, then each change, as `PlanLimitChanged`) and a `usage.query` that answers "not indexed yet". |

The drivers feed it: `../claude/planLimits.ts` and `../codex/planLimits.ts`, wired through `../registry.ts`.

## Sources, and which are credential-free

| Harness | Source | When | Credential-free? | Used |
|---|---|---|---|---|
| Claude | Agent SDK `rate_limit_event` messages | During every Turn, on the live `query()` | Yes: the `claude` binary reads its own sign-in and forwards the API's rate-limit headers | Yes |
| Claude | Agent SDK `get_usage` (`query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`) | When a session opens, and after a Turn if the last answer is ≥ 5 min old | Yes: a control request to the `claude` child, which calls claude.ai itself | Yes, behind a capability check (the method must exist; a failure or an unknown shape means no value) |
| Claude | Statusline stdin JSON (`rate_limits`) in our In Terminal `--settings` | While In Terminal | Yes | **Not yet** (see Gaps) |
| Claude | `claude` in a PTY sending `/usage` | Any time | Yes, but starts a throwaway session | No: ENG-206 rules out probing |
| Claude | OAuth token from the Keychain / `~/.claude/.credentials.json` → `api.anthropic.com/api/oauth/usage`; claude.ai browser cookies | Any time | **No** | Never (ADR 0001) |
| Codex | app-server `account/rateLimits/read` | When a session connects to the shared app-server | Yes: app-server answers from its own sign-in | Yes |
| Codex | app-server `account/rateLimits/updated` notifications | During Turns | Yes | Yes |
| Codex | Rollout logs: `event_msg` `token_count` with `rate_limits` | On the first `usage.watch` / ask, once per Daemon | Yes: Codex's own session logs, no auth data | Yes, as the last known value before any session |
| Codex | `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`; chatgpt.com cookies | Any time | **No** | Never (ADR 0001) |
| OpenCode | Retry / error info when a request is refused | Only when refused | Yes | Not yet: the OpenCode driver doesn't exist (ENG-199 Q10) |

## Readings

Measured on this Mac (Claude Code 2.1.284 with SDK 0.3.283, Max plan; codex-cli 0.158.0, Pro Lite plan); the replies are the fixtures in `fixtures/`.

- **`get_usage`** answers in about 1 s with no Turn needed. `rate_limits.limits[]` holds the server's rows (`session`, `weekly_all`, `weekly_scoped` with a Model name, each with `percent` 0–100 and a `severity`); they are read first, classified on `kind`. Older CLIs send only the named windows (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `model_scoped[]`), read as the fallback. `rate_limits_available: false` (API key, Bedrock, Vertex) means no Plan Limits. A `warning` or `critical` severity is `warning`; 100 % is `reached`.
- **`rate_limit_event`** names one window (`rateLimitType`) with its `status` (`allowed` → ok, `allowed_warning` → warning, `rejected` → reached). Utilization is a **0–1 fraction** (`0.16` is 16 %), resets are epoch seconds, and current CLIs add `unifiedWindows` with every window's utilization. `seven_day_overage_included` carries no Model name; it takes the first `model_scoped` name `get_usage` gave, and is dropped until one has. `overage` is spend, not a Plan Limit, and is ignored.
- **Codex** `primary`/`secondary` are positions, not durations: the kind comes from `windowDurationMins` (300 → `five-hour`, 10080 → `weekly`, ≥ 28 days → `monthly`). Without one, paid plans are five-hour/weekly and free/go monthly. Pro Lite has a weekly window only. Limit ids other than `codex` (a Model's own quota) are scoped limits named by `limitName`. `account/rateLimits/updated` is sparse: a null field keeps the last read's value.
- Resets from `get_usage` jitter below a second between calls, so Claude resets are rounded to the second.

## Keeping values current, and their age

- Every `PlanLimit` carries `observedAt`. A new reading replaces the stored one unless it is older. Clients hear about it when the value changed, or when the same value is confirmed and the last announcement is at least a minute old (`REANNOUNCE_AFTER_MS`), so the age they show is never more than a minute stale while a session runs.
- With no session of a Harness running, the last known value stays, with its `observedAt`. It is persisted on every change (written to a temp file, then renamed; mode 0600), so a restarted Daemon still has it.
- The Codex rollout seed runs once, on the first `usage.watch` or `current`, and never replaces a newer value.

## Cost

- **No timers, no watchers, no polling.** Values arrive with Agent Sessions (SDK messages, app-server notifications, one read at open). `get_usage` runs at most once per session open plus once per Turn end if the last answer is ≥ 5 min old.
- The layer reads `plan-limits.json` once at start. The rollout seed stats at most 7 day directories and reads the last 512 KiB of one file, once per Daemon.
- The mappers import neither the Agent SDK nor the Codex bindings, so an idle Daemon loads neither (drivers still load on first use).
- `bun run bench idle cold-start --runs 3 --compare …/mac14-13-apple-m2-max-12c.json`: no regression (idle wakeups 9.3/s against 10.6/s, footprint +1.2 %).

## Verifying nothing touches a credential

- The code reads nothing but the Harnesses' programmatic answers, Codex's rollout logs and its own `plan-limits.json`. `rg -i 'credentials|auth\.json|keychain|oauth|cookie|api\.anthropic|chatgpt\.com'` over this folder and the two `planLimits.ts` files finds nothing but a field name in a fixture.
- `scripts/e2e-plan-limits.ts` (`POLARIS_E2E_PLAN_LIMITS=1`, one tiny Turn per Harness) runs the real Daemon and, while both sessions are live, records the Daemon process's open files (`lsof -p`: no credential file), its sockets (`lsof -a -p -i`: only the loopback listener for Claude's In Terminal hooks, no outbound connection) and its children (only `claude`; app-server is detached). The Harness processes read their own sign-in, which is theirs to do.

## Gaps

- **Statusline while In Terminal.** A `statusLine` in our `--settings` would keep Claude's limits fresh while the TUI owns the session, but it replaces the user's own statusline, and chaining to theirs means reading their settings file, which may hold an `apiKeyHelper` or keys in `env`. Left for a decision; until then, a Claude session In Terminal leaves the last value (with its age).
- **`usage.query`** answers with no buckets and `indexedAt: null` until the Usage index (ENG-205) lands; ENG-205 also merges its `UsageChanged` items into `usage.watch`.
- **Stale windows.** A window whose `resetsAt` has passed is still shown as last seen; Clients should read it as reset.
