# SecureStorage (main process)

The Desktop App's secrets at rest, on macOS, Windows and Linux (ENG-290). Decisions: ADR 0040 (Q17), ADR 0044.

| File | What |
|---|---|
| `index.ts` | The `SecureStorage` service: `available`, `get`, `set`, `delete` by namespaced key. Layers `files`, `memory`, `unavailable`. |
| `model.ts` | `SecretKey` (`<namespace>/<name>…`), the errors (`SecureStorageUnavailable` with its `reason`, `SecureStorageError`), the `Sealer` interface and `backendOf` (Linux `basic_text` → `plaintext-backend`). |
| `files.ts` | One sealed file per key, `<dir>/<namespace>/…/<name>.bin`, written atomically and sealed again when the OS key rotated; adopts older sealed directories once by renaming them. |
| `electron.ts` | `safeStorage` (async API) as the sealer, and `secureStorageLayer(userData, adopt)` at `<userData>/secure`. The only file that imports `safeStorage`. |
| `secure.testing.ts` | `testSealer` (base64 behind a prefix, refusing anything else), `testSealed`, `withUserData`. |

Namespaces in use: `github/tokens/<id>` (GitHub's access and refresh tokens; adopted from `<userData>/github/tokens/`) and `languages/client-proof` (the language identity proof; adopted from the POSIX `language-private/` file, which stays the store on Linux without a keyring).

Consumers take a `SecureStorage` Layer; Main builds the service once and hands it to each consumer. Tests use `SecureStorage.memory`, or `files` with `testSealer` when they need a restart or the files on disk.
