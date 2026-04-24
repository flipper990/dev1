// ─────────────────────────────────────────────────────────────
// Agent Registry — All 8 agent definitions with model routing
// ─────────────────────────────────────────────────────────────

import type { AgentDefinition, AgentRole } from './types';
import { PROMPTS } from './prompts';

// ── Model Presets ───────────────────────────────────────────

const MODELS = {
  OPUS:       { provider: 'anthropic' as const, model: 'claude-opus-4',   maxTokens: 16384, temperature: 0.3 },
  SONNET:     { provider: 'anthropic' as const, model: 'claude-sonnet-4', maxTokens: 16384, temperature: 0.2 },
  HAIKU:      { provider: 'anthropic' as const, model: 'claude-haiku-4',  maxTokens: 8192,  temperature: 0.2 },
  GPT4O:      { provider: 'openai' as const,    model: 'gpt-4o',            maxTokens: 16384, temperature: 0.2 },
  GPT4O_MINI: { provider: 'openai' as const,    model: 'gpt-4o-mini',       maxTokens: 8192,  temperature: 0.2 },
  GEMINI_PRO: { provider: 'google' as const,    model: 'gemini-2.0-pro',    maxTokens: 8192,  temperature: 0.2 },
};

// ── Shared Memory Configs ───────────────────────────────────

const MEMORY = {
  full:    { shortTerm: true, longTerm: true,  maxShortTermEntries: 20, maxLongTermRetrievals: 5, embeddingModel: 'text-embedding-3-small' },
  session: { shortTerm: true, longTerm: false, maxShortTermEntries: 10, maxLongTermRetrievals: 0, embeddingModel: 'text-embedding-3-small' },
  light:   { shortTerm: true, longTerm: true,  maxShortTermEntries: 5,  maxLongTermRetrievals: 3, embeddingModel: 'text-embedding-3-small' },
};

// ── Agent Definitions ───────────────────────────────────────

