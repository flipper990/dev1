import type { PipelineEvent } from '../../../../packages/agent-core/src/pipeline-types.js';
import type { AgentRole } from '../../../../packages/agent-core/src/types.js';

export type PipelineLedgerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'blocked';

export interface PipelineLedgerValidationResult {
  verdict: 'ok' | 'repaired' | 'deferred' | 'blocked';
  issueCount: number;
  repairCount: number;
}

export interface PipelineArtifactSummary {
  kind: 'empty' | 'object';
  keys: string[];
  outputSizeBytes: number;
  files?: { count: number; samplePaths: string[] };
  patches?: { count: number };
  newFiles?: { count: number; samplePaths: string[] };
  issues?: { count: number };
  productName?: string;
  featureSlices?: { count: number };
  apiContracts?: { count: number };
  frontendPages?: { count: number };
  components?: { count: number };
  verdict?: string;
  summary?: string;
}

export interface PipelineLedgerRecord {
  id: string;
  projectId: string;
  sessionId: string;
  stepId: string;
  agentRole: AgentRole;
  phase: string;
  attempt: number;
  status: PipelineLedgerStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  validationResult: PipelineLedgerValidationResult | null;
  retryCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputArtifactSummary: PipelineArtifactSummary | null;
}

export interface PipelineRunLedger {
  version: 1;
  projectId: string;
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  records: PipelineLedgerRecord[];
}

export interface PipelineLedgerContext {
  projectId: string;
  sessionId: string;
  phase: string;
  now?: string;
}

export function createPipelineRunLedger(projectId: string, sessionId: string, now = new Date().toISOString()): PipelineRunLedger {
  return {
    version: 1,
    projectId,
    sessionId,
    startedAt: now,
    updatedAt: now,
    records: [],
  };
}

export function applyPipelineLedgerEvent(
  current: PipelineRunLedger | undefined,
  event: PipelineEvent,
  context: PipelineLedgerContext,
): PipelineRunLedger {
  const now = context.now ?? new Date().toISOString();
  const ledger = current ?? createPipelineRunLedger(context.projectId, context.sessionId, now);
  ledger.updatedAt = now;

  switch (event.type) {
    case 'step:started': {
      ledger.records.push({
        id: makeRecordId(context.phase, event.stepId, event.agent, ledger.records.length + 1),
        projectId: context.projectId,
        sessionId: context.sessionId,
        stepId: event.stepId,
        agentRole: event.agent,
        phase: context.phase,
        attempt: 1,
        status: 'running',
        startedAt: now,
        completedAt: null,
        durationMs: null,
        model: null,
        provider: null,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        validationResult: null,
        retryCount: 0,
        errorCode: null,
        errorMessage: null,
        outputArtifactSummary: null,
      });
      break;
    }
    case 'step:retrying': {
      const record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (record) {
        record.attempt = event.attempt;
        record.retryCount = Math.max(record.retryCount, event.attempt - 1);
        record.status = 'running';
        record.errorMessage = event.error;
      }
      break;
    }
    case 'step:validated': {
      const record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (record) {
        record.validationResult = {
          verdict: event.verdict,
          issueCount: event.issueCount,
          repairCount: event.repairCount,
        };
        if (event.verdict === 'blocked') {
          record.status = 'blocked';
        }
      }
      break;
    }
    case 'step:blocked': {
      const record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (record) {
        record.status = 'blocked';
        record.completedAt = now;
        record.durationMs = durationFrom(record.startedAt, now);
        record.errorCode = 'VALIDATION_BLOCKED';
        record.errorMessage = event.reason;
      }
      break;
    }
    case 'step:completed': {
      const record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (record) {
        record.status = 'completed';
        record.completedAt = now;
        record.durationMs = event.durationMs;
        record.model = event.usage?.model ?? null;
        record.provider = event.usage?.provider ?? null;
        record.inputTokens = event.usage?.tokensIn ?? 0;
        record.outputTokens = event.usage?.tokensOut ?? 0;
        record.costUsd = event.usage?.costUsd ?? 0;
        record.outputArtifactSummary = event.artifactSummary ?? null;
      }
      break;
    }
    case 'step:failed': {
      const record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (record) {
        record.status = 'failed';
        record.completedAt = now;
        record.durationMs = durationFrom(record.startedAt, now);
        record.errorCode = event.errorCode ?? null;
        record.errorMessage = event.error;
      }
      break;
    }
    case 'step:skipped': {
      let record = findLatestRecord(ledger, context.phase, event.stepId, event.agent);
      if (!record || record.status !== 'running') {
        record = {
          id: makeRecordId(context.phase, event.stepId, event.agent, ledger.records.length + 1),
          projectId: context.projectId,
          sessionId: context.sessionId,
          stepId: event.stepId,
          agentRole: event.agent,
          phase: context.phase,
          attempt: 0,
          status: 'pending',
          startedAt: null,
          completedAt: null,
          durationMs: null,
          model: null,
          provider: null,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          validationResult: null,
          retryCount: 0,
          errorCode: null,
          errorMessage: null,
          outputArtifactSummary: null,
        };
        ledger.records.push(record);
      }
      record.status = 'skipped';
      record.completedAt = now;
      record.durationMs = record.startedAt ? durationFrom(record.startedAt, now) : 0;
      record.errorMessage = event.reason;
      break;
    }
    default:
      break;
  }

  return ledger;
}

