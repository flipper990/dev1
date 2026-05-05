# Generation Report — Social Media Platform

## Outcome

**Preview: WORKING** ✅ — `http://localhost:11912/` returns HTTP 200 (also proxied at `http://localhost:3003/preview/IUzEDmcmmFYW/`).

## Generation Summary

| Field | Value |
|---|---|
| Project ID | `IUzEDmcmmFYW` |
| Project name | `SocialSphere` |
| Stack | Next.js 15 + Tailwind + Lucide |
| Files generated | 55 |
| Total tokens | 107,368 |
| Total cost | $0.78 USD |
| Pipeline duration | 205.9s (≈3:26) |
| Pipeline status (on disk) | `failed` (runtime-validator verdict — superseded by manual fixes) |

Pipeline phases all ran: spec (gpt-4.1) → builder (gpt-5.3-codex) → qa → polish → runtime-validator.

## Issues Encountered & Fixes

All four issues are infrastructure-class problems with how LLM-generated Next.js projects build inside Docker. Three are now permanently fixed in the preview Dockerfile generator. One was project-specific.

### 1. npm peer-dep storm (FIXED in `dev-dockerfiles.ts`)
`react@19.0.0` against `next@15.0.0` (peer accepts only `^18.2.0` or `19.0.0-rc-…`) → `ERESOLVE`. **Fix:** added `--legacy-peer-deps` to all install steps (npm ci, npm install, the `serve@14` install for static stacks).

### 2. Missing `@types/react` / `@types/node` (FIXED)
Generated `package.json` ships `tsconfig.json` but no TS type packages → Next dev refuses to boot with `FatalError: It looks like you're trying to use TypeScript but do not have the required package(s) installed`. **Fix:** belt-and-braces install at Docker build time:
```
RUN npm install --legacy-peer-deps --no-audit --no-fund --no-save \
    typescript @types/react @types/node autoprefixer postcss tailwindcss
```
plus a runtime guard in `nextDevCommand()` that re-installs if missing.

### 3. Missing `autoprefixer` / `postcss` (FIXED in same RUN as #2)
Generated `postcss.config.js` references `autoprefixer` but `package.json` omits it → Next CSS pipeline crashes with `Cannot find module 'autoprefixer'`.

### 4. Duplicate App Router (project-specific cleanup)
Builder agent emitted both `app/` and `src/app/` directories. Next 15 prefers root `app/` and ignores `src/app/`; since root `app/` was empty (just a stray `globals.css`) every route returned 404. Combined with stray `lib/` and `components/` dirs at root.
**Fix:** removed `app/`, `components/`, `lib/` from the project root, keeping the canonical `src/app/`. Re-added a minimal `lib/design-tokens.ts` because `tailwind.config.ts` (also stray) imports `./lib/design-tokens`.

## Files Changed in the Workspace

- [apps/api/src/preview/dev-dockerfiles.ts](apps/api/src/preview/dev-dockerfiles.ts) — added `--legacy-peer-deps`, build-time install of common Next deps, runtime fallback for missing TS/postcss deps.
- [data/projects/IUzEDmcmmFYW/output/lib/design-tokens.ts](data/projects/IUzEDmcmmFYW/output/lib/design-tokens.ts) — recreated (project-specific).

## Verification

```
GET http://localhost:11912/                           → 200, 25,699 bytes
GET http://localhost:3003/preview/IUzEDmcmmFYW/       → 200, 25,699 bytes (proxy)
GET http://localhost:3003/api/projects/IUzEDmcmmFYW/preview/status
  → state=ready, hostPort=11912, uptimeMs growing
```

Container is serving a styled (Tailwind classes resolved, `class="dark"`) page with the `SocialSphere` layout.

## Caveats / Known Gaps

- The builder agent only produced `src/app/page.tsx` and `src/app/layout.tsx` for the actual route surface. Multi-page features (feed, profile, discover, notifications, follow flow) requested in the prompt are **not implemented as routes** — only UI primitives in `src/components/ui/`. Preview boots and renders cleanly but the app is essentially a landing page. This is a builder-agent completeness issue, not a preview issue.
- Persisted project status is `failed` because the pipeline's own runtime-validator hit the same Docker issues we fixed manually. Future runs (post-Dockerfile fix) should let the validator pass.
- Recommend rerunning generation now that the Dockerfile fixes are in place — the on-disk Dockerfile produced for new projects will incorporate them, the runtime-validator will likely succeed, and `status` will end as `completed`.

## Next Steps (optional)

1. Re-run generation with the same prompt to confirm the runtime-validator now passes end-to-end.
2. Improve the builder agent's route-completeness prompt so multi-page apps actually emit `src/app/<route>/page.tsx` for each requested screen.
3. Add a builder-side guard against emitting both `app/` and `src/app/` simultaneously (or strip the duplicate at write-time).
