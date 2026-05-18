# PREVIEW EXPORT AUDIT

Date: 2026-05-18

## Scope
- preview runner/manager flow
- local and docker runtime paths
- install/build/start handling
- export pipeline and failure handling

## Preview Reality
- Preview control plane is implemented with start/stop/status/validate routes.
- Manager supports docker flow and local fallback flow.
- Probe and lifecycle diagnostics are detailed and persisted.

## Strengths
1. Clear staged preview lifecycle (preflight, build, run, probe, content health).
2. Local fallback path prevents total preview outage in some docker-failure scenarios.
3. Probe recorder and step traces are strong for debugging.

## Risks
1. High: watchdog budget mismatch can timeout legitimate slow fullstack boots.
2. High: auth header/cookie forwarding from preview proxy to generated app runtime (security risk).
3. Medium: export success metric increments before stream completion confirmation.
4. Medium: snapshot files are mostly last-write-wins, limiting concurrent forensic fidelity.
5. Medium: temporary `--legacy-peer-deps` fallback can hide dependency debt.

## Export Reality
- Export route exists and includes path-safety behavior and ZIP streaming.
- Export is functionally real, but operational metrics and readiness gating semantics are only partial.

## Status Summary
- Preview existence: Real.
- Preview reliability: Partial.
- Preview security hardening: Broken (header forwarding).
- Export function: Real.
- Export operational correctness/telemetry: Partial.
