# Managed web and data languages

The catalog offers JSON, CSS/SCSS/Less, HTML, YAML, GitHub Actions, Prisma and Svelte through the existing managed installation and private Node authorities. Each npm archive is pinned by upstream npm SHA512 and verified SHA256. The frozen dependency locations retain nested versions and licences. No npm executable, lifecycle script or runtime dependency resolution runs during installation. Jiti filesystem caching is disabled so config loading cannot mutate the private installation receipt.

JSON associates package.json and tsconfig.json/tsconfig.*.json with SchemaStore URLs. Those schemas require network access; the extracted server does not ship their schema bytes. YAML disables its automatic SchemaStore catalog, retains syntax validation and explicit schemas, and shares workflow files with Actions. Automatic Actions selection applies only to `.github/workflows/*.yml` and `*.yaml`. Actions owns workflow semantics; YAML owns structure and explicit schemas. The existing diagnostic feed labels each provider.

Before Trust, Svelte uses its bundled compiler and the upstream `isTrusted: false` initialization option to suppress project config and preprocessors. Prisma's pinned `PrismaSchema.load` receives the managed installation as its config root through the receipted preload. After Trust both use project config; Svelte resolves the project compiler. Both reuse the existing Workspace Trust ask, revisions, replacement and revocation fences.

The existing project formatting RPC selects a discovered formatter after Trust when it supports the file. JSON, CSS/SCSS/Less, HTML and YAML work with Prettier. Otherwise formatting falls back to the language server; Actions has no formatter ownership.

`webLanguageSmoke.ts` creates an isolated Electron profile and fixture repository. It verifies feature responses, source-labelled diagnostics, workflow diagnostic uniqueness, hostile config/compiler sentinels before Trust, their execution after Trust, project formatting and Settings in both themes and all densities. Run it with Node after building the Desktop App. `POLARIS_SMOKE_KEEP=1` retains the fixture for inspection.
