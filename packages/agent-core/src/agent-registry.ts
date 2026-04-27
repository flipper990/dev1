// ─────────────────────────────────────────────────────────────
// Agent Registry — 4 agent definitions for the simplified pipeline.
//
//   spec    → product specification (intent + planning + architecture)
//   builder → fullstack code generation
//   qa      → review + bug fix (loops back to builder when verdict ≠ pass)
//   polish  → UI/UX + perf + production readiness
//
// ─────────────────────────────────────────────────────────────

import type { AgentDefinition, AgentRole } from './types';
import { PROMPTS } from './prompts';

// ── Model Presets ───────────────────────────────────────────

const MODELS = {
  OPUS:       { provider: 'anthropic' as const, model: 'claude-opus-4',   maxTokens: 16384, temperature: 0.3 },
  SONNET:     { provider: 'anthropic' as const, model: 'claude-sonnet-4', maxTokens: 16384, temperature: 0.2 },
  HAIKU:      { provider: 'anthropic' as const, model: 'claude-haiku-4',  maxTokens: 8192,  temperature: 0.2 },
  GPT4O:      { provider: 'openai' as const,    model: 'gpt-4o',          maxTokens: 16384, temperature: 0.2 },
  GPT4O_MINI: { provider: 'openai' as const,    model: 'gpt-4o-mini',     maxTokens: 8192,  temperature: 0.2 },
};

// ── Shared Memory Configs ───────────────────────────────────

const MEMORY = {
  full:  { shortTerm: true, longTerm: true,  maxShortTermEntries: 20, maxLongTermRetrievals: 5, embeddingModel: 'text-embedding-3-small' },
  light: { shortTerm: true, longTerm: true,  maxShortTermEntries: 5,  maxLongTermRetrievals: 3, embeddingModel: 'text-embedding-3-small' },
};

// ── Agent Definitions ───────────────────────────────────────

