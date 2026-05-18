# FEATURE REALITY MATRIX

Date: 2026-05-18
Status legend: Real | Partial | Broken | Placeholder | Unknown

| Area | Status | Evidence Summary |
|---|---|---|
| API boot + health route | Real | Fastify app/server wiring is present and testable. |
| Auth core routes (signup/signin/refresh/signout/session/profile) | Real | Route set implemented; targeted auth tests passed in subagent runs. |
| Auth security hardening completeness | Partial | Cookie/CSRF/token flow exists; some production-hardening gaps remain (rate limiter and env edge cases). |
| Project creation endpoint | Real | `POST /api/projects` and alias routes wired to reservation flow. |
| Session progress API + websocket | Real | Poll and WS progress endpoints implemented and used by web. |
| Generation orchestration pipeline | Real | Core multi-step pipeline exists with contracts and diagnostics. |
| Generation quality fidelity consistency | Partial | Fallback/degraded paths can report success with reduced fidelity. |
| Deterministic contract/integrity checks | Real | Explicit gates exist in pipeline for contract/dependency/import/final integrity. |
| Terminal state consistency | Partial | Logic exists and tested, but runtime application path confidence is mixed. |
| Preview start/stop/status | Real | API + manager paths implemented. |
| Preview reliability under slow/cold/fullstack boot | Partial | Timeouts/watchdog settings may cause false negatives. |
| Preview proxy security posture | Broken | Proxy currently forwards auth headers/cookies upstream to generated runtime. |
| Export ZIP endpoint | Real | Export path exists with safety checks and archive stream. |
| Export metrics correctness | Partial | Success counter may increment before stream completion. |
| Web workspace shell | Real | Core shell and workspace pages/components exist. |
| Web UX completeness for core mission flow | Partial | Core path exists but some dead/rough interactions remain. |
| Web routes with explicit placeholders | Placeholder | Deployments, billing, settings, request-demo, waitlist, docs search, some auth surface controls. |
| UI consistency and design-system baseline | Real | Tokenized theme + reusable UI primitives in place. |
| Root test command reliability | Broken | Root `test` currently gives false green due missing workspace tasks. |
| Root type-check reliability | Broken | Root `type-check` currently gives false green due missing workspace tasks. |
| Root lint reliability | Broken | Fails due missing API eslint dependency path. |
| API build/typecheck state | Broken | QA agent reported active TS build errors. |
| E2E canary reliability | Broken | Latest canary failed on EPERM mkdir + 404/403 timeout pattern. |
| DB preflight | Real | DB preflight passed in subagent run with migrations check OK. |
| Docker runtime observability confidence | Partial | One subagent had local docker daemon permission limitation. |
| Reporting freshness consistency | Partial | Current and archived reports contain conflicting reliability snapshots. |