export function summarizeOutputArtifact(output: Record<string, unknown> | undefined): PipelineArtifactSummary | null {
  if (!output || typeof output !== 'object') return null;
  const keys = Object.keys(output).sort();
  const outputSizeBytes = Buffer.byteLength(safeJson(output), 'utf8');
  const summary: PipelineArtifactSummary = {
    kind: keys.length === 0 ? 'empty' : 'object',
    keys,
    outputSizeBytes,
  };

  const files = asPathArray(output.files);
  if (files) summary.files = { count: files.length, samplePaths: files.slice(0, 12) };

  const patches = Array.isArray(output.patches) ? output.patches : null;
  if (patches) summary.patches = { count: patches.length };

  const newFiles = asPathArray(output.newFiles);
  if (newFiles) summary.newFiles = { count: newFiles.length, samplePaths: newFiles.slice(0, 12) };

  const issues = Array.isArray(output.issues) ? output.issues : null;
  if (issues) summary.issues = { count: issues.length };

  if (typeof output.productName === 'string') summary.productName = output.productName;
  if (Array.isArray(output.featureSlices)) summary.featureSlices = { count: output.featureSlices.length };
  if (Array.isArray(output.apiContracts)) summary.apiContracts = { count: output.apiContracts.length };
  if (Array.isArray(output.frontendPages)) summary.frontendPages = { count: output.frontendPages.length };
  if (Array.isArray(output.components)) summary.components = { count: output.components.length };
  if (typeof output.verdict === 'string') summary.verdict = output.verdict;
  if (typeof output.summary === 'string') summary.summary = output.summary.slice(0, 240);

  return summary;
}

function findLatestRecord(
  ledger: PipelineRunLedger,
  phase: string,
  stepId: string,
  agentRole: AgentRole,
): PipelineLedgerRecord | undefined {
  for (let i = ledger.records.length - 1; i >= 0; i--) {
    const record = ledger.records[i];
    if (record.phase === phase && record.stepId === stepId && record.agentRole === agentRole) {
      return record;
    }
  }
  return undefined;
}

function makeRecordId(phase: string, stepId: string, agentRole: AgentRole, sequence: number): string {
  return `${sequence}:${phase}:${stepId}:${agentRole}`.replace(/\s+/g, '-');
}

function durationFrom(startedAt: string | null, completedAt: string): number | null {
  if (!startedAt) return null;
  const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function asPathArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(item => {
      if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
        return (item as { path: string }).path;
      }
      return null;
    })
    .filter((path): path is string => path !== null);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}