export const AGENT_DEFINITIONS: Record<AgentRole, AgentDefinition> = {

  // ────────────────────────────────────────────────
  // 1. SPEC — intent expansion + planning + architecture
  // ────────────────────────────────────────────────
  spec: {
    role: 'spec',
    name: 'Spec Agent',
    description:
      'Combines intent expansion, planning, and architecture. Produces the single ' +
      'authoritative product specification (features, UI, design system, file tree, ' +
      'apiContracts, frontendPages, components, dbSchema, envVars, quality bars).',
    model: MODELS.OPUS,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Raw user prompts + optional preferences',
      schema: {
        prompts:         { type: 'array',  description: '1–3 user prompts as originally provided', required: true },
        userPreferences: { type: 'object', description: 'Saved user preferences (stack, style, etc.)', required: false },
      },
    },
    output: {
      description: 'Full product specification',
      schema: {
        productName:      { type: 'string', description: 'Inferred product name', required: true },
        productCategory:  { type: 'string', description: 'High-level product category', required: true },
        oneLiner:         { type: 'string', description: 'One-sentence pitch', required: true },
        summary:          { type: 'string', description: '2–3 sentence project summary', required: true },
        targetUsers:      { type: 'array',  description: 'User personas', required: true },
        expandedPrompt:   { type: 'string', description: '≥400-word elaborated brief — single source of truth', required: true },
        features:         { type: 'object', description: '{ core, standard, stretch }', required: true },
        featureSlices:    { type: 'array',  description: '[{ id, purpose, routes, apiIds, dbTables, components, acceptance }] — product decomposed into slices', required: true },
        techStack:        { type: 'object', description: '{ frontend, backend, database, auth, styling }', required: true },
        designSystem:     { type: 'object', description: 'Colour palette, typography, spacing, radii, shadows, primitives[]', required: true },
        fileTree:         { type: 'array',  description: '[{ path, purpose }] — every file to generate', required: true },
        apiContracts:     { type: 'array',  description: 'Backend route contracts', required: true },
        frontendPages:    { type: 'array',  description: 'Every frontend route + sections + components + modals + interactions + dataDeps', required: true },
        components:       { type: 'array',  description: 'Every reusable component (page sections, modals, primitives) with name/path/kind/props', required: true },
        userFlows:        { type: 'array',  description: '[{ id, actor, goal, steps:[{page, action, apiId, expect}], successCriteria }] — primary jobs-to-be-done; min 1 per featureSlice', required: true },
        dbSchema:         { type: 'object', description: 'Tables / columns / indexes', required: false },
        envVars:          { type: 'array',  description: 'Required environment variables', required: true },
        uiExpectations:   { type: 'object', description: 'Pages, components, states, responsive, a11y, design language', required: true },
        qualityStandards: { type: 'object', description: 'Performance, security, code quality, testing, error handling, UX polish bars', required: true },
        constraints:      { type: 'array',  description: 'Constraints to respect', required: false },
        nonGoals:         { type: 'array',  description: 'Out-of-scope items', required: false },
        assumptions:      { type: 'array',  description: 'Assumptions made for ambiguous prompts', required: false },
      },
    },
    systemPrompt: PROMPTS.spec,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 60_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: [],
  },

  // ────────────────────────────────────────────────
  // 2. BUILDER — fullstack implementation
  // ────────────────────────────────────────────────
  builder: {
    role: 'builder',
    name: 'Builder Agent',
    description:
      'Generates the complete fullstack application (frontend + backend) from the spec. ' +
      'On QA-feedback iterations it patches/extends the existing files to address QA findings.',
    model: MODELS.SONNET,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Full spec + (on iteration N≥2) previous files and QA feedback',
      schema: {
        spec:           { type: 'object', description: 'Full product specification from SPEC agent', required: true },
        existingFiles:  { type: 'array',  description: 'Current codebase (empty on iteration 1, present on QA feedback)', required: false },
        qaFeedback:     { type: 'object', description: 'QA findings from previous iteration (issues + suggestedFixes)', required: false },
        iteration:      { type: 'number', description: 'Build iteration count (1 = initial, 2+ = QA feedback)', required: false },
        currentSlice:   { type: 'object', description: 'When set, only this featureSlice is being built this pass; preserve all other existingFiles unchanged.', required: false },
        sliceIndex:     { type: 'number', description: '0-based index of currentSlice in spec.featureSlices', required: false },
        totalSlices:    { type: 'number', description: 'Total number of slices being iterated', required: false },
      },
    },
    output: {
      description: 'Generated source files',
      schema: {
        files:   { type: 'array',  description: '[{ path, content, language }]', required: true },
        summary: { type: 'string', description: '1–2 sentence summary of what was built/changed', required: false },
      },
    },
    systemPrompt: PROMPTS.builder,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 12000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['spec'],
  },

  // ────────────────────────────────────────────────
  // 3. QA — review + auto-fix + verdict (loops to builder)
  // ────────────────────────────────────────────────
  qa: {
    role: 'qa',
    name: 'QA Agent',
    description:
      'Reviews the entire codebase: detects bugs, missing logic, broken wiring, security issues, ' +
      'and spec violations. Applies fixes via patches/newFiles. Returns a verdict — if ' +
      '"needs-improvement" the BUILDER re-runs with these findings as input.',
    model: MODELS.OPUS,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Full codebase + spec',
      schema: {
        spec:            { type: 'object', description: 'Full spec', required: true },
        files:           { type: 'array',  description: 'Every file produced by the builder', required: true },
        runtimeFeedback: { type: 'object', description: 'Live-preview classification: { issues:[{category,message,hint?}], log, bodySample }. Present when a runtime check has run.', required: false },
        currentSlice:    { type: 'object', description: 'When set, scope acceptance review to this featureSlice only.', required: false },
        sliceIndex:      { type: 'number', description: '0-based slice index', required: false },
        totalSlices:     { type: 'number', description: 'Total number of slices', required: false },
      },
    },
    output: {
      description: 'Review report, patches, new files, verdict',
      schema: {
        verdict:  { type: 'string', description: "'pass' or 'needs-improvement'", required: true },
        scores:   { type: 'object', description: 'Per-dimension 0–100 + overall', required: true },
        issues:   { type: 'array',  description: 'All issues found', required: true },
        patches:  { type: 'array',  description: 'Patches to existing files', required: true },
        newFiles: { type: 'array',  description: 'Net-new files (e.g. missing components)', required: false },
        summary:  { type: 'string', description: '1-paragraph QA report', required: true },
      },
    },
    systemPrompt: PROMPTS.qa,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['builder'],
  },

  // ────────────────────────────────────────────────
  // 4. POLISH — UI/UX + perf + production readiness
  // ────────────────────────────────────────────────
  polish: {
    role: 'polish',
    name: 'Polish Agent',
    description:
      'Final-pass refinement: UI/UX polish, performance optimisations, accessibility, and ' +
      'production-readiness artifacts (Dockerfile, docker-compose, README, deploy scripts).',
    model: { ...MODELS.SONNET, maxTokens: 16384 },
    fallbackModel: { ...MODELS.GPT4O_MINI, maxTokens: 16384 },
    input: {
      description: 'QA-passed codebase + spec + design-violation audit',
      schema: {
        spec:         { type: 'object', description: 'Full spec', required: true },
        files:        { type: 'array',  description: 'QA-approved codebase', required: true },
        designAudit:  { type: 'object', description: 'Pre-scan of concrete design-system violations to fix', required: false },
      },
    },
    output: {
      description: 'Polish patches + production artifacts',
      schema: {
        patches:            { type: 'array',  description: 'Patches to existing files', required: true },
        newFiles:           { type: 'array',  description: 'Production artifacts (Dockerfile, README, design tokens, primitives, etc.)', required: false },
        recommendations:    { type: 'array',  description: 'Manual follow-ups not auto-applied', required: false },
        designSystemReport: { type: 'object', description: 'What was added/replaced for design system enforcement', required: false },
        performanceReport:  { type: 'object', description: 'Render + network optimizations applied', required: false },
        selfCheck:          { type: 'object', description: '10-point production-quality self-check map', required: false },
        perfEstimate:       { type: 'object', description: 'Estimated perf characteristics', required: false },
        summary:            { type: 'string', description: '1-paragraph polish report', required: true },
      },
    },
    systemPrompt: PROMPTS.polish,
    memoryConfig: MEMORY.light,
    maxConcurrency: 1,
    timeoutMs: 120_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['qa'],
  },
};

// ── Helper: Get definition by role ──────────────────────────

export function getAgentDefinition(role: AgentRole): AgentDefinition {
  const def = AGENT_DEFINITIONS[role];
  if (!def) throw new Error(`Unknown agent role: ${role}`);
  return def;
}

// ── Helper: Get execution order (topological sort) ──────────

export function getExecutionOrder(): AgentRole[][] {
  const stages: AgentRole[][] = [];
  const resolved = new Set<AgentRole>();

  const allRoles = Object.keys(AGENT_DEFINITIONS) as AgentRole[];

  while (resolved.size < allRoles.length) {
    const stage: AgentRole[] = [];
    for (const role of allRoles) {
      if (resolved.has(role)) continue;
      const deps = AGENT_DEFINITIONS[role].dependencies;
      if (deps.every(d => resolved.has(d))) stage.push(role);
    }
    if (stage.length === 0) throw new Error('Circular dependency detected in agent definitions');
    stages.push(stage);
    stage.forEach(r => resolved.add(r));
  }

  return stages;
}
