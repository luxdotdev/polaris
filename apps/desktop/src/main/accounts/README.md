# Polaris accounts (main process)

The Desktop App's Polaris accounts for sharing (ENG-944, ADR 0112), on `@polaris/client`'s
`Accounts` (`packages/client/src/accounts`). The Account Server's contract is
`apps/accounts/README.md`.

| File | What |
|---|---|
| `index.ts` | `DesktopAccounts`: sign-in, the view Settings shows, and the `Accounts` layer it builds on (both are in the Client runtime, so sharing can call `Accounts` directly). |
| `loopback.ts` | The sign-in return: a one-use listener on `127.0.0.1` (RFC 8252 §7.3), open only while one sign-in runs, 10 minutes at most. |
| `store.ts` | `<userData>/accounts/accounts.json` (nothing secret) and each session token in `SecureStorage` as `accounts/tokens/<id>`. |
| `avatars.ts` | Avatars fetched here (the renderer's CSP blocks remote images), as data URLs under `<userData>/accounts/avatars/`. |
| `ipc.ts` | `accounts.*` requests and the `accounts` feed. Tokens never cross the bridge. |

Sign-in opens `{server}/sign-in` in the system browser with a PKCE challenge; the server
sends the browser back to the loopback with a one-use code, which is traded for the session
token. "Use a code instead" runs the device flow. Nothing runs until there is an Account: at
launch each signed-in Account is read once from its server, and there is no polling.
