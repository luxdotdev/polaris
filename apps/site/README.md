# @polaris/site

The marketing site at polaris.lux.dev: Next.js (App Router, Turbopack) on Vercel.

- **Design:** the Paper "Marketing site" page (S1 desktop dark, S2 light, S3 mobile) and DESIGN.md's Marketing site section. Colours are `@polaris/ui` tokens plus the site palette in `app/globals.css`; the site follows the system appearance.
- **Assets:** product shots, scenes, pixel icons and washes are imported straight from `design/assets/`, never copied or redrawn. `next.config.ts` sets the Turbopack and tracing roots to the monorepo so those imports resolve.
- **Routes:** `/` is static. `/download/mac` and the update feed (`app/download`, `app/api`) are built in ENG-259.

```sh
bun run --cwd apps/site dev     # http://localhost:3000
bun run --cwd apps/site build
```

**Vercel:** root directory `apps/site`, framework Next.js, with "Include files outside the root directory" on (the default for monorepos), since the site reads `packages/ui` and `design/assets`.

`next dev` writes the `AGENTS.md` here (Next's agent rules); keep it committed.
