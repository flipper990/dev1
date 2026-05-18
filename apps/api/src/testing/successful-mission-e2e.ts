import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMissionFailureDiagnostics } from './mission-failure-diagnostics.js';
import { evaluateMissionTerminalSync } from './mission-terminal-sync.js';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3003';
const MIN_SUCCESS_MISSIONS = Number.parseInt(process.env.MIN_SUCCESS_MISSIONS ?? '1', 10);
const MISSION_TIMEOUT_MS = Number.parseInt(process.env.MISSION_TIMEOUT_MS ?? String(30 * 60 * 1000), 10);
const PREVIEW_TIMEOUT_MS = Number.parseInt(process.env.PREVIEW_TIMEOUT_MS ?? '180000', 10);
const POLL_MS = Number.parseInt(process.env.POLL_MS ?? '3000', 10);
const REPEAT_CYCLES = Math.max(1, Number.parseInt(process.env.REPEAT_CYCLES ?? '1', 10));

const RELIABILITY_TIERS = {
  tier1: [
    'Build a simple startup landing page with hero and CTA.',
    'Build a simple dashboard with sidebar, KPIs, and recent activity list.',
  ],
  tier2: [
    'Build a multi-page SaaS app with landing, pricing, and contact pages.',
    'Build a CRUD tasks app with list/add/edit/delete and search.',
  ],
  tier3: [
    'Build an auth dashboard with login, signup, and profile settings.',
    'Build a full-stack app with API routes and frontend data fetching.',
    'Build an API-connected app that fetches and displays external data with retries.',
  ],
} as const;

const prompts = (() => {
  const raw = process.env.PROMPTS_JSON;
  if (!raw) {
    return [
      ...RELIABILITY_TIERS.tier1,
      ...RELIABILITY_TIERS.tier2,
      ...RELIABILITY_TIERS.tier3,
    ];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    }
  } catch {
    // ignored
  }
  return [
    ...RELIABILITY_TIERS.tier1,
    ...RELIABILITY_TIERS.tier2,
    ...RELIABILITY_TIERS.tier3,
  ];
})();

const authHeaders: Record<string, string> = {
  'x-devteam-user-id': process.env.DEV_USER_ID ?? 'dev-user',
  'x-devteam-user-email': process.env.DEV_USER_EMAIL ?? 'dev@local.test',
  'x-devteam-workspace-id': process.env.DEV_WORKSPACE_ID ?? 'dev-workspace',
  'x-devteam-role': process.env.DEV_USER_ROLE ?? 'owner',
};

interface MissionResult {
  index: number;
  tier: 'tier1' | 'tier2' | 'tier3' | 'custom';
  prompt: string;
  projectId: string | null;
  sessionId: string | null;
  status: 'pass' | 'fail';
  reason?: string;
  failureCategory?: string | null;
  failurePhase?: string | null;
  failureReason?: string | null;
  failedAgent?: string | null;
  failedStep?: string | null;
  retryCount?: number;
  lastValidCheckpoint?: string | null;
  filesGeneratedBeforeFailure?: number;
  recoveryAttempted?: boolean;
  recommendedNextAction?: string | null;
  zeroFileClassification?: string | null;
  durationMs: number;
  filesCount: number;
  previewState: string | null;
  previewUrl: string | null;
  exportOk: boolean;
  exportState?: 'ok' | 'not_attempted' | 'failed';
  retriesObserved: number;
  phasesSeen: string[];
}

interface RuntimePreflight {
  ok: boolean;
  reason: string | null;
  providerPreflight?: {
    ok: boolean;
    providers: Record<string, { healthy: boolean; reason: string }>;
  };
}

