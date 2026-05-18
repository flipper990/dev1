# Orchestration Validation

## Objective
Validate whether orchestration is real, partially real, or mocked.

## What is Real
- Mission creation endpoint (`POST /api/projects`) is real and returns real IDs.
- Session tracking endpoints are real:
  - `/api/sessions/:id/progress`
  - `/api/sessions/active`
- Runtime debug telemetry is real:
  - `/debug/runtime` shows live active generation records.

## What is Broken
- Session progression can deadlock at:
  - `status=active`
  - `progress=0`
  - `currentStep=Specification`
  - no transition for 60-120s+.
- Multiple active generations accumulate in debug runtime with `phase=init`, `step=runReserved`.

## What is Not Mocked (but still failing)
- Failure mode is not fake UI-only:
  - backend endpoints report active sessions
  - project remains generating in persisted API state
  - preview start fails due missing generated files

## Provider/Runtime Evidence
- `/api/llm/providers` -> OpenAI registered
- `/api/llm/providers/health` -> `openai=false`

Inference:
- Orchestration infra exists, but model execution path is unhealthy/unavailable in this environment.

## Verdict
- Orchestration system classification: **PARTIAL REAL (execution broken)**.