export const AGENT_DEFINITIONS: Partial<Record<AgentRole, AgentDefinition>> = {

  // ────────────────────────────────────────────────
  // 0. INTENT EXPANDER — runs before planner
  // ────────────────────────────────────────────────
  intent_expander: {
    role: 'intent_expander',
    name: 'Intent Expansion Agent',
    description: 'Transforms vague user prompts into a detailed product specification with features, UI expectations, and quality standards. Its output replaces the original prompt for every downstream agent.',
    model: MODELS.SONNET,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Raw user prompts',
      schema: {
        prompts:         { type: 'array',  description: '1–3 user prompts as originally provided', required: true },
        userPreferences: { type: 'object', description: 'Saved user preferences (stack, style, etc.)', required: false },
      },
    },
    output: {
      description: 'Expanded product specification',
      schema: {
        productName:      { type: 'string', description: 'Inferred product name', required: true },
        productCategory:  { type: 'string', description: 'High-level product category', required: true },
        oneLiner:         { type: 'string', description: 'One-sentence pitch', required: true },
        targetUsers:      { type: 'array',  description: 'User personas', required: true },
        expandedPrompts:  { type: 'array',  description: 'Consolidated detailed prompt(s) that replace the original input', required: true },
        features:         { type: 'object', description: '{ core, standard, stretch } feature lists', required: true },
        uiExpectations:   { type: 'object', description: 'Pages, components, states, responsive, a11y, design language', required: true },
        qualityStandards: { type: 'object', description: 'Performance, security, code quality, testing, error handling, UX polish bars', required: true },
        constraints:      { type: 'array',  description: 'Constraints to respect', required: false },
        nonGoals:         { type: 'array',  description: 'Explicit out-of-scope items', required: false },
        assumptions:      { type: 'array',  description: 'Assumptions made when prompts were ambiguous', required: false },
      },
    },
    systemPrompt: PROMPTS.intent_expander,
    memoryConfig: MEMORY.light,
    maxConcurrency: 1,
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 12000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: [],
  },

  // ────────────────────────────────────────────────
  // 1. PLANNER
  // ────────────────────────────────────────────────
  planner: {
    role: 'planner',
    name: 'Planner Agent',
    description: 'Decomposes the expanded product specification into a structured execution plan with tasks, priorities, and dependencies.',
    // Sonnet is 5× cheaper than Opus and handles structured task decomposition equally well
    model: { ...MODELS.SONNET, maxTokens: 4096 },
    fallbackModel: { ...MODELS.GPT4O, maxTokens: 4096 },
    input: {
      description: 'Expanded product spec (preferred) or raw user prompts (fallback)',
      schema: {
        prompts:         { type: 'array',  description: 'Expanded detailed prompts from intent_expander, or original prompts as fallback', required: true },
        expandedSpec:    { type: 'object', description: 'Full expanded specification from intent_expander', required: false },
        userPreferences: { type: 'object', description: 'Saved user preferences (stack, style, etc.)', required: false },
      },
    },
    output: {
      description: 'Structured execution plan',
      schema: {
        projectName:  { type: 'string', description: 'Inferred project name', required: true },
        summary:      { type: 'string', description: 'One-paragraph project summary', required: true },
        tasks:        { type: 'array',  description: 'Ordered list of tasks with agent assignments', required: true },
        constraints:  { type: 'array',  description: 'Technical constraints or assumptions', required: true },
        stackHints:   { type: 'object', description: 'Suggested tech stack (frontend, backend, db)', required: true },
      },
    },
    systemPrompt: PROMPTS.planner,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['intent_expander'],
  },

  // ────────────────────────────────────────────────
  // 2. ARCHITECT
  // ────────────────────────────────────────────────
  architect: {
    role: 'architect',
    name: 'Architect Agent',
    description: 'Converts the execution plan into a technical specification: file tree, DB schema, API contracts, component hierarchy.',
    model: MODELS.OPUS,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Execution plan from Planner',
      schema: {
        plan:            { type: 'object', description: 'Full execution plan from planner', required: true },
        userPreferences: { type: 'object', description: 'User preferences', required: false },
      },
    },
    output: {
      description: 'Complete project specification',
      schema: {
        techStack:      { type: 'object', description: '{ frontend, backend, database, auth, styling }', required: true },
        designSystem:   { type: 'object', description: 'Colour palette, typography, spacing, radii, shadows, primitives[]', required: true },
        fileTree:       { type: 'array',  description: 'Complete list of file paths to generate', required: true },
        dbSchema:       { type: 'object', description: 'Tables, columns, relations, indexes', required: true },
        apiContracts:   { type: 'array',  description: '{ id, method, path, requestSchema, responseSchema, errorResponses[], auth }[] — unique ids, strict schemas', required: true },
        frontendPages:  { type: 'array',  description: '{ path, name, file, auth, dataDeps[{apiId|null, trigger, mocked, reason?}], components[] }[] — every route in the app', required: true },
        components:     { type: 'array',  description: '{ name, path, props[], children[], dataDeps[], description, designNotes }[] — exhaustive, non-overlapping', required: true },
        dataFlowMap:    { type: 'array',  description: '{ from:{kind,name}, to:{apiId}, trigger }[] — every apiContract referenced at least once', required: true },
        dependencyList: { type: 'object', description: '{ frontend[], backend[], dev[] } — each entry { name, version, purpose }; real npm packages only', required: true },
        envVars:        { type: 'array',  description: 'Required environment variables', required: true },
      },
    },
    systemPrompt: PROMPTS.architect,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 45_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['planner'],
  },

  // ────────────────────────────────────────────────
  // 3. DEVELOPER
  // ────────────────────────────────────────────────
  developer: {
    role: 'developer',
    name: 'Developer Agent',
    description: 'Generates production-quality source code files from the technical specification.',
    model: MODELS.SONNET,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Technical spec and file assignments',
      schema: {
        spec:          { type: 'object', description: 'Full project spec from Architect', required: true },
        fileAssignment:{ type: 'array',  description: 'Subset of files this instance should generate', required: true },
        context:       { type: 'object', description: 'Already-generated files for import resolution', required: false },
      },
    },
    output: {
      description: 'Generated source files',
      schema: {
        files: { type: 'array', description: '{ path, content, language }[]', required: true },
      },
    },
    systemPrompt: PROMPTS.developer,
    memoryConfig: MEMORY.full,
    maxConcurrency: 4,   // can run multiple instances in parallel for different file sets
    timeoutMs: 60_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['architect'],
  },

  // ────────────────────────────────────────────────
  // 4. REVIEWER
  // ────────────────────────────────────────────────
  reviewer: {
    role: 'reviewer',
    name: 'Reviewer Agent',
    description: 'Reviews all generated code for correctness, security vulnerabilities, consistency, and best practices.',
    // Opus retained for security analysis quality; maxTokens capped — issues list rarely exceeds 4K tokens
    model: { ...MODELS.OPUS, maxTokens: 4096 },
    fallbackModel: { ...MODELS.GPT4O, maxTokens: 4096 },
    input: {
      description: 'Full codebase and project spec',
      schema: {
        spec:     { type: 'object', description: 'Project spec for contract verification', required: true },
        files:    { type: 'array',  description: 'All generated files', required: true },
      },
    },
    output: {
      description: 'Review report with issues and fix suggestions',
      schema: {
        validationResult: { type: 'string',  description: '"PASS" or "FAIL" — binary completeness verdict', required: true },
        missingItems:     { type: 'array',   description: 'Concrete missing routes/pages/components/dependencies', required: true },
        issues:           { type: 'array',   description: '{ file, line, severity, category, description, suggestedFix }[]', required: true },
        score:            { type: 'number',  description: 'Quality score 0–100 (0 on FAIL)', required: true },
        passable:         { type: 'boolean', description: 'Whether code is shippable as-is', required: true },
        summary:          { type: 'string',  description: 'Review summary', required: true },
      },
    },
    systemPrompt: PROMPTS.reviewer,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 60_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['developer', 'architect'],
  },

  // ────────────────────────────────────────────────
  // 5. TESTER
  // ────────────────────────────────────────────────
  tester: {
    role: 'tester',
    name: 'Tester Agent',
    description: 'Generates unit tests, integration tests, and e2e test skeletons for the codebase.',
    model: { ...MODELS.SONNET, maxTokens: 8192 },
    fallbackModel: { ...MODELS.GPT4O_MINI, maxTokens: 8192 },
    input: {
      description: 'Codebase files and API contracts',
      schema: {
        files:        { type: 'array',  description: 'Source files to test', required: true },
        apiContracts: { type: 'array',  description: 'API contracts for integration tests', required: true },
        spec:         { type: 'object', description: 'Project spec for context', required: true },
        reviewIssues: { type: 'array',  description: 'Known issues from reviewer to target with tests', required: false },
      },
    },
    output: {
      description: 'Test files',
      schema: {
        testFiles:    { type: 'array',  description: '{ path, content, testType }[]', required: true },
        coverage:     { type: 'object', description: 'Estimated coverage map per module', required: true },
      },
    },
    systemPrompt: PROMPTS.tester,
    memoryConfig: MEMORY.light,
    maxConcurrency: 2,
    timeoutMs: 45_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['developer'],
  },

  // ────────────────────────────────────────────────
  // 6. DEBUGGER
  // ────────────────────────────────────────────────
  debugger: {
    role: 'debugger',
    name: 'Debugger Agent',
    description: 'Takes review issues and test failures, produces targeted code patches.',
    // Patches are surgical — 6K tokens is more than sufficient for typical fix sets
    model: { ...MODELS.SONNET, maxTokens: 6144 },
    fallbackModel: { ...MODELS.GPT4O, maxTokens: 6144 },
    input: {
      description: 'Issues from Reviewer/Tester and affected files',
      schema: {
        issues:       { type: 'array',  description: 'Issues to fix', required: true },
        affectedFiles:{ type: 'array',  description: 'Files containing issues', required: true },
        testResults:  { type: 'object', description: 'Tester coverage and test-file count for context', required: false },
        spec:         { type: 'object', description: 'Spec for context', required: false },
      },
    },
    output: {
      description: 'Code patches',
      schema: {
        patches:      { type: 'array',  description: '{ file, oldContent, newContent, explanation }[]', required: true },
        unresolved:   { type: 'array',  description: 'Issues that could not be auto-fixed', required: true },
      },
    },
    systemPrompt: PROMPTS.debugger,
    memoryConfig: MEMORY.full,   // long-term memory for recurring bug patterns
    maxConcurrency: 2,
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 8000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['reviewer'],
  },

  // ────────────────────────────────────────────────
  // 7. DEVOPS
  // ────────────────────────────────────────────────
  devops: {
    role: 'devops',
    name: 'DevOps Agent',
    description: 'Generates Dockerfiles, docker-compose, CI/CD pipelines, env templates, and deployment configs.',
    model: MODELS.GPT4O_MINI,
    fallbackModel: MODELS.HAIKU,
    input: {
      description: 'Tech stack and project spec',
      schema: {
        spec:           { type: 'object', description: 'Project spec (stack, env vars, services)', required: true },
        fileTree:       { type: 'array',  description: 'Complete file tree from architect', required: true },
        generatedFiles: { type: 'array',  description: 'Generated file paths after all patches applied', required: false },
      },
    },
    output: {
      description: 'Infrastructure and deployment files',
      schema: {
        files:     { type: 'array',  description: '{ path, content }[]', required: true },
      },
    },
    systemPrompt: PROMPTS.devops,
    memoryConfig: MEMORY.light,
    maxConcurrency: 1,
    timeoutMs: 20_000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['architect'],
  },

  // ────────────────────────────────────────────────
  // 8. OPTIMIZER
  // ────────────────────────────────────────────────
  optimizer: {
    role: 'optimizer',
    name: 'Optimizer Agent',
    description: 'Performs final-pass optimization: bundle analysis, query optimization, caching strategies, lazy loading, tree shaking hints.',
    model: { ...MODELS.SONNET, maxTokens: 6144 },
    fallbackModel: { ...MODELS.GPT4O_MINI, maxTokens: 6144 },
    input: {
      description: 'Final codebase after all patches applied',
      schema: {
        files:            { type: 'array',  description: 'All project files (post-debugger patches applied)', required: true },
        spec:             { type: 'object', description: 'Project spec', required: true },
        qaReport:         { type: 'object', description: 'QA/review report from reviewer', required: false },
        unresolvedIssues: { type: 'array',  description: 'Issues debugger could not auto-fix', required: false },
      },
    },
    output: {
      description: 'Optimization patches and recommendations',
      schema: {
        patches:          { type: 'array',  description: 'Optimization patches to apply', required: true },
        recommendations:  { type: 'array',  description: 'Manual optimization suggestions for the user', required: true },
        perfEstimate:     { type: 'object', description: 'Estimated performance characteristics', required: true },
      },
    },
    systemPrompt: PROMPTS.optimizer,
    memoryConfig: MEMORY.light,
    maxConcurrency: 1,
    timeoutMs: 30_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 2000, maxDelayMs: 10000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR'] },
    dependencies: ['developer'],
  },

  // ────────────────────────────────────────────────
  // 9. QUALITY ENFORCER — final gate
  // ────────────────────────────────────────────────
  quality_enforcer: {
    role: 'quality_enforcer',
    name: 'Quality Enforcement Agent',
    description: 'Scores the merged codebase against the expanded spec (UI, functionality, code quality, consistency) and emits patches when any dimension falls below the bar.',
    model: MODELS.OPUS,
    fallbackModel: MODELS.GPT4O,
    input: {
      description: 'Merged codebase + expanded spec + upstream review signals',
      schema: {
        expandedSpec:     { type: 'object', description: 'Authoritative product specification', required: true },
        files:            { type: 'array',  description: 'Merged files (developer + debugger patches applied)', required: true },
        spec:             { type: 'object', description: 'Architect spec for context', required: false },
        reviewReport:     { type: 'object', description: 'Reviewer output for context', required: false },
        unresolvedIssues: { type: 'array',  description: 'Issues the debugger could not auto-fix', required: false },
      },
    },
    output: {
      description: 'Quality evaluation, patches, and optional new files',
      schema: {
        scores:   { type: 'object', description: 'Per-dimension 0–100 scores + overall', required: true },
        verdict:  { type: 'string', description: "'pass' or 'needs-improvement'", required: true },
        findings: { type: 'array',  description: 'Concrete failing items', required: true },
        patches:  { type: 'array',  description: 'Patches to apply to existing files', required: true },
        newFiles: { type: 'array',  description: 'New files to add (e.g. missing states/components)', required: false },
        summary:  { type: 'string', description: 'One-paragraph summary of improvements', required: true },
      },
    },
    systemPrompt: PROMPTS.quality_enforcer,
    memoryConfig: MEMORY.full,
    maxConcurrency: 1,
    timeoutMs: 90_000,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 3000, maxDelayMs: 15000, backoffMultiplier: 2, retryableErrors: ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'PARSE_ERROR'] },
    dependencies: ['developer', 'reviewer'],
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
      const deps = AGENT_DEFINITIONS[role]!.dependencies;
      if (deps.every(d => resolved.has(d))) {
        stage.push(role);
      }
    }
    if (stage.length === 0) throw new Error('Circular dependency detected in agent definitions');
    stages.push(stage);
    stage.forEach(r => resolved.add(r));
  }

  return stages;
}