interface ArtifactsCountResult {
  count: number;
  verified: boolean;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T; raw: string }> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  for (const [k, v] of Object.entries(authHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const raw = await response.text();
  let body: T;
  try {
    body = (raw ? JSON.parse(raw) : {}) as T;
  } catch {
    body = {} as T;
  }
  return { status: response.status, body, raw };
}

async function startMission(prompt: string): Promise<{ projectId: string; sessionId: string }> {
  const res = await jsonRequest<{ projectId?: string; sessionId?: string; project?: { id?: string }; pipeline?: { sessionId?: string }; error?: string }>(
    '/api/projects',
    {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    },
  );
  if (res.status !== 202) {
    throw new Error(`mission create failed: status=${res.status} body=${res.raw.slice(0, 400)}`);
  }
  const projectId = res.body.projectId ?? res.body.project?.id;
  const sessionId = res.body.sessionId ?? res.body.pipeline?.sessionId;
  if (!projectId || !sessionId) {
    throw new Error(`mission create missing IDs: ${res.raw.slice(0, 300)}`);
  }
  return { projectId, sessionId };
}

async function waitMission(projectId: string, sessionId: string): Promise<{
  project: any;
  retriesObserved: number;
  phasesSeen: string[];
  sessionProgress: any | null;
}> {
  const started = Date.now();
  let deadlineAt = started + MISSION_TIMEOUT_MS;
  let retriesObserved = 0;
  const phasesSeen = new Set<string>();
  let lastSessionProgress: any | null = null;
  let terminalSessionAt: number | null = null;
  let timeoutExtensions = 0;
  const maxExtensions = 3;
  let consecutiveProjectNotFound = 0;
  let consecutiveSessionForbidden = 0;

  while (Date.now() < deadlineAt) {
    const projectRes = await jsonRequest<any>(`/api/projects/${projectId}`);
    if (projectRes.status === 200) {
      consecutiveProjectNotFound = 0;
      const project = projectRes.body;
      const phase = project?.progress?.executionPhase ?? project?.progress?.phase;
      if (typeof phase === 'string' && phase.length > 0) phasesSeen.add(phase);
      if (project?.status && project.status !== 'generating') {
        return { project, retriesObserved, phasesSeen: [...phasesSeen], sessionProgress: lastSessionProgress };
      }
    } else if (projectRes.status === 404) {
      consecutiveProjectNotFound += 1;
    }

    const sessionRes = await jsonRequest<any>(`/api/sessions/${sessionId}/progress`);
    if (sessionRes.status === 200) {
      consecutiveSessionForbidden = 0;
      lastSessionProgress = sessionRes.body;
      const retryAttempt = Number(sessionRes.body?.retryAttempt ?? 0);
      if (Number.isFinite(retryAttempt)) retriesObserved = Math.max(retriesObserved, retryAttempt);
      const executionPhase = sessionRes.body?.executionPhase;
      if (typeof executionPhase === 'string' && executionPhase.length > 0) phasesSeen.add(executionPhase);
      const sessionStatus = String(sessionRes.body?.status ?? '').toLowerCase();
      if (sessionStatus === 'failed' || sessionStatus === 'completed') {
        terminalSessionAt = terminalSessionAt ?? Date.now();
      } else {
        terminalSessionAt = null;
      }
    } else if (sessionRes.status === 403) {
      consecutiveSessionForbidden += 1;
    }

    if (consecutiveProjectNotFound >= 2 && consecutiveSessionForbidden >= 2) {
      throw new Error(
        `project persistence failed: project=${projectId} remained 404 while session=${sessionId} remained 403 ` +
        '(likely reservation save failure in project-store)',
      );
    }

    if (terminalSessionAt) {
      const terminalSessionAgeMs = Date.now() - terminalSessionAt;
      const projectRes = await jsonRequest<any>(`/api/projects/${projectId}`);
      if (projectRes.status === 200) {
        const decision = evaluateMissionTerminalSync({
          projectStatus: String(projectRes.body?.status ?? 'generating'),
          sessionStatus: String(lastSessionProgress?.status ?? ''),
          terminalSessionAgeMs,
        });
        if (decision.returnSnapshot) {
          return {
            project: projectRes.body,
            retriesObserved,
            phasesSeen: [...phasesSeen],
            sessionProgress: lastSessionProgress,
          };
        }
      }
    }

    const now = Date.now();
    if (now + POLL_MS >= deadlineAt && timeoutExtensions < maxExtensions) {
      const projectHeartbeat = Date.parse(String(projectRes.body?.progress?.lastProgressAt ?? ''));
      const sessionHeartbeat = Date.parse(String(lastSessionProgress?.lastHeartbeatAt ?? ''));
      const freshest = Math.max(
        Number.isFinite(projectHeartbeat) ? projectHeartbeat : 0,
        Number.isFinite(sessionHeartbeat) ? sessionHeartbeat : 0,
      );
      const activeProgress = freshest > 0 && (now - freshest) <= 120_000;
      if (activeProgress) {
        deadlineAt += 5 * 60 * 1000;
        timeoutExtensions += 1;
      }
    }

    await sleep(POLL_MS);
  }

  const lastSessionStatus = String(lastSessionProgress?.status ?? 'unknown');
  const lastExecutionPhase = String(lastSessionProgress?.executionPhase ?? 'unknown');
  const lastFailureReason = String(lastSessionProgress?.failureReason ?? 'missing explicit error');
  throw new Error(
    `mission timeout after ${deadlineAt - started}ms (sessionStatus=${lastSessionStatus}; executionPhase=${lastExecutionPhase}; failureReason=${lastFailureReason})`,
  );
}

async function verifyArtifacts(projectId: string): Promise<number> {
  const files = await jsonRequest<Array<{ path: string }>>(`/api/projects/${projectId}/files`);
  if (files.status !== 200) {
    throw new Error(`artifact listing failed: status=${files.status}`);
  }
  return Array.isArray(files.body) ? files.body.length : 0;
}

async function safeArtifactsCount(projectId: string): Promise<ArtifactsCountResult> {
  try {
    const count = await verifyArtifacts(projectId);
    return { count, verified: true, error: null };
  } catch (err) {
    return {
      count: -1,
      verified: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function waitPreview(projectId: string): Promise<{ state: string | null; url: string | null }> {
  const startRes = await jsonRequest<any>(`/api/projects/${projectId}/preview/start`, { method: 'POST' });
  if (startRes.status !== 200 && startRes.status !== 202) {
    throw new Error(`preview start failed: status=${startRes.status} body=${startRes.raw.slice(0, 300)}`);
  }

  const started = Date.now();
  let lastState: string | null = null;
  let lastUrl: string | null = null;
  while (Date.now() - started < PREVIEW_TIMEOUT_MS) {
    const statusRes = await jsonRequest<{ state?: string; url?: string | null; error?: string }>(`/api/projects/${projectId}/preview/status`);
    if (statusRes.status === 200) {
      lastState = statusRes.body.state ?? null;
      lastUrl = statusRes.body.url ?? null;
      if (lastState === 'ready') {
        return { state: lastState, url: lastUrl };
      }
      if (lastState === 'failed' || lastState === 'stopped') {
        throw new Error(`preview failed: ${statusRes.body.error ?? 'unknown'}`);
      }
    }
    await sleep(2000);
  }
  throw new Error(`preview timeout after ${PREVIEW_TIMEOUT_MS}ms (lastState=${lastState ?? 'unknown'})`);
}

async function verifyExport(projectId: string): Promise<boolean> {
  const headers = new Headers(authHeaders);
  const response = await fetch(`${API_URL}/api/projects/${projectId}/export`, {
    method: 'GET',
    headers,
  });
  if (!response.ok) {
    throw new Error(`export failed: status=${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  return bytes.byteLength > 256;
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const preflightBefore = await jsonRequest<RuntimePreflight>('/api/runtime/preflight');
  if (preflightBefore.status !== 200) {
    throw new Error(`runtime preflight endpoint failed: status=${preflightBefore.status}`);
  }
  if (!preflightBefore.body.ok) {
    throw new Error(`runtime preflight is unhealthy before missions: ${preflightBefore.body.reason ?? 'unknown'}`);
  }

  const results: MissionResult[] = [];

  const promptTier = (prompt: string): 'tier1' | 'tier2' | 'tier3' | 'custom' => {
    if (RELIABILITY_TIERS.tier1.includes(prompt as (typeof RELIABILITY_TIERS.tier1)[number])) return 'tier1';
    if (RELIABILITY_TIERS.tier2.includes(prompt as (typeof RELIABILITY_TIERS.tier2)[number])) return 'tier2';
    if (RELIABILITY_TIERS.tier3.includes(prompt as (typeof RELIABILITY_TIERS.tier3)[number])) return 'tier3';
    return 'custom';
  };

  const workload: Array<{ index: number; prompt: string; tier: 'tier1' | 'tier2' | 'tier3' | 'custom' }> = [];
  for (let cycle = 0; cycle < REPEAT_CYCLES; cycle++) {
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i] ?? '';
      workload.push({ index: cycle * prompts.length + i, prompt, tier: promptTier(prompt) });
    }
  }

  for (const workloadItem of workload) {
    const i = workloadItem.index;
    const prompt = workloadItem.prompt;
    const tier = workloadItem.tier;
    const t0 = Date.now();
    let projectId: string | null = null;
    let sessionId: string | null = null;
    try {
      const created = await startMission(prompt);
      projectId = created.projectId;
      sessionId = created.sessionId;

      const mission = await waitMission(projectId, sessionId);
      if (mission.project.status !== 'generated') {
        const artifacts = await safeArtifactsCount(projectId);
        const filesCount = artifacts.verified ? artifacts.count : -1;
        const diagnostics = extractMissionFailureDiagnostics({
          project: mission.project,
          sessionProgress: mission.sessionProgress,
          filesCount,
        });
        throw new Error(
          `mission ended with status=${mission.project.status}; ` +
          `category=${diagnostics.failureCategory}; phase=${diagnostics.failurePhase}; ` +
          `step=${diagnostics.failedStep}; reason=${diagnostics.failureReason}; ` +
          `artifactListing=${artifacts.verified ? 'ok' : `failed (${artifacts.error ?? 'unavailable'})`}`,
        );
      }

      const filesCount = await verifyArtifacts(projectId);
      if (filesCount <= 0) {
        const diagnostics = extractMissionFailureDiagnostics({
          project: mission.project,
          sessionProgress: mission.sessionProgress,
          filesCount,
        });
        throw new Error(
          `no artifacts generated; classification=${diagnostics.zeroFileClassification ?? 'orchestration_abort'}; ` +
          `reason=${diagnostics.failureReason}`,
        );
      }

      const preview = await waitPreview(projectId);
      const exportOk = await verifyExport(projectId);
      if (!exportOk) {
        throw new Error('export response too small');
      }

      results.push({
        index: i,
        tier,
        prompt,
        projectId,
        sessionId,
        status: 'pass',
        durationMs: Date.now() - t0,
        filesCount,
        previewState: preview.state,
        previewUrl: preview.url,
        exportOk,
        exportState: exportOk ? 'ok' : 'failed',
        retriesObserved: mission.retriesObserved,
        phasesSeen: mission.phasesSeen,
        failureCategory: null,
        failurePhase: null,
        failureReason: null,
        failedAgent: null,
        failedStep: null,
        retryCount: mission.retriesObserved,
        lastValidCheckpoint: null,
        filesGeneratedBeforeFailure: filesCount,
        recoveryAttempted: false,
        recommendedNextAction: null,
        zeroFileClassification: null,
      });
    } catch (err) {
      let filesCount = -1;
      let artifactsVerified = false;
      let artifactsError: string | null = null;
      let retriesObserved = 0;
      let phasesSeen: string[] = [];
      let diagnostics: ReturnType<typeof extractMissionFailureDiagnostics> | null = null;
      if (projectId) {
        const failedProject = await jsonRequest<any>(`/api/projects/${projectId}`);
        const sessionProgress = sessionId
          ? await jsonRequest<any>(`/api/sessions/${sessionId}/progress`)
          : { status: 404, body: null };
        const artifacts = await safeArtifactsCount(projectId);
        filesCount = artifacts.count;
        artifactsVerified = artifacts.verified;
        artifactsError = artifacts.error;
        if (failedProject.status === 200) {
          const phase = failedProject.body?.progress?.executionPhase ?? failedProject.body?.progress?.phase;
          if (typeof phase === 'string' && phase.length > 0) phasesSeen = [phase];
          diagnostics = extractMissionFailureDiagnostics({
            project: failedProject.body,
            sessionProgress: sessionProgress.status === 200 ? sessionProgress.body : null,
            filesCount: artifactsVerified ? filesCount : -1,
          });
          retriesObserved = diagnostics.retryCount;
        }
      }
      const fallbackFailureReason = err instanceof Error ? err.message : String(err);
      const timedOut = /mission timeout/i.test(fallbackFailureReason);
      const normalizedFailureReason = /(^|[\s:])unknown($|[\s:])/i.test(fallbackFailureReason)
        ? `mission failed without explicit error (artifactListing=${artifactsVerified ? 'ok' : `failed: ${artifactsError ?? 'unavailable'}`})`
        : fallbackFailureReason;
      const timeoutFailureReason = timedOut ? normalizedFailureReason : null;
      const timeoutShouldOverride = timedOut && !diagnostics;
      results.push({
        index: i,
        tier,
        prompt,
        projectId,
        sessionId,
        status: 'fail',
        reason: diagnostics
          ? `${timeoutShouldOverride ? 'timeout' : diagnostics.failureCategory}/${timeoutShouldOverride ? (diagnostics.failurePhase || 'pipeline') : diagnostics.failurePhase}: ${timeoutShouldOverride ? timeoutFailureReason : diagnostics.failureReason}`
          : normalizedFailureReason,
        durationMs: Date.now() - t0,
        filesCount,
        previewState: null,
        previewUrl: null,
        exportOk: false,
        exportState: 'not_attempted',
        retriesObserved,
        phasesSeen,
        failureCategory: timeoutShouldOverride ? 'timeout' : (diagnostics?.failureCategory ?? 'orchestration_failure'),
        failurePhase: timeoutShouldOverride ? (diagnostics?.failurePhase ?? 'pipeline') : (diagnostics?.failurePhase ?? 'pipeline'),
        failureReason: timeoutShouldOverride ? (timeoutFailureReason ?? normalizedFailureReason) : (diagnostics?.failureReason ?? normalizedFailureReason),
        failedAgent: diagnostics?.failedAgent ?? 'pipeline',
        failedStep: diagnostics?.failedStep ?? 'pipeline',
        retryCount: diagnostics?.retryCount ?? retriesObserved,
        lastValidCheckpoint: diagnostics?.lastValidCheckpoint ?? null,
        filesGeneratedBeforeFailure: diagnostics?.filesGeneratedBeforeFailure ?? Math.max(filesCount, 0),
        recoveryAttempted: diagnostics?.recoveryAttempted ?? false,
        recommendedNextAction: diagnostics?.recommendedNextAction ?? 'Inspect project diagnostics and pipeline ledger.',
        zeroFileClassification: diagnostics?.zeroFileClassification
          ?? (filesCount === 0
            ? 'orchestration_abort'
            : (!artifactsVerified && filesCount < 0 ? 'artifact_assembly_failure' : null)),
      });
    }
  }

  const preflightAfter = await jsonRequest<RuntimePreflight>('/api/runtime/preflight');
  const metricsRes = await jsonRequest<any>('/api/runtime/metrics');

  const success = results.filter((r) => r.status === 'pass');
  const failed = results.filter((r) => r.status === 'fail');
  const successRate = results.length > 0 ? success.length / results.length : 0;
  const avgDurationMs = success.length > 0
    ? Math.round(success.reduce((sum, r) => sum + r.durationMs, 0) / success.length)
    : null;
  const retries = results.reduce((sum, r) => sum + r.retriesObserved, 0);
  const reliabilityByTier = (['tier1', 'tier2', 'tier3'] as const).map((tier) => {
    const tierRuns = results.filter((r) => r.tier === tier);
    const tierPass = tierRuns.filter((r) => r.status === 'pass');
    return {
      tier,
      total: tierRuns.length,
      succeeded: tierPass.length,
      failed: tierRuns.length - tierPass.length,
      successRate: tierRuns.length > 0 ? tierPass.length / tierRuns.length : 0,
    };
  });

  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    apiUrl: API_URL,
    prompts,
    repeatCycles: REPEAT_CYCLES,
    minSuccessMissions: MIN_SUCCESS_MISSIONS,
    summary: {
      total: results.length,
      succeeded: success.length,
      failed: failed.length,
      successRate,
      averageCompletionMs: avgDurationMs,
      retryFrequency: results.length > 0 ? retries / results.length : 0,
      previewStartupSuccess: results.length > 0 ? success.filter((r) => r.previewState === 'ready').length / results.length : 0,
      exportSuccessRate: results.length > 0 ? success.filter((r) => r.exportOk).length / results.length : 0,
      failureCategories: failed.reduce<Record<string, number>>((acc, item) => {
        const key = item.failureCategory ?? 'orchestration_failure';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      reliabilityByTier,
    },
    preflightBefore: preflightBefore.body,
    preflightAfter: preflightAfter.body,
    runtimeTelemetry: metricsRes.status === 200 ? metricsRes.body : null,
    results,
  };

  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), 'successful-mission-results.json');
  await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report.summary, null, 2));
  if (success.length < MIN_SUCCESS_MISSIONS) {
    throw new Error(
      `Successful mission threshold not met: succeeded=${success.length}, required=${MIN_SUCCESS_MISSIONS}`,
    );
  }
}

main().catch((err) => {
  console.error(`successful-mission-e2e failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
