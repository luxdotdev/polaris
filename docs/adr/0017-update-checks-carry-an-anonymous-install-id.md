# Update checks carry an anonymous install ID

The Desktop App asks Polaris's own update feed (a route on the marketing site, recorded in Axiom) rather than `update.electronjs.org`, and each check sends a random install ID made on first launch along with the version, arch and macOS version. That ID is the only way to count active installs and how fast a Release is adopted, and it is tied to nothing else: no account, Host, Workspace or IP (the country is derived, then the IP dropped). Turning off "Check for updates automatically" in Settings stops the checks and the ID with them. What Polaris sends is listed in Settings → About and on the site. Wider product telemetry (OTel) will be a separate opt-out, not folded into this.

## Considered Options

- `update.electronjs.org`: no code to run, but no analytics and no control over what is offered.
- Request-level counts only (no ID): downloads and the version spread, but not active installs.
