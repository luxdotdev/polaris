# The Desktop App builds its renderer with Vite and its main process with Bun.build

The renderer is built by Vite 8 (with `@vitejs/plugin-react`, the React Compiler through `@rolldown/plugin-babel`, and `@tailwindcss/vite`); the main process and the preload are bundled by `Bun.build` (ESM main, CommonJS preload, `electron` external). `scripts/dev.ts` runs Vite's dev server for hot reload and rebuilds and restarts the main process when its sources change.

## Why

- electron-vite 5, the usual wrapper, supports Vite 5–7 only, and the ENG-184 spike measured the stack on Vite 8 with plugin-react 6's compiler preset.
- The main process is plain TypeScript over workspace packages (`@polaris/client`, `@polaris/protocol`, Effect). Bun already builds the Daemon; `Bun.build` bundles the main process in well under a second with no extra dependency.
- Everything but `electron` is bundled, so the unpacked `Polaris.app` needs no `node_modules`.

## Consequences

- Two build tools instead of one wrapper; `scripts/lib/build.ts` holds both steps.
- The sandboxed preload must stay CommonJS and may import only `electron` and type-only modules.
